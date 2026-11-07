// T5: seeded random constraint check through the c-attribution planned agent (no LLM, no external packages).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { budgetAlternatives, createSession } from '../../../src/index.mjs';
import { validateCatalog, validateState } from '../../../src/contracts.mjs';
import { ALLERGEN_NAMES } from '../../../src/vendor/allergens.mjs';
import { CATEGORIES } from '../../../src/vendor/catalog.mjs';
import { scoreBreakdown } from '../explain.mjs';
import { createPlannedAgent } from '../planner.mjs';

const INTERNAL = /\b(score|popularity|price|id_order|basis|first_match|top_changed|eligible_only|top_three_changed|no_alternative|less_sweet|unsweetened|category)\b|[A-Za-z_]+:|\([abc]\)/;
const BRACKETED_PARTICLE = /\(으\)|\(이\)|이\(가\)|을\(를\)|은\(는\)/;

/** mulberry32: tiny seeded PRNG, written here so the test needs no package. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEED = 20261107, CASES = 300;

function generate(seed) {
  const rnd = mulberry32(seed);
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pick = list => list[int(0, list.length - 1)];
  const some = (list, max) => [...new Set(Array.from({ length: int(0, max) }, () => pick(list)))];
  const date = () => `2026-12-${String(int(1, 20)).padStart(2, '0')}`;
  const cases = [];
  for (let n = 0; n < CASES; n++) {
    const catalog = Array.from({ length: int(5, 15) }, (_, i) => ({
      id: `p${n}-${i}`, name: `상품 ${i}`, category: pick(CATEGORIES), price_krw: int(1, 100) * 1000,
      shipping_fee_per_set_krw: int(0, 10) * 500, stock_sets: int(0, 20), arrival_date: date(),
      packaging: pick(['basic', 'formal']), sweetness: pick(['unknown', 'unsweetened', 'naturally_sweet', 'sweet']),
      brand: pick(['A', 'B']), allergens_declared: some(ALLERGEN_NAMES, 2), rating_count: int(0, 500),
    }));
    const quantity = int(1, 3);
    const patch = {
      recipients: [pick(['어머니', '친구', '동료'])], quantity, same_product: true,
      budget: { amount_krw: int(5, 150) * 1000, scope: pick(['per_set', 'total']), shipping_included: rnd() < 0.5 },
      preferences: some(['less_sweet', 'unsweetened', ...CATEGORIES.map(c => `category:${c}`)], 2),
      excluded_ingredients: some(ALLERGEN_NAMES, 2), excluded_categories: some(CATEGORIES, 2),
      brand: rnd() < 0.2 ? pick(['A', 'B']) : null, packaging: rnd() < 0.2 ? pick(['basic', 'formal']) : null,
      delivery_by: rnd() < 0.2 ? date() : null,
    };
    cases.push({ catalog, patch });
  }
  return cases;
}

/** Independent checker (does not reuse the common resultFor). */
function violations(card, product, state) {
  const unit = product.price_krw + (state.budget.shipping_included ? product.shipping_fee_per_set_krw : 0);
  const cost = state.budget.scope === 'total' ? unit * state.quantity : unit;
  const found = [];
  if (cost > state.budget.amount_krw) found.push('budget');
  if (product.allergens_declared.some(a => state.excluded_ingredients.includes(a))) found.push('ingredient');
  if (state.excluded_categories.includes(product.category)) found.push('category');
  if (product.stock_sets < state.quantity) found.push('stock');
  if (state.brand && product.brand !== state.brand) found.push('brand');
  if (state.packaging && product.packaging !== state.packaging) found.push('packaging');
  if (state.delivery_by && product.arrival_date > state.delivery_by) found.push('delivery');
  if (card.budget_cost_krw !== cost) found.push('cost_mismatch');
  return found;
}

test('T5-01~06 random catalogs and conditions never break constraints through the planned agent', async () => {
  const cases = generate(SEED);
  assert.equal(createHash('sha256').update(JSON.stringify(cases)).digest('hex'), createHash('sha256').update(JSON.stringify(generate(SEED))).digest('hex'));
  const agent = createPlannedAgent();
  let cards = 0;
  for (const [n, { catalog, patch }] of cases.entries()) {
    validateCatalog(catalog);
    const out = await agent.runTurn({ session: createSession(`t5-${n}`), request: { kind: 'patch', expectedVersion: 0, patch }, products: catalog });
    validateState(out.session.state);
    assert.equal(out.kind, 'recommendation', `case ${n}`);
    const state = out.evaluatedState;
    for (const card of out.result.cards) {
      cards++;
      const product = catalog.find(p => p.id === card.id);
      assert.deepEqual(violations(card, product, state), [], `case ${n} card ${card.id}`);
      // T3-17: score components add up to the engine score of every card.
      assert.equal(scoreBreakdown(product, state).total, card.score, `case ${n} card ${card.id} score`);
    }
    // T5-06: every amount in the explanation is an engine number.
    const allowed = new Set([state.budget.amount_krw]);
    for (const c of out.result.cards) [c.budget_cost_krw, c.price_krw, c.total_krw].forEach(x => allowed.add(x));
    for (const a of budgetAlternatives(catalog, state).alternatives ?? []) [a.amount, a.delta].forEach(x => allowed.add(x));
    for (const text of [out.explanation?.reason?.text, out.explanation?.contrastive?.text, out.explanation?.counterfactual?.text].filter(Boolean))
      for (const [, raw] of text.matchAll(/([\d,]+)원/g)) assert.ok(allowed.has(Number(raw.replaceAll(',', ''))), `case ${n}: ${raw}원 in "${text}"`);
  }
  assert.ok(cards > 100, `too few cards checked: ${cards}`);
});

test('T3-18/19 random explanations have no internal keys or bracketed particles', async () => {
  const agent = createPlannedAgent();
  for (const [n, { catalog, patch }] of generate(SEED).entries()) {
    const out = await agent.runTurn({ session: createSession(`t5w-${n}`), request: { kind: 'patch', expectedVersion: 0, patch }, products: catalog });
    for (const text of [out.explanation?.reason?.text, out.explanation?.contrastive?.text, out.explanation?.counterfactual?.text].filter(Boolean)) {
      assert.doesNotMatch(text, INTERNAL, `case ${n}: ${text}`);
      assert.doesNotMatch(text, BRACKETED_PARTICLE, `case ${n}: ${text}`);
    }
  }
});
