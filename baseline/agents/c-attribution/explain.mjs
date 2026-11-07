// P3 explanations from engine facts only (no LLM). Read-only use of the frozen engine.
// User-facing sentences never contain internal keys; machine fields (basis, case, breakdown) sit beside them.
import { budgetAlternatives } from '../../src/index.mjs';
import { recipientCategories } from '../../src/vendor/catalog.mjs';
import { morePopular, rankProducts } from '../../src/vendor/engine.mjs';
import { categoryName, particle } from './vocabulary.mjs';

const won = n => `${n.toLocaleString('ko-KR')}원`;
const scopeLabel = state => (state.budget.scope === 'total' ? '총예산' : '세트당 예산');
const HONORIFIC = ['어머니', '아버지', '부모님', '교수님'];
const SWEET_NOTES = {
  less_sweet: '덜 단 상품을 우선했어요(순위 점수만 조정했고, 단 상품도 후보에 남아 있어요).',
  unsweetened: '단맛 없는 상품을 우선했어요(순위 점수만 조정했고, 다른 상품도 후보에 남아 있어요).',
};
const SWEET_POINTS = { unsweetened: 2, naturally_sweet: 1, sweet: 0 };
const SWEET_WORDS = { unsweetened: '단맛이 없어', naturally_sweet: '자연 단맛이라' };

function recipientPhrase(recipients) {
  const name = recipients.join('·');
  return `${name}${recipients.every(r => HONORIFIC.includes(r) || r.endsWith('님')) ? '께' : '에게'}`;
}

/**
 * scoreBreakdown(product, state) → {total, components:[{source, key, points, text}], text}
 * Mirrors the engine score: +1 when the category suits the recipient group, plus each stated preference
 * (category +3; unsweetened +2 for unsweetened items; less_sweet +2/+1/0 by sweetness). Zero items are omitted.
 */
export function scoreBreakdown(product, state) {
  const components = [];
  if (recipientCategories(state.recipients).has(product.category))
    components.push({ source: 'recipient_group', key: product.category, points: 1, text: `${recipientPhrase(state.recipients)} 어울리는 종류(${categoryName(product.category)})라서 1점` });
  for (const pref of state.preferences) {
    if (pref === `category:${product.category}`)
      components.push({ source: 'preference', key: pref, points: 3, text: `말씀하신 ${categoryName(product.category)} 선호에 맞아 3점` });
    else if (pref === 'unsweetened' && product.sweetness === 'unsweetened')
      components.push({ source: 'preference', key: pref, points: 2, text: '단맛이 없어 2점' });
    else if (pref === 'less_sweet' && SWEET_POINTS[product.sweetness])
      components.push({ source: 'preference', key: pref, points: SWEET_POINTS[product.sweetness], text: `${SWEET_WORDS[product.sweetness]} ${SWEET_POINTS[product.sweetness]}점` });
  }
  const total = components.reduce((n, c) => n + c.points, 0);
  const text = components.length ? `${components.map(c => c.text).join(', ')}, 합계 ${total}점이에요.` : '어울리는 종류나 말씀하신 선호에 해당하지 않아 0점이에요.';
  return { total, components, text };
}

/** reason: why the top card, with its score components. In a what-if it states the budget is hypothetical. */
function reasonOf(products, cards, state, hypothetical) {
  if (!cards.length) return null;
  const top = cards[0];
  const product = products.find(p => p.id === top.id);
  const notes = state.preferences.filter(p => SWEET_NOTES[p]).map(p => SWEET_NOTES[p]);
  const score = product ? `${particle(top.name, '은')} ${scoreBreakdown(product, state).text}` : null;
  const head = hypothetical
    ? `${scopeLabel(state)} 상한을 ${won(hypothetical.budget_krw)}으로 ${hypothetical.budget_krw > hypothetical.current_budget_krw ? '올린' : hypothetical.budget_krw < hypothetical.current_budget_krw ? '내린' : '그대로 둔'}다면 1위는 ${top.name}(적용 비용 ${won(top.budget_cost_krw)})예요. 지금 적용된 ${scopeLabel(state)} 상한은 ${won(hypothetical.current_budget_krw)} 그대로예요.`
    : top.explanation;
  return { text: [head, score, ...notes].filter(Boolean).join(' '), productId: top.id };
}

/** contrastive: why #1 before #2, using the engine's sort order (score → popularity → price → id). */
function contrastiveOf(products, state, cards) {
  if (cards.length < 2) return null;
  const [a, b] = cards;
  const ranked = rankProducts(products, state).items.slice(0, cards.length);
  if (ranked.map(p => p.id).join() !== cards.map(c => c.id).join())
    return { basis: null, text: `1위 ${a.name}(적용 비용 ${won(a.budget_cost_krw)}), 2위 ${b.name}(적용 비용 ${won(b.budget_cost_krw)})예요.`, productIds: [a.id, b.id], scores: null, breakdown: null };
  const [pa, pb] = ranked;
  const breakdown = [pa, pb].map(p => ({ productId: p.id, ...scoreBreakdown(p, state) }));
  const base = { productIds: [a.id, b.id], scores: [pa.score, pb.score], breakdown };
  if (pa.score !== pb.score)
    return { ...base, basis: 'score', text: `${particle(a.name, '은')} ${breakdown[0].text} ${particle(b.name, '은')} ${breakdown[1].text} 점수가 더 높은 ${particle(a.name, '을')} 먼저 추천했어요.` };
  const both = `${particle(a.name, '과')} ${b.name} 모두 추천 점수가 ${pa.score}점으로 같아요.`;
  if (morePopular(pa, pb) !== 0) {
    const which = pa.category === pb.category ? '같은 종류 안에서 리뷰가 더 많은' : '각자 종류 안에서 인기도가 더 높은';
    return { ...base, basis: 'popularity', text: `${both} ${which} ${particle(a.name, '을')} 먼저 추천했어요(리뷰 ${pa.rating_count}개, ${b.name} 리뷰 ${pb.rating_count}개).` };
  }
  if (pa.price_krw !== pb.price_krw)
    return { ...base, basis: 'price', text: `${both} 인기도도 같아서 상품값이 더 낮은 ${particle(a.name, '을')} 먼저 추천했어요(${won(pa.price_krw)}, ${b.name} ${won(pb.price_krw)}).` };
  return { ...base, basis: 'id_order', text: `${both} 인기도와 상품값도 같아서 정해진 상품 순서대로 놓았어요.` };
}

/** counterfactual: re-ranked budget alternative. case a: first changes/appears, b: first stays, c: nothing new. */
function counterfactualOf(products, state, hypothetical) {
  const alt = budgetAlternatives(products, state);
  if (alt.status === 'no_alternative') {
    const text = hypothetical ? '가정한 예산에서 더 올려도 새로 추가되는 후보가 없어요.' : '다른 조건은 그대로 두고 예산만 올려도 새로 추가되는 후보가 없어요.';
    return { case: 'c', text, targetId: null, currentId: null, amount: null, delta: null };
  }
  if (alt.status !== 'ready') return null;
  const x = alt.alternatives[0];
  const head = hypothetical
    ? `가정한 예산보다 ${won(x.delta)} 더 올려 ${scopeLabel(state)} 상한이 ${won(x.amount)}이면`
    : `${scopeLabel(state)} 상한을 ${won(x.amount)}으로 ${won(x.delta)} 올리면`;
  const common = { targetId: x.target.id, currentId: x.current?.id ?? null, amount: x.amount, delta: x.delta, effect: x.effect };
  if (x.effect === 'first_match') return { ...common, case: 'a', text: `${head} 지금은 없는 추천이 생겨요. ${particle(x.target.name, '이')} 후보가 돼요.` };
  if (x.effect === 'top_changed') return { ...common, case: 'a', text: `${head} 첫 번째 추천이 ${particle(x.target.name, '으로')} 달라져요.` };
  // eligible_only / top_three_changed: the first recommendation stays — never say it changes.
  return { ...common, case: 'b', text: `${head} ${particle(x.target.name, '이')} 후보에 추가되지만, 1위 ${particle(x.current.name, '은')} 그대로예요.` };
}

/**
 * explain({products, state, result, currentBudget?}) → {reason, contrastive, counterfactual, facts, hypothetical}
 * state is the evaluated state of the common turn. When currentBudget differs from it (a what-if comparison),
 * sentences say the budget is hypothetical and that the applied budget is unchanged. Nothing is mutated.
 */
export function explain({ products, state, result, currentBudget }) {
  const cards = result?.cards ?? [];
  const hypothetical = Number.isSafeInteger(currentBudget) && currentBudget !== state.budget.amount_krw
    ? { budget_krw: state.budget.amount_krw, current_budget_krw: currentBudget } : null;
  const reason = reasonOf(products, cards, state, hypothetical);
  const contrastive = contrastiveOf(products, state, cards);
  const counterfactual = counterfactualOf(products, state, hypothetical);
  const facts = [];
  if (reason) {
    const top = products.find(p => p.id === cards[0].id);
    facts.push({ sentence: 'reason', productIds: [cards[0].id], values: { budget_cost_krw: cards[0].budget_cost_krw, budget_cap_krw: state.budget.amount_krw, current_budget_krw: hypothetical?.current_budget_krw ?? null, score_total: top ? scoreBreakdown(top, state).total : null, preferences: [...state.preferences] } });
  }
  if (contrastive) facts.push({ sentence: 'contrastive', productIds: [...contrastive.productIds], values: { basis: contrastive.basis, budget_cost_krw: cards.slice(0, 2).map(c => c.budget_cost_krw), price_krw: cards.slice(0, 2).map(c => c.price_krw), scores: contrastive.scores } });
  if (counterfactual) facts.push({ sentence: 'counterfactual', productIds: [counterfactual.targetId, counterfactual.currentId].filter(Boolean), values: { case: counterfactual.case, amount_krw: counterfactual.amount, delta_krw: counterfactual.delta } });
  return { reason, contrastive, counterfactual, facts, hypothetical };
}
