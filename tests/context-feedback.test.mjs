import test from 'node:test';
import assert from 'node:assert/strict';
import { recommend, APP_RANKING, rankProducts } from '../lib/engine.mjs';
import { recommend as vendorRecommend } from '../baseline/src/vendor/engine.mjs';
import { budgetAlternatives } from '../lib/counterfactual.mjs';
import { feedbackContext, validProductFeedback } from '../lib/feedback.mjs';
import { products, state, record, options, scope, product } from './fixtures/context-feedback.mjs';
const ids = r => r.items.map(p => p.id);

test('the reported category lock-in cannot override birthday, exam or an explicit watch request', () => {
  const legacy = { liked: ['tea-a', 'tea-b'], disliked: ['watch-old1', 'watch-old2'] };
  const cases = [state(), state({ recipients: ['친구'], occasion: '수험' }), state({ recipients: ['아버지'], preferences: ['category:watch'] })];
  for (const s of cases) assert.deepEqual(recommend(products, s, { ...APP_RANKING, feedback: legacy }), recommend(products, s, APP_RANKING));
  assert.equal(ids(recommend(products, cases[0], APP_RANKING))[0], 'flower');
  assert.equal(ids(recommend(products, cases[1], APP_RANKING))[0], 'exam');
  assert.ok(ids(recommend(products, cases[2], APP_RANKING)).every(id => id.startsWith('watch')));
});

test('relevant product preference changes equal candidates, never every product of a category', () => {
  const s = state({ preferences: ['category:coffee_tea'] });
  const records = [record(products[1], s)];
  const after = recommend(products, s, options(records));
  assert.equal(after.items[0].id, 'tea-b');
  assert.equal(after.items[0].feedback_score, 1);
  assert.ok(after.items.slice(1).every(p => p.feedback_score === undefined));
  assert.equal(after.items[0].score, recommend(products, s, APP_RANKING).items[0].score);
  assert.deepEqual(ids(after), ids(vendorRecommend(products, s, options(records))));
});

test('current item preference and occasion suitability rank before even related feedback', () => {
  const watch = state({ recipients: ['아버지'], preferences: ['category:watch'] });
  const opposing = products.map(p => record(p, watch, p.category === 'coffee_tea'));
  assert.ok(recommend(products, watch, options(opposing)).items.every(p => p.category === 'watch'));
  const birthday = state();
  assert.equal(recommend(products, birthday, options(products.slice(0, 3).map(p => record(p, birthday)))).items[0].id, 'flower');
});

for (const [label, patch] of [['recipient', { recipients: ['친구'] }], ['occasion', { occasion: '수험' }],
  ['taste', { preferences: ['type:tea'] }], ['budget', { budget: { amount_krw: 45000, scope: 'per_set', shipping_included: true } }],
  ['exclusion', { excluded_ingredients: ['우유'] }], ['deadline', { delivery_by: '2026-12-02' }]]) {
  test(`changing ${label} makes earlier feedback irrelevant`, () => {
    const s = state(patch), records = [record(products[1], state())];
    assert.deepEqual(recommend(products, s, options(records)), recommend(products, s, APP_RANKING));
  });
}

test('same recipient label in another conversation does not identify the same person', () => {
  const s = state({ recipients: ['친구'] });
  assert.deepEqual(recommend(products, s, options([record(products[1], s)], 'other-conversation')), recommend(products, s, APP_RANKING));
});

test('legacy, explanation-only, malformed and wrong-source records have no effect', () => {
  const s = state(), good = record(products[1], s);
  for (const extra of [{ kind: undefined }, { kind: 'reason_helpfulness' }, { version: 1 }, { at: 'not-date' },
    { context: null }, { productKey: 'other-source:tea-b' }]) {
    assert.deepEqual(recommend(products, s, options([{ ...good, ...extra }])), recommend(products, s, APP_RANKING));
  }
  assert.equal(validProductFeedback({ ...good, helpful: 'true' }), false);
});

test('the latest answer is selected by situation, even with out-of-order input', () => {
  const s = state({ preferences: ['category:coffee_tea'] });
  const newer = record(products[1], s, false, { at: '2026-11-16T02:00:00Z' });
  const records = [newer, record(products[1], s), record(products[1], state(), true, { at: '2026-11-16T03:00:00Z' })];
  assert.equal(rankProducts(products, s, options(records)).items.find(p => p.id === 'tea-b').feedback_score, -1);
});

test('exclusions, stock, deadline, packaging and delivered cost remain hard constraints', () => {
  const s = state({ preferences: ['category:coffee_tea'], excluded_ingredients: ['우유'], packaging: 'formal', delivery_by: '2026-12-01' });
  const bad = [product('allergen', 'coffee_tea', { packaging: 'formal', allergens_declared: ['우유'] }),
    product('shipping', 'coffee_tea', { packaging: 'formal', shipping_fee_per_set_krw: 20000 }),
    product('stock', 'coffee_tea', { packaging: 'formal', stock_sets: 0 }), product('packaging'),
    product('late', 'coffee_tea', { packaging: 'formal', arrival_date: '2026-12-02' })];
  assert.deepEqual(recommend(bad, s, options(bad.map(p => record(p, s)))).items, []);
});

test('budget comparisons use the same selection rule and preserve input state and records', () => {
  const s = state({ preferences: ['category:coffee_tea'] });
  const data = [...products, product('premium', 'coffee_tea', { price_krw: 60000 })];
  const opts = options([record(products[1], s)]), before = structuredClone({ s, opts });
  const result = budgetAlternatives(data, s, opts);
  assert.equal(result.status, 'ready');
  assert.deepEqual({ s, opts }, before);
});

test('set order and duplicates in conditions do not change feedback identity', () => {
  const s = state({ preferences: ['type:tea', 'category:coffee_tea'] });
  assert.deepEqual(feedbackContext(s, scope), feedbackContext({ ...s, preferences: ['category:coffee_tea', 'type:tea', 'type:tea'] }, scope));
});

test('a vote for a now unavailable candidate cannot change the remaining ranking', () => {
  const unavailable = product('gone', 'coffee_tea', { stock_sets: 0 });
  const data = [...products, unavailable], s = state();
  assert.deepEqual(recommend(data, s, options([record(unavailable, s)])), recommend(data, s, APP_RANKING));
});
