import test from 'node:test';
import assert from 'node:assert/strict';
import { initial, rankProducts, recommend, APP_RANKING, feedbackWeights } from '../lib/engine.mjs';
// Keep the shared core's explicitly selected legacy option under regression coverage.
const LEGACY = { ...APP_RANKING, contextualFeedback: false };

const p = (id, category, price, rating_count = 10) => ({ id, name: id, category, price_krw: price, shipping_fee_per_set_krw: 0, stock_sets: 10, arrival_date: '2026-12-01', packaging: 'basic', sweetness: 'unknown', brand: null, allergens_declared: [], rating_count });
const catalog = [
  p('tea-a', 'coffee_tea', 40000, 90), p('tea-b', 'coffee_tea', 38000, 80),
  p('cream-a', 'beauty', 39000, 50), p('cream-b', 'beauty', 41000, 40),
  p('cookie-a', 'snack', 42000, 100), p('cookie-b', 'snack', 36000, 70),
];
const mother = { ...initial(), recipients: ['어머니'], quantity: 1, same_product: true, budget: { amount_krw: 50000, scope: 'per_set', shipping_included: true } };
const ids = r => r.items.map(i => i.id);

test('without feedback the ranking is unchanged and carries no feedback field', () => {
  const plain = rankProducts(catalog, mother, APP_RANKING);
  assert.deepEqual(plain, rankProducts(catalog, mother, { ...APP_RANKING, feedback: { liked: [], disliked: [] } }));
  assert.ok(plain.items.every(i => !('feedback_score' in i)));
});

test('likes raise the category, dislikes lower it, and both show in the score', () => {
  const before = rankProducts(catalog, mother, APP_RANKING);
  const after = rankProducts(catalog, mother, { ...LEGACY, feedback: { liked: ['cream-a'], disliked: ['cookie-a'] } });
  const score = (r, id) => r.items.find(i => i.id === id);
  assert.equal(score(after, 'cream-b').score, score(before, 'cream-b').score + 1);
  assert.equal(score(after, 'cream-b').feedback_score, 1);
  assert.equal(score(after, 'cookie-b').feedback_score, -1);
  assert.ok(ids(after).indexOf('cream-b') < ids(before).indexOf('cream-b'), 'liked category moves up');
  assert.ok(ids(before).indexOf('cookie-a') < ids(before).indexOf('cream-a'), 'before: the cookie outranks the cream');
  assert.ok(ids(after).slice(-2).every(id => id.startsWith('cookie')), 'disliked category sinks below the others');
  assert.equal(ids(after).at(-1), 'cookie-a', 'the disliked product itself is last');
});

test('a product marked unhelpful drops out of the top three; category weight is capped at ±2', () => {
  const top = ids(recommend(catalog, mother, APP_RANKING));
  const disliked = top[0];
  assert.ok(!ids(recommend(catalog, mother, { ...LEGACY, feedback: { liked: [], disliked: [disliked] } })).includes(disliked));
  const weights = feedbackWeights(catalog, { liked: ['cream-a', 'cream-a', 'cream-b', 'cream-b'], disliked: ['ghost-id'] });
  assert.equal(weights.categories.beauty, 2);
  assert.equal(weights.categories.snack, undefined);
});

test('feedback never brings back excluded or over-budget products', () => {
  const strict = { ...mother, excluded_categories: ['beauty'], budget: { ...mother.budget, amount_krw: 39000 } };
  const out = rankProducts(catalog, strict, { ...APP_RANKING, feedback: { liked: ['cream-a', 'cookie-a'], disliked: [] } });
  assert.ok(out.items.every(i => i.category !== 'beauty' && i.price_krw <= 39000));
});
