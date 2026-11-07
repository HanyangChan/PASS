// P10 app service layer (PROTO-REBASE §4 A2~A4): the pure client of app/src/services/pipelineEvents.mjs and main's serverChatService.ts
// (patched: body fields, `post`, pipeline block check) run against the REAL server handlers through a fake fetch. No React, no network.
// AC4 (기억할까요?), AC5 (S2), AC9 (기억 삭제), AC15 (아끼기·올리기), plus the app's own rules (version, hidden cards, recipient chip, device memory off).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandlers } from '../server/index.mjs';
import { createPipeline } from '../pipeline/index.mjs';
import { singleInitial } from '../proto/lib/single-gift.mjs';
import { createServerChatService, resolveChatUrl, assertTurn } from '../app/src/services/serverChatService.ts';
import {
  createPipelineClient, emptyPipeline, foldFull, foldSide, foldExplain, withoutHidden, bodyFor, toBaselinePatch, validPipelineBlock,
  resolvePipelineUrl, validParticipantId, participantAuth, errorText,
} from '../app/src/services/pipelineEvents.mjs';
import { stores, seedPeople, seedS1Memories } from './fixtures/people.mjs';
import { fakeGemini, protoState } from './fixtures/proto-llm.mjs';
import { products } from './fixtures/catalog.mjs';

const NOW = () => '2027-01-25T03:00:00.000Z';
const PARENTS = '부모님 한 세트 세트당 예산 5만원 이하 배송비 포함 추천';
const START = { state: singleInitial(), issues: [] };

const S1 = '추석 선물이야. 엄마는 단 거 싫어하시고 땅콩 알레르기, 아빠는 등산 좋아하셔. 5만 원';
const S1_REPLY = {
  state: protoState({ recipients: ['어머니', '아버지'], occasion: '추석', budget: { amount_krw: 50000 }, preferences: ['less_sweet'], excluded_ingredients: ['땅콩'] }),
  memory: [
    { recipient: '엄마', key: 'pref:less_sweet', polarity: 1, evidence: '엄마는 단 거 싫어하시고' },
    { recipient: '엄마', key: 'allergy:땅콩', polarity: -1, evidence: '땅콩 알레르기' },
    { recipient: '아빠', key: 'hobby:등산', polarity: 1, evidence: '아빠는 등산 좋아하셔' },
  ],
};

/** The app's client over the real handlers: the fake fetch hands the request body to the server and returns its JSON. */
function harness({ seed = true, replies, experiment = 'B', participant = 'userA', catalog = products } = {}) {
  const store = stores.memory();
  const dialogue = replies ? fakeGemini(replies) : null;
  const pipeline = createPipeline({ store, products: catalog, dialogueLlm: dialogue?.llm ?? null, now: NOW });
  const h = createHandlers({ store, products: catalog, pipeline });
  const requests = [];
  const fetcher = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const res = await h.route({ method: 'POST', path: new URL(url).pathname, body });
    return { ok: res.status < 400, status: res.status, json: async () => res.json };
  };
  const turns = [], views = [];
  let n = 0;
  const client = createPipelineClient({
    makeBase: fields => createServerChatService('http://127.0.0.1:8787/api/chat', participantAuth(participant), participant, fetcher, () => ({ participant_id: participant, ...fields() })),
    experiment, newId: () => `conv-${++n}`, onTurn: t => turns.push(t), onView: v => views.push(v),
  });
  const ready = (async () => { const people = await seedPeople(store); if (seed) await seedS1Memories(store, people); return people; })();
  // what the App does with `chat.send`: the screens' session (as the server last answered) goes back in
  let session = START;
  const send = async (text, source = 'typed') => { const t = await client.chat.send(session, text, [], source); session = t.session; return t; };
  const conditions = async patch => { const t = await client.chat.updateConditions(session, patch); session = t.session; return t; };
  return { store, client, requests, turns, views, ready, send, conditions, get session() { return session; }, set session(v) { session = v; } };
}

const ids = turn => turn.view.result.items.map(p => p.id);

// ---- pure helpers -------------------------------------------------------------------------------------------------

test('server address and participant id rules (K7: local experiment only; A2 resolveChatUrl takes the private network)', () => {
  assert.equal(resolvePipelineUrl(''), null);
  for (const ok of ['http://127.0.0.1:8787', 'http://localhost:8787/', 'http://192.168.0.12:8787', 'http://10.0.0.5:8787', 'http://172.20.1.1:8787', 'https://pipeline.example.com']) assert.ok(resolvePipelineUrl(ok), ok);
  for (const bad of ['http://example.com', 'http://172.32.0.1:8787', 'https://u:p@example.com', 'https://example.com/chat', 'https://example.com/?k=1', 'ftp://127.0.0.1']) assert.throws(() => resolvePipelineUrl(bad), Error, bad);
  assert.equal(resolveChatUrl('http://192.168.0.12:8787', true), 'http://192.168.0.12:8787/api/chat');
  assert.throws(() => resolveChatUrl('http://192.168.0.12:8787'), /HTTPS/, "main's rule is unchanged without the flag");
  assert.equal(resolveChatUrl('http://127.0.0.1:8787'), 'http://127.0.0.1:8787/api/chat');
  assert.throws(() => resolveChatUrl('http://example.com', true), /HTTPS/);
  assert.deepEqual(['p01', 'user.A-1', 'a:b'].map(validParticipantId), [true, true, true]);
  assert.deepEqual(['', 'a b', '한글', 'x'.repeat(65), null].map(validParticipantId), [false, false, false, false, false]);
});

test('toBaselinePatch keeps only condition fields and drops empty budget parts', () => {
  assert.deepEqual(toBaselinePatch({ recipients: ['친구'], budget: { amount_krw: 30000, shipping_included: null }, quantity: 5, evil: 1 }), { recipients: ['친구'], budget: { amount_krw: 30000 } });
  assert.deepEqual(toBaselinePatch({ budget: { amount_krw: null, shipping_included: null }, preferences: ['less_sweet'] }), { preferences: ['less_sweet'] });
  assert.deepEqual(toBaselinePatch(undefined), {});
});

test('bodyFor maps every request of the extra UI onto a server operation (and nothing else)', () => {
  assert.deepEqual(bodyFor({ kind: 'end_session' }), { operation: 'end_session' });
  assert.deepEqual(bodyFor({ kind: 'memory_confirm', accept: false }), { operation: 'end_session', accept: false });
  assert.deepEqual(bodyFor({ kind: 'memory_confirm', accept: true, indexes: [0] }), { operation: 'end_session', accept: true, indexes: [0] });
  assert.deepEqual(bodyFor({ kind: 'ladder_pick', direction: 'down' }), { operation: 'feedback', kind: 'ladder_save' });
  assert.deepEqual(bodyFor({ kind: 'ladder_compare', productId: 'p1' }), { operation: 'feedback', kind: 'ladder_compare', product_id: 'p1' });
  assert.deepEqual(bodyFor({ kind: 'feedback', action: 'chosen', productId: 'p1' }), { operation: 'feedback', kind: 'chosen', product_id: 'p1' });
  assert.deepEqual(bodyFor({ kind: 'feedback', action: 'dismissed', productId: 'p1' }), { operation: 'feedback', kind: 'dismissed', product_id: 'p1' });
  assert.equal(bodyFor({ kind: 'feedback', action: 'dismissed', productId: 'p1', scope: 'product' }).kind, 'dismiss_one');
  assert.equal(bodyFor({ kind: 'feedback', action: 'dismissed', productId: 'p1', scope: 'category' }).kind, 'dismiss_kind');
  assert.deepEqual(bodyFor({ kind: 'feedback', action: 'satisfaction', giftId: 'g', satisfaction: 4 }), { operation: 'feedback', kind: 'satisfaction', gift_id: 'g', satisfaction: 4 });
  assert.deepEqual(bodyFor({ kind: 'memory_edit', op: 'delete', memoryId: 'm1' }), { operation: 'memory', action: 'delete', in_session: true, memory_id: 'm1' });
  assert.deepEqual(bodyFor({ kind: 'memory_edit', op: 'update', memoryId: 'm1', patch: { strength: 1 } }), { operation: 'memory', action: 'edit', in_session: true, memory_id: 'm1', patch: { strength: 1 } });
  assert.deepEqual(bodyFor({ kind: 'memory_edit', op: 'accept_suggested', memoryIds: ['a', 'b'] }), { operation: 'memory', action: 'accept_suggested', in_session: true, memory_ids: ['a', 'b'] });
  assert.deepEqual(bodyFor({ kind: 'memory_edit', op: 'sensitivity', accept: true }), { operation: 'memory', action: 'sensitivity', in_session: true, accept: true });
  assert.equal(bodyFor({ kind: 'patch', patch: {} }), null, 'a conditions change is not one of these');
});

test('the pipeline block: shape check, full answers replace the view and keep the tray, side answers keep the cards, explain only fits its own version', () => {
  assert.equal(validPipelineBlock({ tags: { a: ['x'] }, memory_prompts: [{ kind: 'remember' }], hidden_product_ids: [], ladder: [{ label: 'l' }], contrast: 'c' }), true);
  for (const bad of [null, [], { tags: { a: 'x' } }, { memory_prompts: [{}] }, { hidden_product_ids: [1] }, { ladder: [1] }, { contrast: 3 }]) assert.equal(validPipelineBlock(bad), false, JSON.stringify(bad));
  let v = foldFull(emptyPipeline(), { version: 2, experiment: 'B', banner: { text: '반영' }, tags: { a: ['t'] }, gift_history: { a: { label: '작년' } }, contrast: 'c', ladder: [{ label: 'l', direction: 'down' }],
    memory_prompts: [{ kind: 'remember' }], compare_add: { productId: 'p', product: { id: 'p', name: 'P' }, costDelta: 5000, rating: { from: 4, to: 4.5 }, againstId: 'a' } });
  assert.deepEqual([v.version, v.banner.text, v.tags.a, v.giftHistory.a.label, v.compare.map(c => c.id), v.prompts.length], [2, '반영', ['t'], '작년', ['p'], 1]);
  const again = foldFull(v, { version: 3, tags: { b: ['u'] }, compare_add: { product: { id: 'p', name: 'P' }, costDelta: 5000 } });
  assert.deepEqual([again.version, Object.keys(again.tags), again.banner, again.contrast, again.prompts, again.compare.length], [3, ['b'], null, null, [], 1], 'a new answer replaces everything except the tray (once per product)');
  const side = foldSide(again, { memory_prompts: [{ kind: 'suggested' }] });
  assert.deepEqual([side.prompts.map(p => p.kind), Object.keys(side.tags), side.version], [['suggested'], ['b'], 3], 'cards and tags stay');
  assert.equal(foldExplain(again, { version: 2, tags: { b: ['old'] } }), again, 'wording made for other cards is ignored');
  assert.deepEqual(foldExplain(again, { version: 3, tags: { b: ['llm'] }, explanation_source: 'llm' }).tags.b, ['llm']);
  const turn = { view: { result: { items: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], message: '' } } };
  assert.deepEqual(withoutHidden(turn, ['b']).view.result.items.map(i => i.id), ['a', 'c'], 'hiding never reorders');
  assert.equal(withoutHidden(turn, []), turn);
  assert.ok(errorText('version_conflict').includes('다시'));
  assert.ok(errorText('whatever'));
});

test("serverChatService (A2): body = main's + the extra fields; main's checks plus the pipeline block; main's messages for failures", async () => {
  const sent = [];
  const answer = (status, json) => async (url, options) => { sent.push(JSON.parse(options.body)); return { ok: status < 400, status, json: async () => json }; };
  const owner = 'p1';
  const make = (fetcher, extra) => createServerChatService('http://127.0.0.1:8787/api/chat', participantAuth(owner), owner, fetcher, extra);
  const h = harness();
  await h.ready;
  const real = await h.send(PARENTS);
  assert.doesNotThrow(() => assertTurn(real));
  assert.throws(() => assertTurn({ ...real, pipeline: { tags: { a: 'x' } } }), /형식/, 'a wrong pipeline block is a server/app mismatch');
  assert.throws(() => assertTurn({ ...real, mode: 'sse' }), /형식/);
  assert.equal(h.requests[0].participant_id, 'userA');
  assert.equal(h.requests[0].session_id, 'conv-1');
  assert.equal(h.requests[0].experiment, 'B');
  assert.equal(h.requests[0].operation, 'turn');
  const svc = make(answer(409, { error: 'x', code: 'version_conflict' }), () => ({ session_id: 'z' }));
  await assert.rejects(svc.view(START), /다른 화면에서 내용이 바뀌었어요/);
  assert.equal(sent[0].session_id, 'z');
  await assert.rejects(make(answer(503, {})).send(START, 'x', []), /연결하지 못했어요/);
  const raw = await make(answer(200, { pipeline: { version: 1, tags: {} } })).post({ operation: 'explain' });
  assert.equal(raw.pipeline.version, 1, 'post() answers that carry no cards are not held to the turn checks');
  await assert.rejects(make(answer(200, { view: {}, session: {} })).post({ operation: 'feedback', kind: 'chosen' }), /형식/, 'but an answer with a view must be a whole turn');
});

// ---- the client against the real server ----------------------------------------------------------------------------

test('AC5 + AC3: S2 "부모님 …" shows the cards with the 반영 한 줄 and tags in ONE answer; the explain follow-up only changes the words', async () => {
  const h = harness();
  await h.ready;
  const turn = await h.send(PARENTS);
  assert.equal(turn.view.result.items.length, 3);
  assert.equal(h.views.at(-1).banner.text, '지난 기억을 반영했어요: 단 음식 X · 땅콩 제외 · 등산');
  assert.ok(turn.view.result.items.every(p => (h.client.view.tags[p.id] ?? []).length >= 1), 'template tags came with the cards');
  assert.ok(h.client.view.contrast, 'B: contrast chip');
  assert.equal(h.requests.filter(r => r.operation === 'explain').length, 1, 'the wording is asked for after the cards, once');
  const cardsBefore = ids(turn);
  await h.client.idle();
  assert.equal(h.client.view.version, turn.session.version, 'the follow-up belongs to the cards on screen');
  assert.deepEqual(ids(h.turns.at(-1) ?? turn), cardsBefore);
  assert.equal(h.turns.length, 0, 'explain is not shown as a turn: only the extra view changes');
  assert.equal(h.requests.find(r => r.operation === 'explain').item_ids.join(), cardsBefore.join());
});

test('B vs A: A has no price options / contrast / memory counterfactual / budget comparison in what the app receives (AC12)', async () => {
  const b = harness({ seed: false });
  const a = harness({ seed: false, experiment: 'A' });
  await Promise.all([a.ready, b.ready]);
  const text = '친구 한 세트 총예산 3만원 이하 상품값만 추천';
  const tb = await b.send(text), ta = await a.send(text);
  assert.deepEqual(ids(ta), ids(tb), 'same cards');
  assert.deepEqual([a.client.view.contrast, a.client.view.memoryCf, a.client.view.ladder, a.client.view.ladderNotice], [null, null, null, null]);
  assert.ok(b.client.view.ladder?.length, 'B has the 아끼기/올리기 chips');
  assert.deepEqual(ta.view.comparison.alternatives, []);
});

test("the app never sends a stale version: 찜 feedback and an explain between two turns do not cause a conflict", async () => {
  const h = harness();
  await h.ready;
  const first = await h.send(PARENTS);
  await h.client.feedback('chosen', ids(first)[0]);
  await h.client.idle();
  const next = await h.conditions({ budget: { amount_krw: 40000 } });
  assert.equal(next.session.state.budget.amount_krw, 40000);
  assert.ok(h.requests.filter(r => r.operation === 'conditions').every(r => r.session.version === undefined || Number.isSafeInteger(r.session.version)));
  // the server's version moved; the app's session still carries an older one: the client sends the latest it saw
  h.session = { ...h.session, version: 0 };
  const again = await h.conditions({ budget: { amount_krw: 45000 } });
  assert.equal(again.session.state.budget.amount_krw, 45000);
});

test('AC4: S1 -> "새 대화" asks 기억할까요? -> 수락하면 근거 문장과 함께 저장, 거절하면 아무것도 저장하지 않는다; 다음 대화는 새 세션 id', async () => {
  for (const accept of [true, false]) {
    const h = harness({ seed: false, replies: [S1_REPLY] });
    await h.ready;
    await h.send(S1);
    assert.equal(h.client.sessionId, 'conv-1');
    await h.client.end();
    const prompt = h.client.view.prompts.find(p => p.kind === 'remember');
    assert.ok(prompt, 'the session end asks once');
    assert.equal(h.client.view.ended, true);
    await h.client.act({ kind: 'memory_confirm', accept });
    const rows = (await Promise.all((await h.store.listRecipients('userA')).map(r => h.store.listMemories('userA', r.id)))).flat().filter(m => m.status === 'confirmed');
    if (accept) { assert.ok(rows.length >= 2); assert.ok(rows.every(m => m.evidence.length > 0)); assert.ok(h.client.view.saved.saved.length >= 2); } else assert.equal(rows.length, 0, 'declined: nothing stored');
    h.client.reset();
    assert.equal(h.client.sessionId, 'conv-2');
    assert.deepEqual([h.client.view.version, h.client.view.prompts, h.client.view.compare, h.client.view.banner], [null, [], [], null], 'the next conversation starts empty');
  }
});

test('AC9: deleting a remembered thing (from the banner [수정]) removes it from the DB and the next cards drop it', async () => {
  const h = harness();
  await h.ready;
  await h.send(PARENTS);
  const item = h.client.view.banner.items.find(m => m.label.includes('등산'));
  assert.ok(item, 'precondition: 등산 is on the 반영 한 줄');
  assert.ok(await h.store.getMemory('userA', item.memoryId));
  const turn = await h.client.act({ kind: 'memory_edit', op: 'delete', memoryId: item.memoryId });
  assert.equal(await h.store.getMemory('userA', item.memoryId), null, 'really gone from the DB');
  assert.ok(turn, 'the answer carries the cards of the session as it is now');
  assert.ok(!h.client.view.banner?.text.includes('등산'));
  assert.ok(!(turn.session.state.preferences ?? []).some(p => p.includes('hiking') || p.includes('등산')));
  assert.equal(h.turns.at(-1), turn, 'and the screens show it');
});

test('A3: the memory panel lists the participant\'s people and memories and deletes through operation=memory (my-page edit needs no session)', async () => {
  const h = harness();
  await h.ready;
  const { recipients } = await h.client.memory.people();
  assert.ok(recipients.length >= 2);
  const mom = recipients.find(r => r.name === '어머니');
  const { memories } = await h.client.memory.of(mom.id);
  assert.ok(memories.length >= 1 && memories.every(m => typeof m.label === 'string'));
  const res = await h.client.memory.remove(memories[0].id);
  assert.deepEqual(res, { deleted: true }, 'no conversation yet: DB only');
  assert.equal((await h.client.memory.of(mom.id)).memories.length, memories.length - 1);
  assert.equal(h.requests.at(-2).session_id, h.client.sessionId, 'always inside this participant\'s conversation id');
});

test('AC15 in the app: 올리기 only fills the tray (budget and cards unchanged), 아끼기 changes the budget and shows the new cards', async () => {
  // a catalog with ratings (the shared fixture has none): r-up has the same engine score as r-top, a higher rating, +6,000원 (K50)
  const base = { stock_sets: 20, arrival_date: '2026-12-01', brand: '데모', packaging: 'basic', allergens_declared: [], shipping_fee_per_set_krw: 0, sweetness: 'unknown', category: 'coffee_tea' };
  const rated = [
    { ...base, id: 'r-top', name: '기본 차 세트', price_krw: 20000, rating_count: 1000, rating: 4.0 },
    { ...base, id: 'r-up', name: '평점 높은 차 세트', price_krw: 26000, rating_count: 500, rating: 4.6 },
    { ...base, id: 'r-low', name: '저렴한 차 세트', price_krw: 15000, rating_count: 200, rating: 3.8 },
  ];
  const h = harness({ seed: false, catalog: rated });
  await h.ready;
  const first = await h.send('친구 한 세트 총예산 7만원 이하 상품값만 추천');
  const down = h.client.view.ladder.find(c => c.direction === 'down'), up = h.client.view.ladder.find(c => c.direction === 'up');
  assert.ok(down, 'precondition: an 아끼기 chip');
  assert.ok(up, 'precondition: an 올리기 chip');
  {
    const cmp = await h.client.act({ kind: 'ladder_compare', productId: up.productId });
    assert.equal(cmp.session.state.budget.amount_krw, first.session.state.budget.amount_krw, 'the budget did not move');
    assert.deepEqual(ids(cmp), ids(first), 'nor did the cards');
    assert.deepEqual(h.client.view.compare.map(c => c.id), [up.productId], 'the product is in the tray');
    assert.ok(h.client.view.compare[0].name);
  }
  const picked = await h.client.act({ kind: 'ladder_pick', direction: 'down' });
  assert.equal(picked.session.state.budget.amount_krw, down.amount_krw);
  assert.equal(h.turns.at(-1), picked, 'the screens show the cards of the new budget');
});

test('"이 상품만 빼기" hides the card on the app side (order of the rest unchanged) and keeps it hidden on later turns (K45)', async () => {
  const h = harness();
  await h.ready;
  const first = await h.send(PARENTS);
  const [a, ...rest] = ids(first);
  const ask = await h.client.act({ kind: 'feedback', action: 'dismissed', productId: a });
  assert.deepEqual(ids(ask), ids(first), 'asking changes no card');
  assert.ok(h.client.view.prompts.some(p => p.kind === 'dismiss_scope'), 'asks 이 상품만 / 이런 종류 모두');
  const shown = await h.client.act({ kind: 'feedback', action: 'dismissed', productId: a, scope: 'product' });
  assert.deepEqual(ids(shown), rest);
  const later = await h.conditions({ budget: { amount_krw: 55000 } });
  assert.ok(!ids(later).includes(a), 'still hidden after the next turn');
});

test('a "두 분 함께 / 어머니만" chip goes out as recipient_choice of a conditions request, never as a sentence (K36)', async () => {
  const calls = [];
  const turn = { session: { state: singleInitial(), issues: [], version: 4 }, message: '', mode: 'rules', view: { question: { key: null, text: '', choices: [] }, result: { items: [], message: '' }, comparison: { alternatives: [] } },
    pipeline: { version: 4, recipient_choices: [{ label: '두 분 함께', choice: 'both' }, { label: '어머니만', choice: 'one:어머니' }] } };
  const base = { send: async (...a) => { calls.push(['send', ...a]); return turn; }, updateConditions: async (...a) => { calls.push(['conditions', ...a]); return turn; }, view: async () => turn, post: async () => ({}) };
  const client = createPipelineClient({ makeBase: () => base, experiment: 'B', newId: () => 'c1' });
  await client.chat.send(START, '부모님 선물 추천해줘', []);
  assert.deepEqual(calls.map(c => c[0]), ['send']);
  await client.chat.send(turn.session, '어머니만', [], 'quick_reply');
  assert.deepEqual(calls.map(c => c[0]), ['send', 'conditions'], 'the label is not sent as a message');
  assert.deepEqual(calls[1][2], {}, 'an empty patch');
});

test('one-shot body fields: recipient_choice / sensitivity / confirmed_releases go out with exactly one request', async () => {
  const seen = [];
  const turn = { session: { state: singleInitial(), issues: [], version: 1 }, message: '', mode: 'rules', view: { question: { key: null, text: '', choices: [] }, result: { items: [], message: '' }, comparison: { alternatives: [] } }, pipeline: { version: 1, recipient_choices: [{ label: '어머니만', choice: 'one:어머니' }] } };
  let fields;
  const base = { send: async () => turn, view: async () => turn, post: async () => ({}), updateConditions: async () => { seen.push(fields({ operation: 'conditions' })); return turn; } };
  const client = createPipelineClient({ makeBase: f => { fields = f; return base; }, experiment: 'A', newId: () => 'c9' });
  await client.chat.send(START, '부모님', []);
  await client.chat.send(turn.session, '어머니만', [], 'quick_reply');
  await client.act({ kind: 'patch', patch: { excluded_ingredients: [] }, confirmedReleases: ['땅콩'], sensitivity: 'value' });
  assert.deepEqual(seen[0], { session_id: 'c9', experiment: 'A', recipient_choice: 'one:어머니' });
  assert.deepEqual(seen[1], { session_id: 'c9', experiment: 'A', confirmed_releases: ['땅콩'], sensitivity: 'value' });
  assert.deepEqual(fields({ operation: 'conditions' }), { session_id: 'c9', experiment: 'A' }, 'nothing is left over for the next request');
  assert.deepEqual(fields({ operation: 'feedback' }), { session_id: 'c9', experiment: 'A' }, 'and another operation never takes them');
});

test('an error of the server reaches the caller with the app\'s sentence; a failed explain is silent and leaves the template tags', async () => {
  const h = harness();
  await h.ready;
  await h.send(PARENTS);
  await h.client.idle();
  const tags = h.client.view.tags;
  const real = h.requests.length;
  await assert.rejects(h.client.act({ kind: 'memory_edit', op: 'delete', memoryId: 'no-such-memory' }), /찾을 수 없|추천 요청에 실패/);
  assert.ok(h.requests.length > real);
  assert.deepEqual(h.client.view.tags, tags);
  await assert.rejects(h.client.act({ kind: 'nope' }), /지원하지 않는/);
  const lone = harness();
  await lone.ready;
  await assert.rejects(lone.client.act({ kind: 'patch', patch: {} }), /먼저 대화를/, 'a chip before any answer has no session to change');
});

test('A3: the device-side memory (recall, allergy guard, recipient check) is off in this mode, a recipient change in a patch still goes through', async () => {
  process.env.EXPO_PUBLIC_PIPELINE_URL = 'http://127.0.0.1:8787';
  try {
    const mod = await import('../app/src/services/personalization.ts?pipeline-mode');
    assert.equal(mod.deviceMemoryOff, true);
    const session = { state: { ...singleInitial(), recipients: ['어머니'], excluded_ingredients: ['땅콩'] }, issues: [] };
    const data = { ...mod.emptyPersonalization(), memories: [{ recipient: '어머니', preferences: ['tea'], excluded_categories: [], excluded_ingredients: ['땅콩', '우유'], updated_at: NOW() }] };
    const out = mod.personalizeSession(session, data, '엄마 선물');
    assert.deepEqual([out.session, out.reasons], [session, []], 'nothing recalled from the device');
    assert.deepEqual(mod.personalizeSession(session, data, '', ['아버지']).session.state.recipients, ['아버지']);
    assert.equal(mod.protectRememberedAllergies(session, data), session);
    assert.doesNotThrow(() => mod.assertSameRecipient(session, { state: { ...session.state, recipients: ['부모님'] }, issues: [] }));
  } finally { delete process.env.EXPO_PUBLIC_PIPELINE_URL; }
});

test('the first request of a new app start is a view of an empty session: it answers main\'s initial question and saves nothing odd', async () => {
  const h = harness({ seed: false });
  await h.ready;
  const turn = await h.client.chat.view(START);
  assert.ok(turn.view.question.key && turn.view.question.text.length > 0, 'main asks first; the screens show no cards while a question is pending');
  assert.equal(h.requests.filter(r => r.operation === 'explain').length, 0, 'no cards on screen, no wording request');
});

test('AC7 in the app: sending excluded_ingredients: [] never drops a remembered allergy; unchanged cards are not re-explained', async () => {
  const h = harness();
  await h.ready;
  await h.send(PARENTS);
  await h.client.idle();
  const explains = h.requests.filter(r => r.operation === 'explain').length;
  const tags = h.client.view.tags;
  const t = await h.conditions({ excluded_ingredients: [] });
  assert.ok(t.session.state.excluded_ingredients.includes('땅콩'), 'the server keeps the remembered allergy');
  await h.client.feedback('chosen', ids(t)[0]);
  await h.client.end();
  await h.client.idle();
  assert.ok(h.requests.filter(r => r.operation === 'explain').length <= explains + 1, 'at most the one explain of the changed conditions; 찜 and 새 대화 ask for none');
  assert.deepEqual(h.client.view.tags, tags, 'same cards: the words stay');
});
