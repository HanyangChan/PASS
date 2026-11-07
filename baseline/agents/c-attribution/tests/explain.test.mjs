// P3 explanations, layer A (no LLM). IDs follow ../TEST-PLAN.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LlmError } from '../../../llm/index.mjs';
import { budgetAlternatives, createSession, runTurn } from '../../../src/index.mjs';
import { explain } from '../explain.mjs';
import { createPlannedAgent } from '../planner.mjs';
import { products, READY_PATCH, readySession } from './helpers.mjs';

const item = (id, category, price, rating, extra = {}) => ({
  id, name: `${id} 상품`, category, price_krw: price, shipping_fee_per_set_krw: 0, stock_sets: 10, arrival_date: '2026-12-01',
  packaging: 'basic', sweetness: 'unknown', brand: '데모', allergens_declared: [], rating_count: rating, ...extra,
});
async function evaluate(catalog, patch) {
  const out = await runTurn({ session: createSession('p3'), products: catalog, request: { kind: 'patch', expectedVersion: 0, patch: { ...READY_PATCH, ...patch } } });
  assert.equal(out.kind, 'recommendation');
  return { products: catalog, state: out.evaluatedState, result: out.result };
}
const texts = e => [e.reason?.text, e.contrastive?.text, e.counterfactual?.text].filter(Boolean);
/** Every "N원" in the explanation must be an engine number (T3-11). */
function assertAmounts(input, e) {
  const allowed = new Set([input.state.budget.amount_krw]);
  for (const c of input.result.cards) [c.budget_cost_krw, c.price_krw, c.total_krw].forEach(n => allowed.add(n));
  for (const a of budgetAlternatives(input.products, input.state).alternatives ?? []) [a.amount, a.delta].forEach(n => allowed.add(n));
  for (const text of texts(e)) for (const [, raw] of text.matchAll(/([\d,]+)원/g)) assert.ok(allowed.has(Number(raw.replaceAll(',', ''))), `${raw}원 in "${text}"`);
}
function assertFactIds(input, e) {
  const ids = new Set(input.result.cards.map(c => c.id));
  for (const a of budgetAlternatives(input.products, input.state).alternatives ?? []) { ids.add(a.target.id); if (a.current) ids.add(a.current.id); }
  for (const f of e.facts) for (const id of f.productIds) assert.ok(ids.has(id), `${f.sentence}: ${id}`);
}
const SUITED = [item('a', 'coffee_tea', 30000, 100), item('b', 'coffee_tea', 31000, 90), item('c', 'coffee_tea', 32000, 80)];

test('T3-01 counterfactual (a): the first recommendation changes', async () => {
  const input = await evaluate(products, {});
  const e = explain(input);
  assert.equal(e.counterfactual.case, 'a'); assert.equal(e.counterfactual.targetId, 'premium'); assert.equal(e.counterfactual.amount, 60000);
  assert.match(e.counterfactual.text, /첫 번째 추천이/);
  assertAmounts(input, e); assertFactIds(input, e);
});

test('T3-02 counterfactual (b) eligible_only: the first stays, never "바뀌"', async () => {
  const input = await evaluate([...SUITED, item('d', 'toy', 55000, 10)], {});
  assert.equal(budgetAlternatives(input.products, input.state).alternatives[0].effect, 'eligible_only');
  const e = explain(input);
  assert.equal(e.counterfactual.case, 'b'); assert.doesNotMatch(e.counterfactual.text, /바뀌/); assert.match(e.counterfactual.text, /a 상품/);
  assertAmounts(input, e); assertFactIds(input, e);
});

test('T3-03 counterfactual (b) top_three_changed: still case b without "바뀌"', async () => {
  const input = await evaluate([...SUITED, item('d', 'coffee_tea', 55000, 95)], {});
  assert.equal(budgetAlternatives(input.products, input.state).alternatives[0].effect, 'top_three_changed');
  const e = explain(input);
  assert.equal(e.counterfactual.case, 'b'); assert.doesNotMatch(e.counterfactual.text, /바뀌/);
  assertAmounts(input, e);
});

test('T3-04 counterfactual (c): nothing new above the budget', async () => {
  const input = await evaluate(products, { budget: { ...READY_PATCH.budget, amount_krw: 70000 } });
  const e = explain(input);
  assert.equal(e.counterfactual.case, 'c'); assert.doesNotMatch(e.counterfactual.text, /바뀌/);
  assertAmounts(input, e);
});

test('T3-05 counterfactual first_match counts as (a)', async () => {
  const out = await runTurn({ session: createSession('p3'), products, request: { kind: 'patch', expectedVersion: 0, patch: { ...READY_PATCH, budget: { ...READY_PATCH.budget, amount_krw: 10000 } } } });
  const input = { products, state: out.evaluatedState, result: out.result };
  const e = explain(input);
  assert.equal(e.counterfactual.case, 'a'); assert.equal(e.counterfactual.targetId, 'snack'); assert.match(e.counterfactual.text, /견과 간식 세트/);
  assertAmounts(input, e);
});

test('T3-06~09 contrastive criteria follow the engine sort order', async () => {
  const score = explain(await evaluate(products, {}));
  assert.equal(score.contrastive.criterion, 'score'); assert.deepEqual(score.contrastive.scores, [1, 0]);
  const popularity = explain(await evaluate(products, { budget: { ...READY_PATCH.budget, amount_krw: 70000 } }));
  assert.equal(popularity.contrastive.criterion, 'popularity');
  const priceInput = await evaluate([item('x', 'coffee_tea', 20000, 50), item('y', 'coffee_tea', 25000, 50)], {});
  const price = explain(priceInput);
  assert.equal(price.contrastive.criterion, 'price'); assert.match(price.contrastive.text, /20,000원/); assertAmounts(priceInput, price);
  const tie = explain(await evaluate([item('y', 'coffee_tea', 20000, 50), item('x', 'coffee_tea', 20000, 50)], {}));
  assert.equal(tie.contrastive.criterion, 'id_order'); assert.deepEqual(tie.contrastive.productIds, ['x', 'y']);
});

test('T3-10 one candidate gives no contrast; no result gives no reason', async () => {
  const one = explain(await evaluate(products, { excluded_ingredients: ['견과류'] }));
  assert.equal(one.contrastive, null); assert.ok(one.reason);
  const none = await runTurn({ session: createSession('p3'), products, request: { kind: 'patch', expectedVersion: 0, patch: { ...READY_PATCH, budget: { ...READY_PATCH.budget, amount_krw: 1000 } } } });
  const e = explain({ products, state: none.evaluatedState, result: none.result });
  assert.equal(e.reason, null); assert.equal(e.contrastive, null);
});

test('T3-11~13 amounts and ids come from the engine; inputs are not changed', async () => {
  const input = await evaluate(products, { preferences: ['less_sweet'] });
  const frozen = structuredClone(input);
  const deepFreeze = x => { if (x && typeof x === 'object') { Object.values(x).forEach(deepFreeze); Object.freeze(x); } return x; };
  const e = explain(deepFreeze(input));
  assertAmounts(input, e); assertFactIds(input, e);
  assert.deepEqual(input, frozen);
  assert.ok(e.facts.length >= 2 && e.facts.every(f => typeof f.sentence === 'string' && Array.isArray(f.productIds) && f.values && typeof f.values === 'object'));
});

test('T3-14 when the engine order does not match the cards, only facts are stated', async () => {
  const input = await evaluate(products, {});
  const swapped = { ...input, result: { ...input.result, cards: [...input.result.cards].reverse() } };
  const e = explain(swapped);
  assert.equal(e.contrastive.criterion, null); assert.match(e.contrastive.text, /견과 간식 세트/); assert.match(e.contrastive.text, /차 선물 세트/);
});

test('T3-15 the planned agent attaches explanation to recommendations and comparisons only', async () => {
  const session = await readySession();
  const agent = createPlannedAgent();
  const rec = await agent.runTurn({ session, request: { kind: 'view', expectedVersion: session.version }, products });
  assert.ok(rec.explanation?.reason); assert.equal(rec.explanation.contrastive.criterion, 'score');
  const cmp = await agent.runTurn({ session, request: { kind: 'what_if_budget', amount_krw: 70000, expectedVersion: session.version }, products });
  assert.equal(cmp.explanation.counterfactual.case, 'c'); assert.equal(cmp.explanation.contrastive.criterion, 'popularity');
  const fresh = createSession('p3');
  const q = await agent.runTurn({ session: fresh, request: { kind: 'view', expectedVersion: 0 }, products });
  assert.equal(Object.hasOwn(q, 'explanation'), false);
  const err = await createPlannedAgent({ interpret: async () => { throw new LlmError('timeout'); } }).runTurn({ session, request: { kind: 'message', text: '견과류는 별로야', expectedVersion: session.version }, products });
  assert.equal(Object.hasOwn(err, 'explanation'), false);
  const { plan, explanation, ...common } = rec;
  assert.deepEqual(common, await runTurn({ session, products, request: { kind: 'view', expectedVersion: session.version } }));
});

test('T3-16 a sweetness preference is described as a ranking adjustment, not an exclusion', async () => {
  const e = explain(await evaluate(products, { preferences: ['less_sweet'] }));
  assert.match(e.reason.text, /덜 단 상품을 우선했어요/);
  for (const text of texts(e)) assert.doesNotMatch(text, /제외/);
});
