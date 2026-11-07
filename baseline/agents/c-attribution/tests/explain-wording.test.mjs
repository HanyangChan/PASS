// P3 follow-up (2026-11-08): score components, internal markers, Korean particles, hypothetical budget. IDs in ../TEST-PLAN.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, runTurn } from '../../../src/index.mjs';
import { rankProducts } from '../../../src/vendor/engine.mjs';
import { explain, scoreBreakdown } from '../explain.mjs';
import { createPlannedAgent } from '../planner.mjs';
import { particle } from '../vocabulary.mjs';
import { products, READY_PATCH, readySession } from './helpers.mjs';

const item = (id, category, price, rating, extra = {}) => ({
  id, name: `${id} 상품`, category, price_krw: price, shipping_fee_per_set_krw: 0, stock_sets: 10, arrival_date: '2026-12-01',
  packaging: 'basic', sweetness: 'unknown', brand: '데모', allergens_declared: [], rating_count: rating, ...extra,
});
async function evaluate(catalog, patch) {
  const out = await runTurn({ session: createSession('p3w'), products: catalog, request: { kind: 'patch', expectedVersion: 0, patch: { ...READY_PATCH, ...patch } } });
  return { products: catalog, state: out.evaluatedState, result: out.result };
}
const texts = e => [e.reason?.text, e.contrastive?.text, e.counterfactual?.text].filter(Boolean);
const engineScore = (catalog, state, id) => rankProducts(catalog, { ...state, budget: { ...state.budget, amount_krw: null } }).items.find(p => p.id === id).score;
const INTERNAL = /\b(score|popularity|price|id_order|basis|criterion|first_match|top_changed|eligible_only|top_three_changed|no_alternative|less_sweet|unsweetened|category)\b|[A-Za-z_]+:|\([abc]\)/;
const BRACKETED_PARTICLE = /\(으\)|\(이\)|이\(가\)|을\(를\)|은\(는\)|\(과\)|과\(와\)/;
const SUITED = [item('a', 'coffee_tea', 30000, 100), item('b', 'coffee_tea', 31000, 90), item('c', 'coffee_tea', 32000, 80)];

test('T3-17 score components separate recipient-group fit from stated preferences and add up to the engine score', async () => {
  const plain = await evaluate(products, {});
  const tea = scoreBreakdown(products.find(p => p.id === 'tea'), plain.state);
  assert.deepEqual(tea.components.map(c => [c.source, c.points]), [['recipient_group', 1]]);
  assert.equal(tea.total, 1); assert.equal(tea.total, engineScore(products, plain.state, 'tea'));
  assert.equal(tea.text, '어머니께 어울리는 종류(커피·차)라서 1점, 합계 1점이에요.');
  const snack = scoreBreakdown(products.find(p => p.id === 'snack'), plain.state);
  assert.deepEqual(snack.components, []); assert.equal(snack.total, 0); assert.equal(snack.total, engineScore(products, plain.state, 'snack'));
  const sweet = await evaluate(products, { preferences: ['less_sweet'] });
  const tea3 = scoreBreakdown(products.find(p => p.id === 'tea'), sweet.state);
  assert.equal(tea3.text, '어머니께 어울리는 종류(커피·차)라서 1점, 단맛이 없어 2점, 합계 3점이에요.');
  assert.equal(tea3.total, engineScore(products, sweet.state, 'tea'));
  const all = await evaluate(products, { preferences: ['less_sweet', 'category:coffee_tea'] });
  const tea6 = scoreBreakdown(products.find(p => p.id === 'tea'), all.state);
  assert.deepEqual(tea6.components.map(c => [c.source, c.points]), [['recipient_group', 1], ['preference', 2], ['preference', 3]]);
  assert.equal(tea6.total, 6); assert.equal(tea6.total, engineScore(products, all.state, 'tea'));
  // Each sweetness level with both sweetness preferences, checked against the engine.
  const sweets = [item('n', 'toy', 1000, 1, { sweetness: 'naturally_sweet' }), item('s', 'toy', 1000, 1, { sweetness: 'sweet' }), item('u', 'toy', 1000, 1, { sweetness: 'unsweetened' })];
  for (const prefs of [['less_sweet'], ['unsweetened'], ['less_sweet', 'unsweetened']]) {
    const input = await evaluate(sweets, { preferences: prefs });
    for (const p of sweets) assert.equal(scoreBreakdown(p, input.state).total, engineScore(sweets, input.state, p.id), `${prefs} ${p.id}`);
  }
  assert.match(scoreBreakdown(sweets[0], (await evaluate(sweets, { preferences: ['less_sweet'] })).state).text, /자연 단맛이라 1점/);
  const friend = await evaluate(products, { recipients: ['친구'] });
  assert.match(scoreBreakdown(products.find(p => p.id === 'snack'), friend.state).text, /^친구에게 어울리는 종류\(과자·간식\)라서 1점/);
  for (const e of [explain(plain), explain(sweet), explain(all)]) for (const text of texts(e)) assert.doesNotMatch(text, /선호 점수/, text);
  assert.match(explain(plain).contrastive.text, /어머니께 어울리는 종류\(커피·차\)라서 1점/);
  assert.deepEqual(explain(all).contrastive.breakdown.map(b => [b.productId, b.total]), [['tea', 6], ['snack', 0]]);
});

test('T3-18 user sentences carry no internal keys or case markers; basis and case are separate fields', async () => {
  const inputs = [
    await evaluate(products, {}), await evaluate(products, { preferences: ['less_sweet'] }),
    await evaluate(products, { budget: { ...READY_PATCH.budget, amount_krw: 70000 } }),
    await evaluate([...SUITED, item('d', 'toy', 55000, 10)], {}),
  ];
  for (const input of inputs) {
    const e = explain(input);
    for (const text of texts(e)) assert.doesNotMatch(text, INTERNAL, text);
    if (e.contrastive) assert.ok(['score', 'popularity', 'price', 'id_order', null].includes(e.contrastive.basis));
    if (e.counterfactual) assert.ok(['a', 'b', 'c'].includes(e.counterfactual.case));
    assert.equal(Object.hasOwn(e.contrastive ?? {}, 'criterion'), false);
  }
});

test('T3-19 particles follow the final consonant of each name', async () => {
  const words = [['홍삼', '홍삼으로', '홍삼이', '홍삼을', '홍삼은'], ['꿀', '꿀로', '꿀이', '꿀을', '꿀은'], ['녹차', '녹차로', '녹차가', '녹차를', '녹차는'], ['차 세트', '차 세트로', '차 세트가', '차 세트를', '차 세트는']];
  for (const [word, ro, ga, reul, neun] of words) {
    assert.equal(particle(word, '으로'), ro); assert.equal(particle(word, '이'), ga); assert.equal(particle(word, '을'), reul); assert.equal(particle(word, '은'), neun);
  }
  for (const [name, ro, ga] of [['홍삼', '홍삼으로', '홍삼이'], ['꿀', '꿀로', '꿀이'], ['녹차', '녹차로', '녹차가']]) {
    const base = item('base', 'coffee_tea', 30000, 10, { name: '기본 세트' });
    const changed = explain(await evaluate([base, item('top', 'coffee_tea', 60000, 50, { name })], {}));
    assert.equal(changed.counterfactual.case, 'a'); assert.match(changed.counterfactual.text, new RegExp(`첫 번째 추천이 ${ro} 달라져요`));
    const only = [item('only', 'coffee_tea', 20000, 5, { name })];
    const first = await runTurn({ session: createSession('p3w'), products: only, request: { kind: 'patch', expectedVersion: 0, patch: { ...READY_PATCH, budget: { ...READY_PATCH.budget, amount_krw: 10000 } } } });
    const firstMatch = explain({ products: only, state: first.evaluatedState, result: first.result });
    assert.match(firstMatch.counterfactual.text, new RegExp(`${ga} 후보가 돼요`));
    for (const e of [changed, firstMatch]) for (const text of texts(e)) assert.doesNotMatch(text, BRACKETED_PARTICLE, text);
  }
  const b = explain(await evaluate([...SUITED, item('d', 'toy', 55000, 10)], {}));
  assert.match(b.counterfactual.text, /d 상품이 후보에 추가되지만, 1위 a 상품은 그대로예요/);
  for (const e of [explain(await evaluate(products, {})), explain(await evaluate(products, { budget: { ...READY_PATCH.budget, amount_krw: 70000 } }))])
    for (const text of texts(e)) assert.doesNotMatch(text, BRACKETED_PARTICLE, text);
});

test('T3-20 a what-if explanation says the budget is hypothetical and the session budget is unchanged', async () => {
  const session = await readySession();
  const agent = createPlannedAgent();
  const up = await agent.runTurn({ session, request: { kind: 'what_if_budget', amount_krw: 70000, expectedVersion: 1 }, products });
  assert.deepEqual(up.explanation.hypothetical, { budget_krw: 70000, current_budget_krw: 50000 });
  assert.match(up.explanation.reason.text, /70,000원으로 올린다면/);
  assert.match(up.explanation.reason.text, /지금 적용된 세트당 예산 상한은 50,000원 그대로예요/);
  assert.doesNotMatch(up.explanation.reason.text, /예산 상한 70,000원 이하입니다/);
  assert.equal(up.session.state.budget.amount_krw, 50000); assert.equal(up.evaluatedState.budget.amount_krw, 70000);
  for (const text of texts(up.explanation)) assert.doesNotMatch(text, INTERNAL, text);
  const down = await agent.runTurn({ session, request: { kind: 'what_if_budget', amount_krw: 40000, expectedVersion: 1 }, products });
  assert.match(down.explanation.reason.text, /40,000원으로 내린다면/);
  const rec = await agent.runTurn({ session, request: { kind: 'view', expectedVersion: 1 }, products });
  assert.equal(rec.explanation.hypothetical, null);
  for (const text of texts(rec.explanation)) assert.doesNotMatch(text, /올린다면|내린다면|가정/, text);
});
