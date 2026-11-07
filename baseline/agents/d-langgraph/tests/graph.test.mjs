import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, runTurn } from '../../../src/index.mjs';
import { products } from '../../../examples/catalog.mjs';
import { runAgentTurn } from '../index.mjs';
import { occasion, spending, taste, relationship } from '../advisors.mjs';
import { initial } from '../../../src/vendor/engine.mjs';

// The shared `npm test` also finds this file; without this folder's install only the graph tests skip.
const graph = await import('@langchain/langgraph').then(() => true, () => false);
const graphTest = graph ? test : (name, fn) => test(name, { skip: 'npm install in baseline/agents/d-langgraph' }, fn);

const ready = { recipients: ['어머니'], quantity: 1, same_product: true, budget: { amount_krw: 50000, scope: 'per_set', shipping_included: true } };
const empty = { today: '2026-11-05' };
const mother = () => ({ ...initial(), ...ready });
async function start(context = empty) {
  return runAgentTurn({ session: createSession('d'), products, context, request: { kind: 'patch', expectedVersion: 0, patch: ready } });
}

graphTest('with no context and no advisors firing, the graph matches the common core exactly', async () => {
  const common = await runTurn({ session: createSession('d'), products, request: { kind: 'patch', expectedVersion: 0, patch: ready } });
  const { agents, ...rest } = await runAgentTurn({ session: createSession('d'), products, context: empty, disabled: ['relationship'], request: { kind: 'patch', expectedVersion: 0, patch: ready } });
  assert.deepEqual(rest, common);
  assert.equal(agents.trace.llmCalls, 0);
  assert.deepEqual(agents.suggestions, []);
});

graphTest('clear messages use the common rules and never call the LLM', async () => {
  const first = await start();
  let calls = 0;
  const out = await runAgentTurn({ session: first.session, products, context: empty, llm: async () => { calls++; throw Error('no'); }, request: { kind: 'message', expectedVersion: first.session.version, text: '어머니 예산 5만원 이하 배송비 포함' } });
  assert.equal(calls, 0);
  assert.equal(out.kind, 'recommendation');
});

graphTest('the giver\'s taste stays out of the filter; the recipient\'s allergy goes in', async () => {
  const first = await start();
  const out = await runAgentTurn({ session: first.session, products, context: empty, request: { kind: 'message', expectedVersion: first.session.version, text: '나는 과자 좋아하는데 엄마는 견과류 알레르기가 있어' } });
  assert.deepEqual(out.session.state.excluded_ingredients, ['견과류']);
  assert.deepEqual(out.session.state.preferences, []);
  assert.ok(out.result.cards.every(c => c.id !== 'snack'));
  assert.deepEqual(out.agents.memoryProposals, [{ recipient: '어머니', preferences: [], excluded_categories: [], excluded_ingredients: ['견과류'] }]);
});

graphTest('an unclear allergy owner asks and leaves the session unchanged', async () => {
  const first = await start();
  const out = await runAgentTurn({ session: first.session, products, context: empty, request: { kind: 'message', expectedVersion: first.session.version, text: '아빠랑 엄마 중에 한 분이 견과류 알레르기야' } });
  assert.equal(out.kind, 'question');
  assert.deepEqual(out.session, first.session);
});

graphTest('taste auto-preferences change the evaluation but are not stored, and a toggle removes them', async () => {
  const context = { ...empty, purchases: [{ category: 'coffee_tea', price_krw: 42000, feedback: 'liked' }] };
  const on = await start(context);
  assert.deepEqual(on.agents.autoApplied, ['category:coffee_tea']);
  assert.deepEqual(on.evaluatedState.preferences, ['category:coffee_tea']);
  assert.deepEqual(on.session.state.preferences, []);
  const off = await runAgentTurn({ session: on.session, products, context, disabled: ['taste'], request: { kind: 'view', expectedVersion: on.session.version } });
  assert.deepEqual(off.agents.autoApplied, []);
  assert.deepEqual(off.evaluatedState.preferences, []);
  assert.equal(off.agents.opinions.find(o => o.agent === 'taste').enabled, false);
  assert.equal(off.agents.trace.llmCalls, 0);
});

graphTest('suggestions never change the session and carry an engine preview', async () => {
  const context = { ...empty, calendar: [{ id: 'b', title: '엄마 생일', date: '11-17', kind: 'birthday' }] };
  const out = await start(context);
  const deadline = out.agents.suggestions.find(s => s.id === 'occasion:deadline');
  assert.deepEqual(deadline.patch, { delivery_by: '2026-11-16' });
  assert.equal(deadline.preview.candidates, 0);
  assert.equal(out.session.state.delivery_by, null);
});

graphTest('every opinion names its source and unknown agent names are rejected', async () => {
  const out = await start({ ...empty, purchases: [{ category: 'snack', price_krw: 20000, feedback: 'disliked' }], calendar: [{ id: 'b', title: '엄마 생일', date: '11-17', kind: 'birthday' }] });
  assert.ok(out.agents.opinions.length >= 3);
  assert.ok(out.agents.opinions.every(o => typeof o.source === 'string' && o.source));
  await assert.rejects(runAgentTurn({ session: out.session, products, context: empty, disabled: ['nope'], request: { kind: 'view', expectedVersion: out.session.version } }), RangeError);
});

test('occasion: holidays, calendar birthdays and the holiday margin', () => {
  const chuseok = occasion({ state: mother(), text: '추석 선물', context: { today: '2027-09-01' } });
  assert.match(chuseok.opinions[0].text, /추석 D-14 \(9\/15\)/);
  assert.deepEqual(chuseok.suggestions.map(s => s.patch), [{ delivery_by: '2027-09-12' }, { packaging: 'formal' }]);
  const seollal = occasion({ state: mother(), context: { today: '2027-01-25' } });
  assert.match(seollal.opinions[0].text, /설날 D-13 \(2\/7\)/);
  const nextYear = occasion({ state: mother(), text: '생일', context: { today: '2026-12-30', calendar: [{ id: 'x', title: '어머니 생신', date: '01-03', kind: 'birthday' }] } });
  assert.match(nextYear.opinions[0].text, /D-4 \(1\/3\)/);
  assert.deepEqual(occasion({ state: mother(), context: { today: '2026-11-05' } }).opinions, []);
});

test('spending suggests a budget only when none is set', () => {
  const ctx = { purchases: [{ price_krw: 30000 }, { price_krw: 50000 }, { price_krw: 41000 }] };
  const none = spending({ state: { ...mother(), budget: { ...mother().budget, amount_krw: null } }, context: ctx });
  assert.deepEqual(none.suggestions[0].patch, { budget: { amount_krw: 41000 } });
  const high = spending({ state: { ...mother(), budget: { ...mother().budget, amount_krw: 90000 } }, context: ctx });
  assert.deepEqual(high.suggestions, []);
  assert.match(high.opinions[0].text, /평소보다 높아요/);
});

test('taste yields to a preference stated this turn; relationship suggests avoiding personal items for colleagues', () => {
  const liked = { purchases: [{ category: 'food', feedback: 'liked' }] };
  assert.deepEqual(taste({ state: mother(), context: liked }).auto, { preferences: ['category:food'] });
  const stated = taste({ state: { ...mother(), preferences: ['category:health'] }, context: liked, statedThisTurn: true });
  assert.deepEqual(stated.auto, {});
  assert.match(stated.opinions[0].text, /이번 말씀을 우선/);
  const colleague = relationship({ state: { ...mother(), recipients: ['동료'] } });
  assert.deepEqual(colleague.suggestions[0].patch.excluded_categories, ['jewelry', 'makeup']);
});
