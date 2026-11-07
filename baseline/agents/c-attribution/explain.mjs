// P3 explanations from engine facts only (no LLM). Read-only use of the frozen engine.
import { budgetAlternatives } from '../../src/index.mjs';
import { morePopular, rankProducts } from '../../src/vendor/engine.mjs';
import { categoryName } from './vocabulary.mjs';

const won = n => `${n.toLocaleString('ko-KR')}원`;
const scopeLabel = state => (state.budget.scope === 'total' ? '총예산' : '세트당 예산');
const SWEET_NOTES = {
  less_sweet: '덜 단 상품을 우선했어요(순위 점수만 조정했고, 단 상품도 후보에 남아 있어요).',
  unsweetened: '단맛 없는 상품을 우선했어요(순위 점수만 조정했고, 다른 상품도 후보에 남아 있어요).',
};

/** reason: the top card's own explanation plus notes about preferences that adjusted the score. */
function reasonOf(cards, state) {
  if (!cards.length) return null;
  const top = cards[0];
  const notes = state.preferences.flatMap(p => {
    if (SWEET_NOTES[p]) return [SWEET_NOTES[p]];
    const category = p.startsWith('category:') ? p.slice(9) : null;
    return category ? [`${categoryName(category)} 선호를 반영해 순위 점수를 더했어요.`] : [];
  });
  return { text: [top.explanation, ...notes].join(' '), productId: top.id };
}

/** contrastive: why #1 before #2, using the engine's sort order (score → popularity → price → id). */
function contrastiveOf(products, state, cards) {
  if (cards.length < 2) return null;
  const [a, b] = cards;
  const ranked = rankProducts(products, state).items.slice(0, cards.length);
  const facts = `1위 ${a.name}(적용 비용 ${won(a.budget_cost_krw)}), 2위 ${b.name}(적용 비용 ${won(b.budget_cost_krw)})예요.`;
  if (ranked.map(p => p.id).join() !== cards.map(c => c.id).join()) return { criterion: null, text: facts, productIds: [a.id, b.id] };
  const [pa, pb] = ranked;
  const base = { productIds: [a.id, b.id], scores: [pa.score, pb.score] };
  if (pa.score !== pb.score)
    return { ...base, criterion: 'score', text: `${a.name}의 선호 점수가 ${pa.score}점으로 ${b.name}(${pb.score}점)보다 높아 먼저 추천했어요.` };
  if (morePopular(pa, pb) !== 0)
    return { ...base, criterion: 'popularity', text: `선호 점수는 ${pa.score}점으로 같고, 같은 종류 안에서 ${a.name}의 인기도(리뷰 ${pa.rating_count}개)가 ${b.name}(리뷰 ${pb.rating_count}개)보다 높아 먼저 추천했어요.` };
  if (pa.price_krw !== pb.price_krw)
    return { ...base, criterion: 'price', text: `선호 점수와 인기도가 같아 상품값이 더 낮은 쪽(${a.name}, ${won(pa.price_krw)})을 ${b.name}(${won(pb.price_krw)})보다 먼저 추천했어요.` };
  return { ...base, criterion: 'id_order', text: '선호 점수·인기도·상품값이 모두 같아 정해진 상품 순서대로 놓았어요.' };
}

/** counterfactual: re-ranked budget alternative. (a) first changes/appears, (b) first stays, (c) nothing new. */
function counterfactualOf(products, state) {
  const alt = budgetAlternatives(products, state);
  if (alt.status === 'no_alternative')
    return { case: 'c', text: '다른 조건은 그대로 두고 예산만 올려도 새로 추가되는 후보가 없어요.', targetId: null, currentId: null, amount: null, delta: null };
  if (alt.status !== 'ready') return null;
  const x = alt.alternatives[0];
  const head = `${scopeLabel(state)} 상한을 ${won(x.amount)}으로 ${won(x.delta)} 올리면`;
  const common = { targetId: x.target.id, currentId: x.current?.id ?? null, amount: x.amount, delta: x.delta, effect: x.effect };
  if (x.effect === 'first_match') return { ...common, case: 'a', text: `${head} 지금은 없는 추천이 생겨요. ${x.target.name}이 후보가 돼요.` };
  if (x.effect === 'top_changed') return { ...common, case: 'a', text: `${head} 첫 번째 추천이 ${x.target.name}(으)로 달라져요.` };
  // eligible_only / top_three_changed: the first recommendation stays — never say it changes.
  return { ...common, case: 'b', text: `${head} ${x.target.name}이 후보에 추가되지만, 1위 ${x.current.name}은 그대로예요.` };
}

/**
 * explain({products, state, result}) → {reason, contrastive, counterfactual, facts}
 * products/state/result are the inputs of the common turn (state = evaluatedState). Nothing is mutated.
 */
export function explain({ products, state, result }) {
  const cards = result?.cards ?? [];
  const reason = reasonOf(cards, state);
  const contrastive = contrastiveOf(products, state, cards);
  const counterfactual = counterfactualOf(products, state);
  const facts = [];
  if (reason) facts.push({ sentence: 'reason', productIds: [cards[0].id], values: { budget_cost_krw: cards[0].budget_cost_krw, budget_cap_krw: state.budget.amount_krw, preferences: [...state.preferences] } });
  if (contrastive) facts.push({ sentence: 'contrastive', productIds: [...contrastive.productIds], values: { criterion: contrastive.criterion, budget_cost_krw: cards.slice(0, 2).map(c => c.budget_cost_krw), price_krw: cards.slice(0, 2).map(c => c.price_krw), scores: contrastive.scores ?? null } });
  if (counterfactual) facts.push({ sentence: 'counterfactual', productIds: [counterfactual.targetId, counterfactual.currentId].filter(Boolean), values: { case: counterfactual.case, amount_krw: counterfactual.amount, delta_krw: counterfactual.delta } });
  return { reason, contrastive, counterfactual, facts };
}
