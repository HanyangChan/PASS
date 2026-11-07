// P2 planner / orchestrator, layer A (mock LLM or rules only). IDs follow ../TEST-PLAN.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LlmError } from '../../../llm/index.mjs';
import { createSession, runTurn } from '../../../src/index.mjs';
import { createAgent, interpretMessage } from '../index.mjs';
import { ERROR_NOTICES, createPlannedAgent, createPlannerState, missingField } from '../planner.mjs';
import { products, readySession } from './helpers.mjs';

const message = (session, text) => ({ kind: 'message', expectedVersion: session.version, text });
const view = session => ({ kind: 'view', expectedVersion: session.version });
const core = ({ plan, explanation, ...rest }) => rest;
const atTurn = turn => ({ ...createPlannerState(), turn });
function deepFreeze(x) { if (x && typeof x === 'object') { Object.values(x).forEach(deepFreeze); Object.freeze(x); } return x; }

test('T2-01 what_if is planned as compare and keeps the common comparison', async () => {
  const session = await readySession();
  const request = { kind: 'what_if_budget', amount_krw: 70000, expectedVersion: session.version };
  const out = await createPlannedAgent().runTurn({ session, request, products });
  assert.equal(out.plan.action, 'compare'); assert.equal(out.result.cards[0].id, 'premium');
  assert.deepEqual(core(out), await runTurn({ session, request, products, interpret: interpretMessage }));
});

test('T2-03 missing recipients is asked with the common wording; missingField mirrors the common order', async () => {
  const session = createSession('p2');
  const out = await createPlannedAgent().runTurn({ session, request: view(session), products });
  assert.equal(out.kind, 'question'); assert.equal(out.plan.action, 'ask'); assert.equal(out.plan.field, 'recipients');
  assert.equal(out.plan.question, out.question);
  const partials = [
    {}, { recipients: ['어머니'] }, { recipients: ['어머니'], budget: { amount_krw: 50000 } },
    { recipients: ['어머니'], budget: { amount_krw: 50000 }, quantity: 1 },
    { recipients: ['어머니'], budget: { amount_krw: 50000, scope: 'per_set' }, quantity: 1 },
    { recipients: ['어머니'], budget: { amount_krw: 50000, scope: 'total', shipping_included: true }, quantity: 2 },
  ];
  for (const patch of partials) {
    const s = (await runTurn({ session: createSession('m'), products, request: { kind: 'patch', expectedVersion: 0, patch } })).session;
    const common = await runTurn({ session: s, products, request: view(s) });
    assert.equal(common.kind, 'question', JSON.stringify(patch));
    assert.equal(missingField(s.state).question, common.question, JSON.stringify(patch));
  }
});

test('T2-04 missing budget is asked as budget.amount_krw', async () => {
  const s = (await runTurn({ session: createSession('p2'), products, request: { kind: 'patch', expectedVersion: 0, patch: { recipients: ['어머니'] } } })).session;
  const out = await createPlannedAgent().runTurn({ session: s, request: view(s), products });
  assert.equal(out.plan.action, 'ask'); assert.equal(out.plan.field, 'budget.amount_krw'); assert.equal(out.plan.question, '예산 상한을 알려주세요.');
});

test('T2-05 the same missing field is not asked twice: request_edit instead', async () => {
  const agent = createPlannedAgent();
  const session = createSession('p2');
  const first = await agent.runTurn({ session, request: view(session), products });
  const second = await agent.runTurn({ session, plannerState: first.plan.plannerState, request: view(session), products });
  assert.equal(second.kind, 'question');
  assert.equal(second.plan.action, 'request_edit'); assert.equal(second.plan.question, null); assert.match(second.plan.notice, /조건 편집/);
  assert.equal(second.plan.field, 'recipients');
});

test('T2-06 an unknown claim is confirmed with one template question', async () => {
  const session = await readySession();
  const out = await createPlannedAgent().runTurn({ session, request: message(session, '견과류는 별로야'), products });
  assert.equal(out.plan.action, 'confirm'); assert.equal(out.plan.question, '견과류는 받는 분이 피하시는 건가요?');
  assert.deepEqual(out.plan.plannerState.asked.map(a => a.text), ['견과류는 받는 분이 피하시는 건가요?']);
});

test('T2-07 at the turn limit with complete conditions it recommends with confirmed conditions only', async () => {
  const session = await readySession(), before = structuredClone(session);
  const out = await createPlannedAgent({ maxTurns: 2 }).runTurn({ session, plannerState: atTurn(1), request: message(session, '견과류는 별로야'), products });
  assert.equal(out.kind, 'recommendation'); assert.equal(out.plan.action, 'recommend'); assert.equal(out.plan.turnLimitReached, true);
  assert.deepEqual(out.plan.unapplied.map(c => [c.kind, c.value, c.owner]), [['ingredient', '견과류', 'unknown']]);
  assert.deepEqual(out.session, before);
  assert.deepEqual(out.result.cards.map(c => c.id), (await runTurn({ session, products, request: view(session) })).result.cards.map(c => c.id));
  assert.match(out.plan.notice, /확인된 조건/);
});

test('T2-08 at the turn limit without required conditions nothing is invented', async () => {
  const session = createSession('p2');
  for (const request of [view(session), message(session, '견과류는 별로야')]) {
    const out = await createPlannedAgent({ maxTurns: 1 }).runTurn({ session, request, products });
    assert.equal(out.kind, 'question'); assert.notEqual(out.plan.action, 'recommend');
    assert.equal(out.session.state.budget.amount_krw, null); assert.deepEqual(out.session.state.recipients, []);
    assert.match(out.plan.notice, /추천할 수 없/);
  }
});

test('T2-09 complete conditions are recommended with the common cards', async () => {
  const session = await readySession();
  const out = await createPlannedAgent().runTurn({ session, request: view(session), products });
  assert.equal(out.plan.action, 'recommend');
  assert.deepEqual(out.result.cards.map(c => c.id), (await runTurn({ session, products, request: view(session) })).result.cards.map(c => c.id));
});

test('T2-10 every plan carries at most one question', async () => {
  const session = await readySession();
  const agent = createPlannedAgent();
  for (const request of [view(session), message(session, '견과류는 별로야'), message(session, '두 개 사줘'), { kind: 'what_if_budget', amount_krw: 70000, expectedVersion: 1 }]) {
    const { plan } = await agent.runTurn({ session, request, products });
    assert.ok(plan.question === null || (typeof plan.question === 'string' && plan.question.length > 0), JSON.stringify(request));
  }
});

test('T2-11 the same confirmation is never repeated: alternative wording, then request_edit', async () => {
  const session = await readySession();
  const agent = createPlannedAgent();
  let plannerState;
  const asked = [];
  for (let i = 0; i < 3; i++) {
    const out = await agent.runTurn({ session, plannerState, request: message(session, '견과류는 별로야'), products });
    plannerState = out.plan.plannerState;
    asked.push([out.plan.action, out.plan.question]);
  }
  assert.equal(asked[0][0], 'confirm'); assert.equal(asked[1][0], 'confirm'); assert.notEqual(asked[0][1], asked[1][1]);
  assert.equal(asked[2][0], 'request_edit'); assert.equal(asked[2][1], null);
});

test('T2-13~15 maxTurns boundaries: max-1 no limit, max and max+1 limit', async () => {
  const session = await readySession();
  const agent = createPlannedAgent({ maxTurns: 3 });
  const run = turn => agent.runTurn({ session, plannerState: atTurn(turn), request: message(session, '견과류는 별로야'), products });
  const below = await run(1), at = await run(2), above = await run(3);
  assert.equal(below.plan.turn, 2); assert.equal(below.plan.turnLimitReached, false); assert.equal(below.plan.action, 'confirm');
  assert.equal(at.plan.turn, 3); assert.equal(at.plan.turnLimitReached, true); assert.equal(at.plan.action, 'recommend');
  assert.equal(above.plan.turn, 4); assert.equal(above.plan.turnLimitReached, true); assert.equal(above.plan.action, 'recommend');
});

test('T2-16 inputs are never mutated and the same input gives the same output', async () => {
  const session = deepFreeze(await readySession());
  const plannerState = deepFreeze(atTurn(1));
  const request = deepFreeze(message(session, '견과류는 별로야'));
  const agent = createPlannedAgent();
  const a = await agent.runTurn({ session, plannerState, request, products });
  const b = await agent.runTurn({ session, plannerState, request, products });
  assert.deepEqual(a, b);
  assert.equal(plannerState.turn, 1);
});

test('T2-17 the common result is kept as is; only plan is added', async () => {
  const session = await readySession();
  const agent = createPlannedAgent();
  for (const text of ['견과류는 별로야', '엄마는 견과류 알레르기가 있어', '나는 단 것을 좋아해']) {
    const request = message(session, text);
    const out = await agent.runTurn({ session, request, products });
    assert.deepEqual(Object.keys(out).filter(k => !['plan', 'explanation'].includes(k)).sort(), Object.keys(core(out)).sort());
    assert.deepEqual(core(out), await runTurn({ session, request, products, interpret: interpretMessage }), text);
  }
});

test('T2-20 LLM errors become a host notice; state and inputs are kept; no retry', async () => {
  const session = await readySession(), before = structuredClone(session);
  const plannerState = atTurn(2);
  const cases = [
    ['timeout', ERROR_NOTICES.retry], ['network_error', ERROR_NOTICES.retry],
    ['auth_failed', ERROR_NOTICES.operator], ['configuration', ERROR_NOTICES.operator],
    ['quota_exceeded', ERROR_NOTICES.operator], ['request_rejected', ERROR_NOTICES.operator],
  ];
  assert.match(ERROR_NOTICES.retry, /잠시 후 다시 시도해 주세요/);
  assert.match(ERROR_NOTICES.operator, /운영자/);
  for (const [code, notice] of cases) {
    let calls = 0;
    const agent = createPlannedAgent({ interpret: async () => { calls++; throw new LlmError(code); } });
    const out = await agent.runTurn({ session, plannerState, request: message(session, '견과류는 별로야'), products });
    assert.equal(out.kind, 'error', code); assert.equal(out.plan.action, 'error'); assert.deepEqual(out.plan.error, { code });
    assert.equal(out.plan.notice, notice, code); assert.equal(out.plan.question, null);
    assert.deepEqual(out.session, before, code); assert.deepEqual(session, before);
    assert.equal(out.plan.plannerState.turn, 2, code);
    assert.equal(calls, 1, code);
  }
});

test('T2-21 common errors are passed through unchanged', async () => {
  const session = await readySession();
  const agent = createPlannedAgent();
  await assert.rejects(agent.runTurn({ session, request: { kind: 'view', expectedVersion: 0 }, products }), { code: 'version_conflict' });
  const bad = createPlannedAgent({ interpret: async () => ({ patch: { budget: { amount_krw: -1 } }, questions: [], unresolved: false }) });
  await assert.rejects(bad.runTurn({ session, request: message(session, '센스 있는 선물'), products }), { code: 'invalid_input' });
});

test('T2-22 third-party statements get the third-party template', async () => {
  const session = await readySession();
  const out = await createPlannedAgent().runTurn({ session, request: message(session, '동생은 견과류 알레르기 있어'), products });
  assert.equal(out.plan.action, 'confirm');
  assert.equal(out.plan.question, '동생분 이야기시죠? 받는 분도 견과류를 피하셔야 하나요?');
  assert.equal(out.question, '견과류는 받는 분이 피하시는 건가요?');
});

test('T2-23 the default createAgent() is unchanged', async () => {
  const session = createSession('p2');
  const request = { kind: 'message', expectedVersion: 0, text: '어머니 한 세트 세트당 예산 5만원 이하 배송비 포함 추천' };
  assert.deepEqual(await createAgent().runTurn({ session, products, request }), await runTurn({ session, products, request }));
});

test('T2-24 invalid planner inputs are rejected', async () => {
  const session = await readySession();
  const agent = createPlannedAgent();
  for (const plannerState of [{ ...createPlannerState(), turn: -1 }, { ...createPlannerState(), asked: 'x' }, { ...createPlannerState(), extra: 1 }, null])
    await assert.rejects(agent.runTurn({ session, plannerState, request: view(session), products }), TypeError, JSON.stringify(plannerState));
  for (const maxTurns of [0, -1, 1.5, '3']) assert.throws(() => createPlannedAgent({ maxTurns }), TypeError);
  assert.throws(() => createPlannedAgent({ interpret: 'x' }), TypeError);
});
