// P7 / AC1 (K59): baseline runTurn on engineState(public state) gives the same cards, order and amounts as main's
// recommendationView(...).result. Main's side runs the proto/ engine and baseline's side runs src/vendor/engine.mjs, so this fails if the two engines drift apart.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, runTurn } from '../../../src/index.mjs';
import { initial as baselineInitial } from '../../../src/vendor/engine.mjs';
import { initial, budgetCost } from '../proto/lib/engine.mjs';
import { engineState, singleInitial, publicState } from '../proto/lib/single-gift.mjs';
import { recommendationView } from '../proto/api/worker.mjs';
import { products } from './fixtures/catalog.mjs';

const state = patch => ({ ...singleInitial(), ...patch, budget: { ...singleInitial().budget, ...(patch.budget ?? {}) } });
const CASES = {
  'S1 부모님 5만 원, 배송비 포함': state({ recipients: ['부모님'], occasion: '추석', budget: { amount_krw: 50000, shipping_included: true } }),
  'S1 + 단 거 싫어함·땅콩 제외': state({ recipients: ['부모님'], budget: { amount_krw: 50000, shipping_included: true }, preferences: ['less_sweet'], excluded_ingredients: ['땅콩'] }),
  'S3 친구 3만 원 커피': state({ recipients: ['친구'], budget: { amount_krw: 30000, shipping_included: true }, preferences: ['커피'] }),
  'S4 직장동료 3만 원 격식 포장': state({ recipients: ['직장동료'], budget: { amount_krw: 30000, shipping_included: true }, packaging: 'formal' }),
  '배송비 별도': state({ recipients: ['부모님'], budget: { amount_krw: 40000, shipping_included: false } }),
  '예산이 너무 낮아 후보 없음': state({ recipients: ['부모님'], budget: { amount_krw: 3000, shipping_included: true } }),
  '카테고리 제외': state({ recipients: ['부모님'], budget: { amount_krw: 50000, shipping_included: true }, excluded_categories: ['food'] }),
};
const baselineSession = s => ({ ...createSession('parity'), state: engineState(s) });

test('proto engine and baseline engine start from the same state shape (K59)', () => {
  assert.deepEqual(initial(), baselineInitial());
});

for (const [name, s] of Object.entries(CASES)) {
  test(`AC1: ${name}`, async () => {
    const session = baselineSession(s);
    const turn = await runTurn({ session, request: { kind: 'view', expectedVersion: session.version }, products });
    const main = recommendationView({ state: s, issues: [] }, products).result;
    assert.equal(turn.kind, 'recommendation');
    assert.equal(turn.result.status, main.status);
    // baseline cards = {id, rank, price_krw, budget_cost_krw, total_krw, score}; main items = engine products with total/score.
    const cost = engineState(s);
    assert.deepEqual(
      turn.result.cards.map(c => [c.id, c.rank, c.price_krw, c.budget_cost_krw, c.total_krw, c.score]),
      main.items.map((p, i) => [p.id, i + 1, p.price_krw, budgetCost(p, cost), p.total, p.score]),
      '상품·순위·금액·점수가 main과 같아야 한다');
  });
}

test('AC1: 세 가지 이상 서로 다른 결과를 비교한다 (빈 결과만 통과하지 않도록)', async () => {
  const ids = new Set();
  for (const s of Object.values(CASES)) {
    const session = baselineSession(s);
    const turn = await runTurn({ session, request: { kind: 'view', expectedVersion: 0 }, products });
    for (const card of turn.result.cards ?? []) ids.add(card.id);
  }
  assert.ok(ids.size >= 6, `상품 ${ids.size}개만 비교됨`);
});

test('engineState fills quantity 1 / per_set and publicState removes them again', () => {
  const s = CASES['S1 부모님 5만 원, 배송비 포함'];
  const e = engineState(s);
  assert.equal(e.quantity, 1);
  assert.equal(e.budget.scope, 'per_set');
  assert.deepEqual(publicState(e), s);
});
