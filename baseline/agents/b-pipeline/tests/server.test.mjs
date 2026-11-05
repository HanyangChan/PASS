// P9 server contract (PROTO-REBASE §2, K57, K74): main's /api/chat request/response + one `pipeline` block, no streaming.
// Handlers are called directly (no socket, no network). Fake LLM only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, runTurn } from '../../../src/index.mjs';
import { createHandlers, createListener, MAX_BODY_BYTES } from '../server/index.mjs';
import { createPipeline } from '../pipeline/index.mjs';
import { validateState } from '../proto/lib/llm.mjs';
import { singleInitial } from '../proto/lib/single-gift.mjs';
import { recommendationView } from '../proto/api/worker.mjs';
import { stores, seedPeople, seedS1Memories } from './fixtures/people.mjs';
import { fakeGemini, protoState } from './fixtures/proto-llm.mjs';
import { products } from './fixtures/catalog.mjs';

const PARENTS = '부모님 한 세트 세트당 예산 5만원 이하 배송비 포함 추천';
const NOW = () => '2027-01-25T03:00:00.000Z';
const SESSION0 = { state: singleInitial(), issues: [] };

const S1 = '추석 선물이야. 엄마는 단 거 싫어하시고 땅콩 알레르기, 아빠는 등산 좋아하셔. 5만 원';
const S1_REPLY = {
  state: protoState({ recipients: ['어머니', '아버지'], occasion: '추석', budget: { amount_krw: 50000 }, preferences: ['less_sweet'], excluded_ingredients: ['땅콩'] }),
  memory: [
    { recipient: '엄마', key: 'pref:less_sweet', polarity: 1, evidence: '엄마는 단 거 싫어하시고' },
    { recipient: '엄마', key: 'allergy:땅콩', polarity: -1, evidence: '땅콩 알레르기' },
    { recipient: '아빠', key: 'hobby:등산', polarity: 1, evidence: '아빠는 등산 좋아하셔' },
  ],
};

/** The checks of main's app (serverChatService.ts request()) on a /api/chat answer. */
function assertMainShape(turn) {
  validateState(turn.session.state);
  assert.ok(Array.isArray(turn.session.issues) && turn.session.issues.every(v => typeof v === 'string'));
  assert.equal(typeof turn.message, 'string');
  assert.ok(['rules', 'rules_fast', 'llm'].includes(turn.mode));
  assert.ok(turn.view && Array.isArray(turn.view.result?.items) && Array.isArray(turn.view.comparison?.alternatives) && Array.isArray(turn.view.question?.choices));
  assert.equal(typeof turn.view.question.text, 'string');
  assert.equal(typeof turn.view.result.message, 'string');
  assert.ok(turn.view.result.items.every(p => typeof p.id === 'string' && typeof p.name === 'string' && Number.isFinite(p.total)));
  assert.ok(!('quantity' in turn.session.state) && !('same_product' in turn.session.state) && !('scope' in turn.session.state.budget), 'public one-gift state');
}

function setup(make = stores.memory, { seed = true, replies, explain = null } = {}) {
  const store = make();
  const dialogue = replies ? fakeGemini(replies) : null;
  const pipeline = createPipeline({ store, products, dialogueLlm: dialogue?.llm ?? null, now: NOW, explain });
  const h = createHandlers({ store, products, pipeline });
  const post = async body => h.route({ method: 'POST', path: '/api/chat', body: { participant_id: 'userA', session_id: 's', experiment: 'B', session: SESSION0, ...body } });
  const turn = async (text, extra = {}) => post({ operation: 'turn', text, history: [], source: 'typed', ...extra });
  return { store, h, post, turn, ready: (async () => { const people = await seedPeople(store); if (seed) await seedS1Memories(store, people); return people; })() };
}


for (const [name, make] of Object.entries(stores)) {
  test(`[${name}] R3/AC14: above a person's cap no items and no budget-raising alternatives leave the server, on every operation`, async () => {
    const { post, turn, store, ready } = setup(make);
    await ready;
    const cap = 30000;
    const asProf = extra => ({ participant_id: 'userB', ...extra });
    const gate = res => {
      assert.equal(res.status, 200, JSON.stringify(res.json));
      assertMainShape(res.json);
      assert.deepEqual(res.json.view.result.items, [], 'no card above the cap');
      assert.deepEqual(res.json.view.comparison.alternatives, []);
      assert.equal(res.json.view.question.key, 'budget');
    };
    const first = await turn('교수님 한 세트 세트당 예산 8만원 이하 배송비 포함 추천', asProf());
    gate(first);
    assert.equal((await store.getSession('userB', 's')).session.state.budget.amount_krw, 80000, 'precondition: the state above the cap IS saved');
    gate(await post(asProf({ operation: 'view' })));
    gate(await post(asProf({ operation: 'end_session' })));
    gate(await post(asProf({ operation: 'turn', text: '음', history: [], source: 'typed' })));
    // within the cap: cards come back and nothing, items or alternatives, costs more than the cap
    for (const experiment of ['A', 'B']) {
      const ok = await post(asProf({ operation: 'conditions', patch: { budget: { amount_krw: cap } }, experiment }));
      assertMainShape(ok.json);
      assert.ok(ok.json.view.result.items.length > 0 && ok.json.view.result.items.every(i => i.total <= cap), experiment);
      assert.ok(ok.json.view.comparison.alternatives.every(x => x.amount <= cap), `${experiment}: no alternative above the cap`);
    }
    // a what-if above the cap is gated too and never saved
    gate(await post(asProf({ operation: 'view', what_if_amount_krw: 80000 })));
    assert.equal((await store.getSession('userB', 's')).session.state.budget.amount_krw, cap);
  });

  test(`[${name}] what_if_amount_krw shows the result of that budget in the answer and saves nothing (AC15)`, async () => {
    const { turn, post, store, ready } = setup(make);
    await ready;
    await turn('친구 한 세트 총예산 3만원 이하 상품값만 추천');
    const base = await post({ operation: 'view' });
    const what = await post({ operation: 'view', what_if_amount_krw: 100000 });
    assert.equal(what.json.session.state.budget.amount_krw, base.json.session.state.budget.amount_krw, 'the session shows the saved budget');
    const expected = recommendationView({ state: { ...base.json.session.state, budget: { ...base.json.session.state.budget, amount_krw: 100000 } }, issues: [] }, products);
    assert.deepEqual(what.json.view.result.items.map(i => [i.id, i.total]), expected.result.items.map(i => [i.id, i.total]), 'the cards are those of the what-if budget');
    assert.equal((await store.getSession('userA', 's')).session.state.budget.amount_krw, 30000);
  });

  test(`[${name}] the session the client sends is never the state: forged recipients and budget are ignored`, async () => {
    const { turn, post, ready } = setup(make);
    await ready;
    await turn(PARENTS);
    const forged = { state: { ...singleInitial(), recipients: ['직장동료'], budget: { amount_krw: 999999, shipping_included: false } }, issues: [] };
    const res = await post({ operation: 'view', session: forged });
    assert.deepEqual(res.json.session.state.recipients, ['부모님']);
    assert.equal(res.json.session.state.budget.amount_krw, 50000);
  });

  test(`[${name}] condition A: the comparison (budget-raising alternatives) is empty; B keeps main's`, async () => {
    const { turn, ready } = setup(make);
    await ready;
    const a = await turn('친구 한 세트 총예산 3만원 이하 상품값만 추천', { experiment: 'A', session_id: 'sa' });
    assert.deepEqual(a.json.view.comparison.alternatives, []);
    const b = await turn('친구 한 세트 총예산 3만원 이하 상품값만 추천', { experiment: 'B', session_id: 'sb' });
    assert.ok(Array.isArray(b.json.view.comparison.alternatives));
  });
}

for (const [name, make] of Object.entries(stores)) {
  test(`[${name}] main contract: one JSON answer = session + message + mode + view + catalog, plus a pipeline block (K57)`, async () => {
    const { turn, ready } = setup(make);
    await ready;
    const res = await turn(PARENTS);
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assertMainShape(res.json);
    assert.equal(res.json.mode, 'rules');
    assert.equal(res.json.catalog, 'amazon-kaggle-v1');
    assert.deepEqual(res.json.session.state.recipients, ['부모님']);
    assert.equal(res.json.session.state.budget.amount_krw, 50000);
    assert.equal(res.json.view.result.items.length, 3);
    assert.match(res.json.message, /이렇게 이해했어요/);
    const p = res.json.pipeline;
    assert.equal(p.banner.text, '지난 기억을 반영했어요: 단 음식 X · 땅콩 제외 · 등산');
    assert.deepEqual(Object.keys(p.tags).sort(), res.json.view.result.items.map(i => i.id).sort(), 'template tags for every card in the same answer');
    assert.ok(Object.values(p.tags).every(t => Array.isArray(t)));
    assert.equal(p.explanation_source, 'template');
    assert.equal(p.experiment, 'B');
  });

  test(`[${name}] AC1 over the server: view.result items are the baseline runTurn cards of the saved session, same order and amounts`, async () => {
    const { turn, store, ready } = setup(make);
    await ready;
    const res = await turn(PARENTS);
    const row = await store.getSession('userA', 's');
    const baseline = await runTurn({ session: row.session, request: { kind: 'view', expectedVersion: row.session.version }, products });
    assert.deepEqual(res.json.view.result.items.map(i => [i.id, i.total]), baseline.result.cards.map(c => [c.id, c.total_krw]));
  });

  test(`[${name}] AC3: a turn never waits for the LLM wording; operation=explain brings it later and only for tags`, async () => {
    let calls = 0;
    const explain = async ({ cards }) => { calls++; return { items: cards.map(c => ({ id: c.id, tags: ['LLM 설명', '두번째'] })) }; };
    const { turn, post, ready } = setup(make, { explain });
    await ready;
    const first = await turn(PARENTS);
    assert.equal(calls, 0, 'cards and template tags first, no explainer call in the turn');
    assert.equal(first.json.pipeline.explanation_source, 'template');
    const later = await post({ operation: 'explain' });
    assert.equal(later.status, 200, JSON.stringify(later.json));
    assert.equal(calls >= 1, true);
    assert.equal(later.json.pipeline.version, first.json.pipeline.version, 'the version tells the app the tags belong to the cards on screen');
    assert.deepEqual(Object.keys(later.json.pipeline.tags).sort(), Object.keys(first.json.pipeline.tags).sort());
    assert.ok(!('view' in later.json), 'explain answers tags only; the cards are not sent again');
    const only = await post({ operation: 'explain', item_ids: [Object.keys(first.json.pipeline.tags)[0]] });
    assert.equal(Object.keys(only.json.pipeline.tags).length, 1);
  });

  test(`[${name}] operation=explain with no session or nothing to explain answers tags {} instead of failing`, async () => {
    const { post, ready } = setup(make);
    await ready;
    const res = await post({ operation: 'explain', session_id: 'empty' });
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.pipeline.tags, {});
  });

  test(`[${name}] input is validated before anything runs; errors carry {error, code} only`, async () => {
    const { h, ready } = setup(make);
    await ready;
    const ok = { operation: 'view', participant_id: 'a', session_id: 's', session: SESSION0 };
    for (const body of [null, [], {}, { ...ok, operation: 'nope' }, { ...ok, participant_id: 'a b' }, { ...ok, participant_id: undefined }, { ...ok, session_id: '' }, { ...ok, session: undefined }, { ...ok, session: { state: {}, issues: [] } },
      { ...ok, session: { ...SESSION0, issues: 'x' } }, { ...ok, experiment: 'C' }, { ...ok, recipient_id: '../x' }, { ...ok, participant_id: 'x'.repeat(65) },
      { ...ok, operation: 'turn', text: '', history: [] }, { ...ok, operation: 'turn', text: 'hi', history: new Array(7).fill({ role: 'user', text: 'a' }) },
      { ...ok, operation: 'conditions', patch: { nope: 1 } }, { ...ok, operation: 'conditions', patch: { budget: { amount_krw: -5 } } }, { ...ok, operation: 'conditions', patch: [] },
      { ...ok, operation: 'feedback', kind: 'bought' }, { ...ok, operation: 'explain', item_ids: 'a' }]) {
      const res = await h.route({ method: 'POST', path: '/api/chat', body });
      assert.equal(res.status, 400, JSON.stringify(body));
      assert.deepEqual(Object.keys(res.json).sort(), ['code', 'error']);
      assert.equal(typeof res.json.code, 'string');
    }
    assert.equal((await h.route({ method: 'POST', path: '/api/chat', body: { ...ok, participant_id: 'a b' } })).json.code, 'invalid_owner');
  });

  test(`[${name}] an unexpected failure is reported as {code: internal} without its message (could hold user text)`, async () => {
    const store = make();
    const boom = { runPipelineTurn: async () => { throw new Error('secret 사용자 문장'); } };
    const h = createHandlers({ store, products, pipeline: boom });
    const res = await h.route({ method: 'POST', path: '/api/chat', body: { operation: 'view', participant_id: 'u', session_id: 's', session: SESSION0 } });
    assert.equal(res.status, 500);
    assert.equal(res.json.code, 'internal');
    assert.ok(!JSON.stringify(res).includes('secret'));
  });

  test(`[${name}] a turn the LLM could not answer is main's 503 {error, code}; nothing is saved`, async () => {
    const { turn, store, ready } = setup(make, { replies: [{ status: 401 }] });
    await ready;
    const res = await turn('어머니께 센스 있는 선물 골라줘');
    assert.equal(res.status, 503, JSON.stringify(res.json));
    assert.equal(typeof res.json.error, 'string');
    assert.equal(typeof res.json.code, 'string');
    assert.equal(await store.getSession('userA', 's'), null);
  });

  test(`[${name}] operation=conditions applies a chip patch to the saved session; an edit clears open questions unless told not to`, async () => {
    const { turn, post, store, ready } = setup(make);
    await ready;
    await turn(PARENTS);
    const res = await post({ operation: 'conditions', patch: { budget: { amount_krw: 30000 } } });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assertMainShape(res.json);
    assert.equal(res.json.session.state.budget.amount_krw, 30000);
    assert.equal((await store.getSession('userA', 's')).session.state.budget.amount_krw, 30000);
    assert.ok(res.json.view.result.items.every(i => i.total <= 30000));
    const stale = await post({ operation: 'conditions', patch: { budget: { amount_krw: 40000 } }, session: { ...SESSION0, version: 1 } });
    assert.equal(stale.status, 409);
    assert.equal(stale.json.code, 'version_conflict');
  });

  test(`[${name}] operation=view recomputes without changing anything; what_if_amount_krw never saves (AC15)`, async () => {
    const { turn, post, store, ready } = setup(make);
    await ready;
    await turn(PARENTS);
    const before = await store.getSession('userA', 's');
    const view = await post({ operation: 'view' });
    assertMainShape(view.json);
    assert.equal(view.json.session.version, before.session.version);
    const what = await post({ operation: 'view', what_if_amount_krw: 80000 });
    assert.equal(what.status, 200, JSON.stringify(what.json));
    assert.deepEqual((await store.getSession('userA', 's')).session.state, before.session.state, 'a what-if never changes the saved budget');
  });

  test(`[${name}] a new session whose first message is not understood leaves no row and still answers in main's shape`, async () => {
    const { turn, store, ready } = setup(make);
    await ready;
    const res = await turn('음');
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assertMainShape(res.json);
    assert.ok(res.json.view.question.text.length > 0, 'main asks its one question');
    assert.equal(await store.getSession('userA', 's'), null);
  });

  test(`[${name}] operation=memory list is scoped to the participant (AC6)`, async () => {
    const { post, ready } = setup(make);
    const { mom } = await ready;
    const list = await post({ operation: 'memory', action: 'list' });
    assert.equal(list.status, 200);
    assert.deepEqual(list.json.recipients.map(r => r.name).sort(), ['민지', '아버지', '어머니']);
    assert.deepEqual((await post({ operation: 'memory', action: 'list', participant_id: 'userB' })).json.recipients.map(r => r.name), ['교수님']);
    const mem = await post({ operation: 'memory', action: 'list', recipient_id: mom.id });
    assert.deepEqual(mem.json.memories.map(m => m.label).sort(), ['단 음식 X', '땅콩 제외']);
    assert.ok(mem.json.memories.every(m => m.evidence && m.status === 'confirmed'));
    assert.equal((await post({ operation: 'memory', action: 'list', recipient_id: mom.id, participant_id: 'userB' })).status, 404, 'another participant sees nothing');
  });

  test(`[${name}] AC9: memory delete removes the row for real; edit changes evidence only and never weakens an allergy`, async () => {
    const { post, turn, store, ready } = setup(make);
    const { mom } = await ready;
    const [sweet, peanut] = [(await store.listMemories('userA', mom.id)).find(m => m.key === 'pref:less_sweet'), (await store.listMemories('userA', mom.id)).find(m => m.key === 'allergy:땅콩')];
    const edit = (id, patch, participant_id = 'userA') => post({ operation: 'memory', action: 'edit', memory_id: id, patch, participant_id });
    assert.equal((await edit(sweet.id, { evidence: '단 거 안 좋아하셔' })).status, 200);
    assert.equal((await edit(sweet.id, { key: 'pref:unsweetened' })).status, 400, 'key is identity');
    assert.equal((await edit(peanut.id, { polarity: 1 })).status, 409, 'an allergy cannot be weakened');
    assert.equal((await edit(sweet.id, { evidence: 'x' }, 'userB')).status, 404, 'not the owner');
    const del = (id, participant_id = 'userA') => post({ operation: 'memory', action: 'delete', memory_id: id, participant_id });
    assert.equal((await del(sweet.id, 'userB')).status, 404);
    assert.ok(await store.getMemory('userA', sweet.id), 'still there');
    assert.deepEqual((await del(sweet.id)).json, { deleted: true });
    assert.equal(await store.getMemory('userA', sweet.id), null, 'really gone (AC9)');
    assert.equal((await del(sweet.id)).status, 404);
    const next = await turn(PARENTS, { session_id: 'n' });
    assert.ok(!next.json.pipeline.banner.text.includes('단 음식 X'), 'the next recommendation no longer uses it');
  });

  test(`[${name}] AC9 in a conversation: memory delete with in_session removes what it contributed and answers the new conditions`, async () => {
    const { post, turn, store, ready } = setup(make);
    const { mom } = await ready;
    await turn(PARENTS);
    const sweet = (await store.listMemories('userA', mom.id)).find(m => m.key === 'pref:less_sweet');
    const res = await post({ operation: 'memory', action: 'delete', memory_id: sweet.id, in_session: true });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assertMainShape(res.json);
    assert.ok(!res.json.session.state.preferences.includes('less_sweet'));
    assert.equal(await store.getMemory('userA', sweet.id), null);
  });

  test(`[${name}] AC4: S1 -> end_session asks "기억할까요?" -> end_session{accept} saves with evidence; declining saves nothing`, async () => {
    for (const accept of [true, false]) {
      const { post, turn, store, ready } = setup(make, { seed: false, replies: [S1_REPLY] });
      await ready;
      await turn(S1);
      const end = await post({ operation: 'end_session' });
      assert.equal(end.status, 200, JSON.stringify(end.json));
      const prompt = end.json.pipeline.memory_prompts.find(p => p.kind === 'remember');
      assert.ok(prompt, 'the session end asks once');
      assert.equal(end.json.pipeline.session_end, true);
      const res = await post({ operation: 'end_session', accept });
      assert.equal(res.status, 200, JSON.stringify(res.json));
      const rows = (await Promise.all((await store.listRecipients('userA')).map(r => store.listMemories('userA', r.id)))).flat().filter(m => m.status === 'confirmed');
      if (accept) { assert.ok(rows.length >= 2); assert.ok(rows.every(m => m.evidence.length > 0)); assert.ok(res.json.pipeline.memory_saved.saved.length >= 2); } else assert.equal(rows.length, 0, 'declined: nothing stored');
    }
    const { post, ready } = setup(make);
    await ready;
    assert.equal((await post({ operation: 'end_session', accept: true, session_id: 'none' })).status, 400, 'no pending candidates');
    assert.equal((await post({ operation: 'end_session', accept: 'yes' })).status, 400);
  });

  test(`[${name}] operation=feedback runs the pipeline feedback and answers in main's shape`, async () => {
    const { post, turn, ready } = setup(make);
    await ready;
    await turn(PARENTS);
    const ok = await post({ operation: 'feedback', kind: 'chosen', product_id: 'hiking-socks' });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assertMainShape(ok.json);
    assert.equal((await post({ operation: 'feedback', kind: 'chosen', product_id: 'nope' })).status, 400);
    assert.equal((await post({ operation: 'feedback', kind: 'bought', product_id: 'hiking-socks' })).status, 400);
    const ask = await post({ operation: 'feedback', kind: 'dismissed', product_id: 'hiking-socks' });
    assert.ok(ask.json.pipeline.memory_prompts.some(p => p.kind === 'dismiss_scope'), 'asks "이 상품만 / 이런 종류 모두"');
    const one = await post({ operation: 'feedback', kind: 'dismiss_one', product_id: 'hiking-socks' });
    assert.deepEqual(one.json.pipeline.hidden_product_ids, ['hiking-socks']);
  });

  test(`[${name}] AC15 over the server: ladder_compare changes nothing; ladder_save (down) changes the budget`, async () => {
    const { post, turn, store, ready } = setup(make);
    await ready;
    await turn('친구 한 세트 총예산 3만원 이하 상품값만 추천');
    const before = await store.getSession('userA', 's');
    const view = await post({ operation: 'view' });
    const down = view.json.pipeline.ladder?.find(c => c.direction === 'down');
    assert.ok(down, 'precondition: an 아끼기 chip');
    const up = view.json.pipeline.ladder?.find(c => c.direction === 'up');
    if (up) {
      const cmp = await post({ operation: 'feedback', kind: 'ladder_compare', product_id: up.productId });
      assert.equal(cmp.status, 200, JSON.stringify(cmp.json));
      assert.equal(cmp.json.pipeline.compare_add.productId, up.productId);
      assert.ok(cmp.json.pipeline.compare_add.product?.name, 'the tray gets the product itself');
    }
    assert.deepEqual((await store.getSession('userA', 's')).session.state, before.session.state, 'viewing options and comparing change nothing');
    const picked = await post({ operation: 'feedback', kind: 'ladder_save' });
    assert.equal(picked.status, 200, JSON.stringify(picked.json));
    assert.equal((await store.getSession('userA', 's')).session.state.budget.amount_krw, down.amount_krw);
    assert.equal(picked.json.session.state.budget.amount_krw, down.amount_krw);
  });

  test(`[${name}] condition A gets no price options, contrast or memory counterfactual in the pipeline block (AC12)`, async () => {
    const { turn, ready } = setup(make);
    await ready;
    const a = await turn('친구 한 세트 총예산 3만원 이하 상품값만 추천', { experiment: 'A' });
    assert.equal(a.json.pipeline.experiment, 'A');
    for (const k of ['contrast', 'memory_cf', 'ladder', 'ladder_notice']) assert.ok(!(k in a.json.pipeline), k);
    const b = await turn('친구 한 세트 총예산 3만원 이하 상품값만 추천', { experiment: 'B', session_id: 's2' });
    assert.equal(b.json.pipeline.experiment, 'B');
    assert.deepEqual(a.json.view.result.items.map(i => i.id), b.json.view.result.items.map(i => i.id), 'cards are the same in A and B');
  });
}

test('routing: unknown path 404, wrong method 405, health, body limit constant, no stream route', async () => {
  const { h } = setup();
  const r = args => h.route(args);
  assert.equal((await r({ method: 'GET', path: '/nope' })).status, 404);
  assert.equal((await r({ method: 'POST', path: '/chat', body: {} })).status, 404, 'the old SSE route is gone');
  assert.equal((await r({ method: 'GET', path: '/api/chat' })).status, 405);
  const health = (await r({ method: 'GET', path: '/health' })).json;
  assert.deepEqual([health.ok, health.catalog], [true, 'amazon-kaggle-v1']);
  assert.equal(MAX_BODY_BYTES, 32768, "main's worker limit");
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

test('http adapter: /api/chat answers one application/json document (no event-stream); bad input answers JSON errors', async () => {
  const { h, ready } = setup();
  await ready;
  const listener = createListener(h, { origin: 'http://localhost:8081' });
  const res = fakeRes();
  await listener(fakeReq('POST', '/api/chat', { operation: 'turn', participant_id: 'userA', session_id: 's', session: SESSION0, text: PARENTS, history: [], source: 'typed' }), res);
  assert.equal(res.head.status, 200);
  assert.match(res.head.headers['content-type'], /application\/json/);
  assert.equal(res.head.headers['access-control-allow-origin'], 'http://localhost:8081');
  assert.equal(res.chunks.length, 1, 'written once, not streamed');
  assert.ok(res.ended);
  const json = JSON.parse(res.chunks.join(''));
  assertMainShape(json);
  assert.ok(json.pipeline);

  const invalid = fakeRes();
  await listener(fakeReq('POST', '/api/chat', { operation: 'view', participant_id: 'bad id', session_id: 's', session: SESSION0 }), invalid);
  assert.equal(invalid.head.status, 400);
  assert.equal(JSON.parse(invalid.chunks.join('')).code, 'invalid_owner');

  const notJson = fakeRes();
  await listener(fakeReq('POST', '/api/chat', '{oops'), notJson);
  assert.deepEqual([notJson.head.status, JSON.parse(notJson.chunks.join('')).code], [400, 'invalid_json']);

  const big = fakeRes();
  await listener(fakeReq('POST', '/api/chat', 'x'.repeat(MAX_BODY_BYTES + 1)), big);
  assert.equal(big.head.status, 413);

  const get = fakeRes();
  await listener(fakeReq('GET', '/health'), get);
  assert.equal(get.head.status, 200);
  const pre = fakeRes();
  await listener(fakeReq('OPTIONS', '/api/chat'), pre);
  assert.equal(pre.head.status, 204);
});
