// P4 recipient memory, layer A (mock LLM only). IDs follow ../TEST-PLAN.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, runTurn } from '../../../src/index.mjs';
import * as memoryModule from '../memory.mjs';
import { createMemoryStore, memoryPatch } from '../memory.mjs';
import { createPlannedAgent, createPlannerState } from '../planner.mjs';
import { claim, mockLlm, products, readySession } from './helpers.mjs';

const DAY = 86400000;
const owned = (owner, kind, value, polarity, strength = null, reason = 'recipient_subject', span = '엄마는 그래') =>
  ({ span, kind, value, polarity, strength, owner, reason, person: null });
const ALLERGY = owned('recipient', 'ingredient', '견과류', 'avoid', 'strong', 'recipient_subject', '엄마는 견과류 알레르기가 있어');
const LESS_SWEET = owned('recipient', 'sweetness', 'less_sweet', 'avoid', null, 'recipient_subject', '엄마는 설탕을 피해');
const CLEAR = '어머니 한 세트 세트당 예산 5만원 이하 배송비 포함 추천';
function saved(store, recipientId, c) { const p = store.propose(recipientId, c); assert.equal(p.ok, true, p.reason); return store.confirm(p.proposal.id); }

test('T4-01 facts of two recipients never mix', () => {
  const store = createMemoryStore();
  saved(store, 'r1', ALLERGY); saved(store, 'r2', LESS_SWEET);
  assert.deepEqual(store.list('r1').map(f => f.value), ['견과류']);
  assert.deepEqual(store.list('r2').map(f => f.value), ['less_sweet']);
  assert.throws(() => store.list(''), TypeError);
});

test('T4-02/03/14 only confirmed recipient facts can be proposed', () => {
  const store = createMemoryStore();
  const cases = [
    [owned('giver', 'sweetness', null, 'prefer', null, 'first_person'), 'not_recipient'],
    [owned('unknown', 'ingredient', '견과류', 'avoid', 'weak', 'no_subject_guard'), 'not_recipient'],
    [owned('unknown', 'ingredient', '견과류', 'avoid', 'strong', 'third_party'), 'not_recipient'],
    [owned('recipient', 'ingredient', '견과류', 'avoid', 'strong', 'gift_instruction', '견과류는 빼줘'), 'instruction_not_fact'],
    [owned('recipient', 'budget', null, null), 'not_storable'],
    [owned('recipient', 'ingredient', '견과류', 'allow'), 'not_storable'],
  ];
  for (const [c, reason] of cases) assert.deepEqual(store.propose('r1', c), { ok: false, reason }, `${c.owner}/${c.reason}`);
  assert.deepEqual(store.pending('r1'), []); assert.deepEqual(store.list('r1'), []);
});

test('T4-04/05 allergies are sensitive and saved only after confirm', () => {
  let t = 1000;
  const store = createMemoryStore({ now: () => t });
  const p = store.propose('r1', ALLERGY);
  assert.equal(p.ok, true); assert.equal(p.proposal.sensitive, true); assert.equal(p.proposal.requiresConfirmation, true);
  assert.deepEqual(store.list('r1'), []);
  assert.deepEqual(memoryPatch({ facts: store.list('r1'), state: createSession('x').state }).applied, []);
  t = 5000;
  const fact = store.confirm(p.proposal.id);
  assert.deepEqual(store.list('r1'), [fact]);
  assert.equal(fact.savedAt, 5000); assert.equal(fact.span, ALLERGY.span); assert.equal(fact.field, 'excluded_ingredients');
  assert.throws(() => store.confirm(p.proposal.id), RangeError);
  assert.equal(store.propose('r1', ALLERGY).reason, 'already_saved');
});

test('T4-06 purchase history is never a source, and no purchase inference exists', () => {
  const store = createMemoryStore();
  assert.deepEqual(store.propose('r1', ALLERGY, { source: 'purchase' }), { ok: false, reason: 'source_not_allowed' });
  assert.deepEqual(store.list('r1'), []);
  assert.equal(Object.keys(memoryModule).some(k => /purchase|order|buy/i.test(k)), false);
  assert.equal(Object.keys(store).some(k => /purchase|order|buy|infer/i.test(k)), false);
});

test('T4-07/08 the current request wins over memory (sweetness and ingredient)', () => {
  const store = createMemoryStore();
  saved(store, 'r1', LESS_SWEET); saved(store, 'r1', ALLERGY);
  const state = createSession('x').state;
  const sweet = memoryPatch({ facts: store.list('r1'), state, currentClaims: [owned('recipient', 'sweetness', null, 'prefer')] });
  assert.deepEqual(sweet.patch, { excluded_ingredients: ['견과류'] });
  assert.deepEqual(sweet.skipped.map(s => [s.value, s.reason]), [['less_sweet', 'current_request_priority']]);
  const nuts = memoryPatch({ facts: store.list('r1'), state, currentClaims: [owned('recipient', 'ingredient', '견과류', 'allow')] });
  assert.deepEqual(nuts.patch, { preferences: ['less_sweet'] });
  assert.deepEqual(nuts.skipped.map(s => [s.value, s.reason]), [['견과류', 'current_request_priority']]);
  // A giver's statement is not a current request about the recipient.
  assert.deepEqual(memoryPatch({ facts: store.list('r1'), state, currentClaims: [owned('giver', 'sweetness', null, 'prefer', null, 'first_person')] }).skipped, []);
});

test('T4-08 through the planned agent: "엄마는 견과류 괜찮아" keeps the remembered allergy unapplied', async () => {
  const store = createMemoryStore();
  saved(store, 'r1', ALLERGY);
  const session = await readySession(), before = structuredClone(session);
  const llm = mockLlm([{ claims: [claim('견과류 괜찮아', 'ingredient', '견과류', 'allow')] }]);
  const out = await createPlannedAgent({ llm, memory: store }).runTurn({ session, request: { kind: 'message', text: '엄마는 견과류 괜찮아', expectedVersion: 1 }, products, recipientId: 'r1' });
  assert.deepEqual(out.session.state.excluded_ingredients, []); assert.deepEqual(out.session, before);
  assert.deepEqual(out.plan.memory.skipped.map(s => [s.value, s.reason]), [['견과류', 'current_request_priority']]);
});

test('T4-09/10 only explicit delete removes facts; stale facts are listed, not removed', () => {
  let t = 100 * DAY;
  const store = createMemoryStore({ now: () => t, staleDays: 30 });
  const old = saved(store, 'r1', ALLERGY);
  t = 120 * DAY;
  const fresh = saved(store, 'r1', LESS_SWEET);
  t = 140 * DAY;
  assert.deepEqual(store.listStale('r1').map(f => f.id), [old.id]);
  assert.equal(store.list('r1').length, 2);
  assert.equal(store.delete('r1', 'missing'), false);
  assert.equal(store.delete('r2', old.id), false);
  assert.equal(store.delete('r1', old.id), true);
  assert.deepEqual(store.list('r1').map(f => f.id), [fresh.id]);
  assert.throws(() => createMemoryStore({ staleDays: 0 }), TypeError);
});

test('T4-11 every applied item carries its source', () => {
  const store = createMemoryStore({ now: () => 42 });
  const fact = saved(store, 'r1', ALLERGY);
  const { applied } = memoryPatch({ facts: store.list('r1'), state: createSession('x').state });
  assert.deepEqual(applied, [{ field: 'excluded_ingredients', value: '견과류', source: 'memory', savedAt: 42, span: ALLERGY.span, factId: fact.id }]);
});

test('T4-12 invalid stored values and checkedPatch failures are not applied', () => {
  const base = { recipientId: 'r1', span: 'x', sensitive: false, savedAt: 1, source: 'conversation' };
  const store = createMemoryStore({ facts: [
    { ...base, id: 'f1', field: 'excluded_ingredients', value: '설탕' },
    { ...base, id: 'f2', field: 'budget', value: 1000000 },
    { ...base, id: 'f3', field: 'preferences', value: 'sweet' },
    { ...base, id: 'f4', field: 'preferences', value: 'less_sweet' },
  ] });
  const state = createSession('x').state;
  const result = memoryPatch({ facts: store.list('r1'), state });
  assert.deepEqual(result.patch, { preferences: ['less_sweet'] });
  assert.deepEqual(result.skipped.map(s => [s.factId, s.reason]), [['f1', 'invalid_value'], ['f2', 'invalid_value'], ['f3', 'invalid_value']]);
  const crowded = { ...state, preferences: Array.from({ length: 50 }, (_, i) => `x${i}`) };
  const failed = memoryPatch({ facts: store.list('r1'), state: crowded });
  assert.deepEqual(failed.patch, {}); assert.deepEqual(failed.applied, []);
  assert.ok(failed.skipped.some(s => s.factId === 'f4' && s.reason === 'checked_patch_failed'));
  assert.throws(() => createMemoryStore({ facts: [{ id: 1 }] }), TypeError);
});

test('T4-15 without memory the planned agent output has no memory part', async () => {
  const session = await readySession();
  const out = await createPlannedAgent().runTurn({ session, request: { kind: 'view', expectedVersion: 1 }, products, recipientId: 'r1' });
  assert.equal(Object.hasOwn(out.plan, 'memory'), false);
});

test('T4-16/13 remembered facts are applied once through a common patch request', async () => {
  const store = createMemoryStore({ now: () => 7 });
  saved(store, 'r1', ALLERGY); saved(store, 'r1', LESS_SWEET);
  const agent = createPlannedAgent({ memory: store });
  const session = createSession('p4');
  const first = await agent.runTurn({ session, request: { kind: 'message', text: CLEAR, expectedVersion: 0 }, products, recipientId: 'r1' });
  assert.equal(first.kind, 'recommendation'); assert.equal(first.session.version, 2);
  assert.deepEqual(first.session.state.excluded_ingredients, ['견과류']); assert.deepEqual(first.session.state.preferences, ['less_sweet']);
  assert.deepEqual(first.plan.memory.applied.map(a => [a.value, a.source, a.savedAt]), [['견과류', 'memory', 7], ['less_sweet', 'memory', 7]]);
  assert.equal(first.plan.plannerState.memoryApplied, true);
  const common = await runTurn({ session: createSession('p4'), products, request: { kind: 'patch', expectedVersion: 0, patch: first.session.state } });
  assert.deepEqual(first.result.cards.map(c => c.id), common.result.cards.map(c => c.id));
  const second = await agent.runTurn({ session: first.session, plannerState: first.plan.plannerState, request: { kind: 'view', expectedVersion: 2 }, products, recipientId: 'r1' });
  assert.equal(second.session.version, 2); assert.deepEqual(second.plan.memory.applied, []);
  // No recipientId: memory is not touched at all.
  const anonymous = await agent.runTurn({ session, request: { kind: 'message', text: CLEAR, expectedVersion: 0 }, products });
  assert.equal(anonymous.session.version, 1); assert.equal(Object.hasOwn(anonymous.plan, 'memory'), false);
});

test('T4-17 applied recipient claims become proposals; nothing is saved before confirm', async () => {
  const store = createMemoryStore();
  const session = await readySession();
  const agent = createPlannedAgent({ memory: store });
  const out = await agent.runTurn({ session, plannerState: { ...createPlannerState(), memoryApplied: true }, request: { kind: 'message', text: '엄마는 견과류 알레르기가 있어', expectedVersion: 1 }, products, recipientId: 'r1' });
  assert.deepEqual(out.plan.memory.proposals.map(p => [p.field, p.value, p.sensitive]), [['excluded_ingredients', '견과류', true]]);
  assert.deepEqual(store.list('r1'), []);
  store.confirm(out.plan.memory.proposals[0].id);
  assert.deepEqual(store.list('r1').map(f => f.value), ['견과류']);
  const giver = await agent.runTurn({ session, plannerState: { ...createPlannerState(), memoryApplied: true }, request: { kind: 'message', text: '나는 단 것을 좋아해', expectedVersion: 1 }, products, recipientId: 'r1' });
  assert.deepEqual(giver.plan.memory.proposals, []);
});
