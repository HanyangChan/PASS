// P5 assembly: 6-turn scenario (layer C, mock transport) and error handling through the configured agent (layer A).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession } from '../../../src/index.mjs';
import { createConfiguredAgent } from '../configured-agent.mjs';
import { createMemoryStore } from '../memory.mjs';
import { ERROR_NOTICES } from '../planner.mjs';
import { chatResponse, products, readySession } from './helpers.mjs';

// Not a real key: a placeholder so the client counts as configured. Requests go to the fake fetcher only.
const ENV = { LLM_API_KEY: 'placeholder-not-a-key' };
const RECIPIENT = 'demo-recipient-1';
const TURNS = [
  { text: '어머니 한 세트 세트당 예산 5만원 이하 배송비 포함 추천', kind: 'recommendation', version: 1, cards: ['tea', 'snack'], question: null, proposals: [] },
  { text: '나는 단 것을 좋아해', kind: 'recommendation', version: 1, cards: ['tea', 'snack'], question: null, proposals: [] },
  { text: '엄마는 설탕을 피해', kind: 'recommendation', version: 2, cards: ['tea', 'snack'], question: null, proposals: [['preferences', 'less_sweet', false]] },
  { text: '견과류는 별로야', kind: 'question', version: 2, cards: [], question: '견과류는 받는 분이 피하시는 건가요?', proposals: [] },
  { text: '응 엄마가 견과류 알레르기 있어', kind: 'recommendation', version: 3, cards: ['tea'], question: null, proposals: [['excluded_ingredients', '견과류', true]] },
  { whatIf: 70000, kind: 'comparison', version: 3, cards: ['premium', 'tea'], question: null, proposals: [] },
  // 2026-11-08: quoted speech needs the LLM classification step (mock answers recipient).
  { text: '엄마가 "나는 차를 좋아해"라고 하셨어', kind: 'recommendation', version: 4, cards: ['tea'], question: null, proposals: [['preferences', 'category:coffee_tea', false]], llmCalls: 1 },
  { text: '엄마가 "나는 과자는 안 좋아해"라고 하셨어', kind: 'question', version: 4, cards: [], question: '과자·간식 상품을 추천에서 빼 드릴까요?', proposals: [], llmCalls: 1 },
];
const STATES = [
  { preferences: [], excluded_ingredients: [] }, { preferences: [], excluded_ingredients: [] },
  { preferences: ['less_sweet'], excluded_ingredients: [] }, { preferences: ['less_sweet'], excluded_ingredients: [] },
  { preferences: ['less_sweet'], excluded_ingredients: ['견과류'] }, { preferences: ['less_sweet'], excluded_ingredients: ['견과류'] },
  { preferences: ['less_sweet', 'category:coffee_tea'], excluded_ingredients: ['견과류'] },
  { preferences: ['less_sweet', 'category:coffee_tea'], excluded_ingredients: ['견과류'], excluded_categories: [] },
];
/** Fake transport: answers classification requests with "recipient"; any extraction request is unexpected here. */
function classifyingFetcher(counter) {
  return async (url, init) => {
    counter.fetches++;
    const body = JSON.parse(init.body);
    if (body.messages[0].content.includes('추출기')) throw new Error('extraction not expected in this scenario');
    const ids = JSON.parse(body.messages.at(-1).content).claims.map(c => c.id);
    return chatResponse(JSON.stringify({ owners: ids.map(id => ({ id, owner: 'recipient' })) }));
  };
}

function violations(card, state) {
  const p = products.find(x => x.id === card.id);
  const unit = p.price_krw + (state.budget.shipping_included ? p.shipping_fee_per_set_krw : 0);
  const cost = state.budget.scope === 'total' ? unit * state.quantity : unit;
  return [cost > state.budget.amount_krw && 'budget', p.allergens_declared.some(a => state.excluded_ingredients.includes(a)) && 'ingredient',
    state.excluded_categories.includes(p.category) && 'category', p.stock_sets < state.quantity && 'stock'].filter(Boolean);
}

test('T6-01~06, T6-10 the eight-turn conversation through the configured agent', async () => {
  const counter = { fetches: 0 };
  const memory = createMemoryStore();
  const turnCalls = [];
  const agent = createConfiguredAgent(ENV, { memory, maxTurns: 10, fetcher: classifyingFetcher(counter), onStats: s => turnCalls.push(s.llmCalls) });
  let session = createSession('scenario'), plannerState;
  const asked = [], fields = [];
  for (const [i, turn] of TURNS.entries()) {
    const request = turn.whatIf ? { kind: 'what_if_budget', amount_krw: turn.whatIf, expectedVersion: session.version } : { kind: 'message', text: turn.text, expectedVersion: session.version };
    turnCalls.length = 0;
    const out = await agent.runTurn({ session, plannerState, request, products, recipientId: RECIPIENT });
    const n = i + 1;
    assert.equal(turnCalls.reduce((a, b) => a + b, 0), turn.llmCalls ?? 0, `turn ${n} llm calls`);
    assert.equal(out.kind, turn.kind, `turn ${n}`); assert.equal(out.session.version, turn.version, `turn ${n}`);
    assert.deepEqual(out.session.state.recipients, ['어머니'], `turn ${n}`);
    assert.deepEqual(out.session.state.budget, { amount_krw: 50000, scope: 'per_set', shipping_included: true }, `turn ${n}`);
    for (const [k, v] of Object.entries(STATES[i])) assert.deepEqual(out.session.state[k], v, `turn ${n} ${k}`);
    assert.equal(out.plan.question, turn.question, `turn ${n}`);
    assert.deepEqual((out.result?.cards ?? []).map(c => c.id), turn.cards, `turn ${n}`);
    assert.deepEqual(out.plan.memory.proposals.map(p => [p.field, p.value, p.sensitive]), turn.proposals, `turn ${n}`);
    // T6-02: no constraint violation in any card.
    for (const card of out.result?.cards ?? []) assert.deepEqual(violations(card, out.evaluatedState), [], `turn ${n} ${card.id}`);
    // T6-06: explanations only on recommendations/comparisons.
    assert.equal(Object.hasOwn(out, 'explanation'), turn.kind !== 'question', `turn ${n}`);
    if (n === 1) { assert.equal(out.explanation.contrastive.basis, 'score'); assert.equal(out.explanation.counterfactual.case, 'a'); assert.equal(out.explanation.counterfactual.targetId, 'premium'); }
    if (n === 3) assert.match(out.explanation.reason.text, /덜 단 상품을 우선/);
    if (n === 6) {
      assert.equal(out.explanation.counterfactual.case, 'c'); assert.equal(out.explanation.contrastive.basis, 'popularity'); assert.equal(out.evaluatedState.budget.amount_krw, 70000);
      assert.deepEqual(out.explanation.hypothetical, { budget_krw: 70000, current_budget_krw: 50000 });
    }
    if (n === 7) { assert.match(out.explanation.reason.text, /합계 6점/); assert.deepEqual(out.plan.attribution.map(c => [c.kind, c.value, c.owner, c.reason]), [['category', 'coffee_tea', 'recipient', 'llm']]); }
    if (n === 8) assert.equal(out.plan.action, 'confirm');
    if (out.plan.question) asked.push(out.plan.question);
    if (out.plan.field && out.plan.question) fields.push(out.plan.field);
    session = out.session; plannerState = out.plan.plannerState;
  }
  // T6-03, T6-04, T6-05
  assert.equal(new Set(asked).size, asked.length); assert.equal(new Set(fields).size, fields.length);
  assert.equal(counter.fetches, 2);
  assert.deepEqual(memory.list(RECIPIENT), []);
  assert.deepEqual(memory.pending(RECIPIENT).map(p => p.value), ['less_sweet', '견과류', 'category:coffee_tea']);
});

test('T6-07 LLM errors through the configured agent keep the session and give a notice', async () => {
  const session = await readySession(), before = structuredClone(session);
  const quoted = "엄마가 '나는 단 거 싫어'라고 하셨어"; // needs the classification call
  const never = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
  const cases = [
    ['auth_failed', ERROR_NOTICES.operator, ENV, { fetcher: async () => new Response('', { status: 401 }) }],
    ['quota_exceeded', ERROR_NOTICES.operator, ENV, { fetcher: async () => new Response('', { status: 429 }) }],
    ['request_rejected', ERROR_NOTICES.operator, ENV, { fetcher: async () => new Response('', { status: 400 }) }],
    ['network_error', ERROR_NOTICES.retry, ENV, { fetcher: async () => { throw new TypeError('offline'); } }],
    ['invalid_response', ERROR_NOTICES.retry, ENV, { fetcher: async () => chatResponse('{"owners": [ broken') }],
    ['timeout', ERROR_NOTICES.retry, ENV, { fetcher: never, timeoutMs: 30 }],
    ['configuration', ERROR_NOTICES.operator, {}, { fetcher: async () => { throw new Error('must not be called'); } }],
  ];
  for (const [code, notice, env, options] of cases) {
    const out = await createConfiguredAgent(env, options).runTurn({ session, request: { kind: 'message', text: quoted, expectedVersion: session.version }, products });
    assert.equal(out.kind, 'error', code); assert.deepEqual(out.plan.error, { code }, code); assert.equal(out.plan.notice, notice, code);
    assert.deepEqual(out.session, before, code); assert.deepEqual(session, before, code);
  }
});

test('T6-08 the key comes only from the env argument; rule-only turns need no network', async () => {
  let fetches = 0;
  const agent = createConfiguredAgent({}, { fetcher: async () => { fetches++; throw new Error('no call'); } });
  assert.equal(agent.id, 'c-attribution-planned'); assert.equal(typeof agent.model, 'string');
  const session = createSession('t6-08');
  const out = await agent.runTurn({ session, request: { kind: 'message', text: TURNS[0].text, expectedVersion: 0 }, products });
  assert.equal(out.kind, 'recommendation'); assert.equal(fetches, 0);
  assert.throws(() => createConfiguredAgent(undefined), TypeError);
});
