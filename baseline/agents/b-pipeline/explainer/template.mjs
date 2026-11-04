// Template reason tags (TRD §7). No LLM. Every tag is built from engine facts of the card itself, so it is
// always true; P5's verifier uses these as the fallback for any item the LLM gets wrong.
// Tags: 2..3 per card, each at most 12 characters. Condition A/B does not change tags (F5).
import { budgetCost } from '../../../src/vendor/engine.mjs';
import { CATEGORY_NAMES } from '../../../src/vendor/catalog.mjs';

export const MAX_TAG = 12;

/** 15000 -> "1.5만원", 8000 -> "8천원", 8500 -> "8,500원" */
export function wonShort(n) {
  if (n >= 10000 && n % 1000 === 0) return `${n / 10000}만원`;
  if (n >= 1000 && n < 10000 && n % 1000 === 0) return `${n / 1000}천원`;
  return `${n.toLocaleString('ko-KR')}원`;
}

function tagsFor(product, state, ranked) {
  const tags = [];
  if (state.preferences.includes(`category:${product.category}`)) tags.push(`${CATEGORY_NAMES[product.category]} 선호`);
  const soft = state.preferences.includes('less_sweet') || state.preferences.includes('unsweetened');
  if (soft && product.sweetness === 'unsweetened') tags.push('단맛 없음');
  else if (state.preferences.includes('less_sweet') && product.sweetness === 'naturally_sweet') tags.push('자연 단맛');
  if (ranked.length > 1 && ranked.every(p => p.id === product.id || (p.rating_count ?? 0) < (product.rating_count ?? 0))) tags.push('리뷰 가장 많음');
  const headroom = state.budget.amount_krw - budgetCost(product, state);
  tags.push(headroom > 0 ? `${wonShort(headroom)} 여유` : '예산 딱 맞음');
  if (tags.length < 2) tags.unshift(CATEGORY_NAMES[product.category] ?? '예산 안');
  return tags.filter(t => t.length <= MAX_TAG).slice(0, 3);
}

/**
 * @param {{cards:object[], products:object[], state:object}} p  cards = baseline result.cards, state = evaluatedState
 * @returns {{items:[{id, tags}]}}
 */
export function templateExplanations({ cards, products, state }) {
  const byId = new Map(products.map(p => [p.id, p]));
  const ranked = cards.map(c => byId.get(c.id)).filter(Boolean);
  return { items: ranked.map(p => ({ id: p.id, tags: tagsFor(p, state, ranked) })) };
}
