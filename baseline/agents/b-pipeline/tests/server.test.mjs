// P6 server (TRD §10, AC3, AC4, AC9, AC15). Handlers are called directly: no socket, no network. Fake LLM only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandlers, createListener, MAX_BODY_BYTES } from '../server/index.mjs';
import { createPipeline } from '../pipeline/index.mjs';
import { stores, seedPeople, seedS1Memories } from './fixtures/people.mjs';
import { createFakeLlm } from '../llm/index.mjs';
import { products } from './fixtures/catalog.mjs';

const PARENTS = '부모님 한 세트 세트당 예산 5만원 이하 배송비 포함 추천';
const NOW = () => '2027-01-25T03:00:00.000Z';

const S1 = '추석 선물이야. 엄마는 단 거 싫어하시고 땅콩 알레르기, 아빠는 등산 좋아하셔. 5만 원';
const S1_REPLY = {
  recipients: ['어머니', '아버지'], occasion: '추석', budget_amount_krw: 50000, preferences: ['less_sweet'], excluded_ingredients: ['땅콩'],
  memoryCandidates: [
    { recipient: '엄마', key: 'pref:less_sweet', polarity: 1, evidence: '엄마는 단 거 싫어하시고' },
    { recipient: '엄마', key: 'allergy:땅콩', polarity: -1, evidence: '땅콩 알레르기' },
    { recipient: '아빠', key: 'hobby:등산', polarity: 1, evidence: '아빠는 등산 좋아하셔' },
  ],
};

function setup(make = stores.memory, { seed = true, replies } = {}) {
  const store = make();
  const llm = replies ? createFakeLlm({ json: replies }) : null;
  const h = createHandlers({ store, products, pipeline: createPipeline({ store, products, llm, now: NOW, explain: null }) });
  const chat = async (body, onEvent) => h.chat({ ownerId: 'userA', sessionId: 's', experiment: 'B', ...body }, onEvent);
  return { store, h, chat, ready: (async () => { const people = await seedPeople(store); if (seed) await seedS1Memories(store, people); return people; })() };
}

for (const [name, make] of Object.entries(stores)) {
  test(`[${name}] AC3: /chat streams events as they happen — cards reach the client before explanations`, async () => {
    const { chat, ready } = setup(make);
    await ready;
    const seen = [];
    const out = await chat({ request: { kind: 'message', text: PARENTS } }, e => seen.push(e.type));
    // K53: the server adds `conditions` (display fields of the saved state) right after the cards, before the slow explanations
    assert.deepEqual(seen, ['cards', 'conditions', 'explanations']);
    assert.deepEqual(out.events.map(e => e.type), ['cards', 'explanations'], 'the pipeline events themselves are unchanged');
  });

  test(`[${name}] input is validated before anything runs; errors carry a code only`, async () => {
    const { h, ready } = setup(make);
    await ready;
    const run = body => h.chat(body, () => {});
    for (const body of [null, [], {}, { ownerId: 'a b', sessionId: 's', request: { kind: 'view' } }, { ownerId: 'a', sessionId: '', request: { kind: 'view' } },
      { ownerId: 'a', sessionId: 's', request: 'view' }, { ownerId: 'a', sessionId: 's', request: {} }, { ownerId: 'a', sessionId: 's', request: { kind: 'view' }, experiment: 'C' },
      { ownerId: 'a', sessionId: 's', recipientId: '../x', request: { kind: 'view' } }, { ownerId: 'x'.repeat(65), sessionId: 's', request: { kind: 'view' } }]) {
      await assert.rejects(run(body), e => e.status === 400 && typeof e.code === 'string', JSON.stringify(body));
    }
    // an unknown request kind is answered by the pipeline as an error event, nothing saved
    const out = await h.chat({ ownerId: 'userA', sessionId: 'z', request: { kind: 'nope' } }, () => {});
    assert.deepEqual(out.events, [{ type: 'error', code: 'invalid_request' }]);
  });

  test(`[${name}] an unexpected failure is reported as {error: internal} without its message (could hold user text)`, async () => {
    const store = make();
    const boom = { runPipelineTurn: async () => { throw new Error('secret 사용자 문장'); } };
    const h = createHandlers({ store, products, pipeline: boom });
    const out = await h.chat({ ownerId: 'u', sessionId: 's', request: { kind: 'view' } }, () => {});
    assert.deepEqual(out.events, [{ type: 'error', code: 'internal' }]);
    assert.ok(!JSON.stringify(out).includes('secret'));
  });

  test(`[${name}] GET /recipients and /memory/:id are scoped to the owner (AC6)`, async () => {
    const { h, ready } = setup(make);
    const { mom } = await ready;
    const list = await h.route({ method: 'GET', path: '/recipients', query: { ownerId: 'userA' } });
    assert.equal(list.status, 200);
    assert.deepEqual(list.json.recipients.map(r => r.name).sort(), ['민지', '아버지', '어머니']);
    assert.deepEqual((await h.route({ method: 'GET', path: '/recipients', query: { ownerId: 'userB' } })).json.recipients.map(r => r.name), ['교수님']);
    const mem = await h.route({ method: 'GET', path: `/memory/${mom.id}`, query: { ownerId: 'userA' } });
    assert.equal(mem.status, 200);
    assert.deepEqual(mem.json.memories.map(m => m.label).sort(), ['단 음식 X', '땅콩 제외']);
    assert.ok(mem.json.memories.every(m => m.evidence && m.status === 'confirmed'));
    assert.equal((await h.route({ method: 'GET', path: `/memory/${mom.id}`, query: { ownerId: 'userB' } })).status, 404, 'another owner sees nothing');
    assert.equal((await h.route({ method: 'GET', path: '/memory/x', query: {} })).status, 400, 'ownerId is required');
  });

  test(`[${name}] AC9: DELETE removes the row for real; PUT edits evidence only and never weakens an allergy`, async () => {
    const { h, store, ready } = setup(make);
    const { mom } = await ready;
    const [sweet, peanut] = [(await store.listMemories('userA', mom.id)).find(m => m.key === 'pref:less_sweet'), (await store.listMemories('userA', mom.id)).find(m => m.key === 'allergy:땅콩')];
    const put = (id, patch, ownerId = 'userA') => h.route({ method: 'PUT', path: `/memory/${id}`, body: { ownerId, patch } });
    assert.equal((await put(sweet.id, { evidence: '단 거 안 좋아하셔' })).status, 200);
    assert.equal((await put(sweet.id, { key: 'pref:unsweetened' })).status, 400, 'key is identity');
    assert.equal((await put(peanut.id, { polarity: 1 })).status, 409, 'an allergy cannot be weakened');
    assert.equal((await put(sweet.id, { evidence: 'x' }, 'userB')).status, 404, 'not the owner');
    assert.equal((await h.route({ method: 'DELETE', path: `/memory/${sweet.id}`, query: { ownerId: 'userB' } })).status, 404);
    assert.ok(await store.getMemory('userA', sweet.id), 'still there');
    assert.deepEqual((await h.route({ method: 'DELETE', path: `/memory/${sweet.id}`, query: { ownerId: 'userA' } })).json, { deleted: true });
    assert.equal(await store.getMemory('userA', sweet.id), null, 'really gone (AC9)');
    assert.equal((await h.route({ method: 'DELETE', path: `/memory/${sweet.id}`, query: { ownerId: 'userA' } })).status, 404);
    // the next recommendation no longer uses it
    const { events } = await h.chat({ ownerId: 'userA', sessionId: 'n', request: { kind: 'message', text: PARENTS } }, () => {});
    assert.ok(!events.find(e => e.type === 'cards').banner.text.includes('단 음식 X'));
  });

  test(`[${name}] AC4: S1 -> "기억할까요?" -> POST /memory/confirm saves with evidence; declining saves nothing`, async () => {
    for (const accept of [true, false]) {
      const { h, store, chat, ready } = setup(make, { seed: false, replies: [S1_REPLY] });
      await ready;
      await chat({ request: { kind: 'message', text: S1 } }, () => {});
      const end = await chat({ request: { kind: 'end_session' } }, () => {});
      const prompt = end.events.find(e => e.type === 'memory_prompt' && e.kind === 'remember');
      assert.ok(prompt, 'the session end asks once');
      const res = await h.route({ method: 'POST', path: '/memory/confirm', body: { ownerId: 'userA', sessionId: 's', accept } });
      assert.equal(res.status, 200, JSON.stringify(res.json));
      const rows = (await Promise.all((await store.listRecipients('userA')).map(r => store.listMemories('userA', r.id)))).flat().filter(m => m.status === 'confirmed');
      if (accept) { assert.ok(rows.length >= 2); assert.ok(rows.every(m => m.evidence.length > 0)); } else assert.equal(rows.length, 0, 'declined: nothing stored');
    }
    const { h, ready } = setup(make);
    await ready;
    assert.equal((await h.route({ method: 'POST', path: '/memory/confirm', body: { ownerId: 'userA', sessionId: 'none', accept: true } })).status, 400, 'no pending candidates');
    assert.equal((await h.route({ method: 'POST', path: '/memory/confirm', body: { ownerId: 'userA', sessionId: 's', accept: 'yes' } })).status, 400);
  });

  test(`[${name}] POST /feedback runs the pipeline feedback and answers with its events`, async () => {
    const { h, chat, ready } = setup(make);
    await ready;
    await chat({ request: { kind: 'message', text: PARENTS } }, () => {});
    const ok = await h.route({ method: 'POST', path: '/feedback', body: { ownerId: 'userA', sessionId: 's', productId: 'hiking-socks', action: 'chosen' } });
    assert.equal(ok.status, 200);
    assert.ok(ok.json.events.some(e => e.type === 'cards'));
    assert.equal((await h.route({ method: 'POST', path: '/feedback', body: { ownerId: 'userA', sessionId: 's', productId: 'nope', action: 'chosen' } })).status, 400);
    assert.equal((await h.route({ method: 'POST', path: '/feedback', body: { ownerId: 'userA', sessionId: 's', productId: 'hiking-socks', action: 'bought' } })).status, 400);
  });

  test(`[${name}] AC15 over the server: ladder_compare changes nothing; ladder_pick down changes the budget`, async () => {
    const { chat, store, ready } = setup(make);
    await ready;
    await chat({ request: { kind: 'message', text: '친구 한 세트 총예산 3만원 이하 상품값만 추천' } }, () => {});
    const before = await store.getSession('userA', 's');
    const down = (await chat({ request: { kind: 'view' } }, () => {})).events.find(e => e.type === 'explanations').items[0].ladderChips?.find(c => c.direction === 'down');
    assert.ok(down, 'precondition: an 아끼기 chip');
    assert.deepEqual((await store.getSession('userA', 's')).session.state, before.session.state, 'viewing options changes nothing');
    const picked = await chat({ request: { kind: 'ladder_pick', direction: 'down' } }, () => {});
    assert.equal((await store.getSession('userA', 's')).session.state.budget.amount_krw, down.amount_krw);
    assert.ok(picked.events.some(e => e.type === 'cards'));
  });
}

test('routing: unknown path 404, wrong method 405, body limit constant', async () => {
  const { h } = setup();
  assert.equal((await h.route({ method: 'GET', path: '/nope' })).status, 404);
  assert.equal((await h.route({ method: 'POST', path: '/recipients', body: {} })).status, 405);
  assert.deepEqual((await h.route({ method: 'GET', path: '/health' })).json, { ok: true });
  assert.ok(MAX_BODY_BYTES <= 64 * 1024);
});

// http adapter with in-memory req/res doubles (no socket)
function fakeReq(method, url, body) {
  const listeners = {};
  const req = { method, url, on(ev, fn) { listeners[ev] = fn; return req; }, destroy() { req.destroyed = true; } };
  queueMicrotask(() => { if (body !== undefined) listeners.data?.(Buffer.from(typeof body === 'string' ? body : JSON.stringify(body))); listeners.end?.(); });
  return req;
}
function fakeRes() {
  const r = { head: null, chunks: [], ended: false, writeHead(s, h) { r.head = { status: s, headers: h }; }, write(c) { r.chunks.push(c); }, end(c) { if (c) r.chunks.push(c); r.ended = true; } };
  return r;
}

test('http adapter: /chat answers text/event-stream with one frame per event; JSON routes answer JSON; bad input never streams', async () => {
  const { h, ready } = setup();
  await ready;
  const listener = createListener(h, { origin: 'http://localhost:8081' });
  const res = fakeRes();
  await listener(fakeReq('POST', '/chat', { ownerId: 'userA', sessionId: 's', request: { kind: 'message', text: PARENTS } }), res);
  assert.equal(res.head.status, 200);
  assert.match(res.head.headers['content-type'], /text\/event-stream/);
  assert.equal(res.head.headers['access-control-allow-origin'], 'http://localhost:8081');
  const text = res.chunks.join('');
  assert.deepEqual([...text.matchAll(/^event: (\w+)$/gm)].map(m => m[1]), ['cards', 'conditions', 'explanations']);
  const cond = JSON.parse(/event: conditions\ndata: (.*)\n/.exec(text)[1]);
  assert.deepEqual(cond.conditions.recipients, ['부모님']);
  assert.equal(cond.conditions.budget.amount_krw, 50000);
  assert.ok(!('quantity' in cond.conditions));
  assert.ok(text.indexOf('event: cards') < text.indexOf('event: explanations'));
  assert.ok(res.ended);

  const invalid = fakeRes();
  await listener(fakeReq('POST', '/chat', { ownerId: 'bad id', sessionId: 's', request: { kind: 'view' } }), invalid);
  assert.equal(invalid.head.status, 400);
  assert.match(invalid.head.headers['content-type'], /application\/json/);
  assert.deepEqual(JSON.parse(invalid.chunks.join('')), { error: 'invalid_owner' });

  const notJson = fakeRes();
  await listener(fakeReq('POST', '/chat', '{oops'), notJson);
  assert.deepEqual([notJson.head.status, JSON.parse(notJson.chunks.join(''))], [400, { error: 'invalid_json' }]);

  const big = fakeRes();
  await listener(fakeReq('POST', '/chat', 'x'.repeat(MAX_BODY_BYTES + 1)), big);
  assert.equal(big.head.status, 413);

  const get = fakeRes();
  await listener(fakeReq('GET', '/health'), get);
  assert.deepEqual([get.head.status, JSON.parse(get.chunks.join(''))], [200, { ok: true }]);
  const pre = fakeRes();
  await listener(fakeReq('OPTIONS', '/chat'), pre);
  assert.equal(pre.head.status, 204);
});
