// Template reason tags (TRD §7). No LLM. Every tag is built from engine facts of the card itself, so it is
// always true; P5's verifier uses these as the fallback for any item the LLM gets wrong.
// Tags: 2..3 per card, each at most 12 characters. Condition A/B does not change tags (F5).
import { budgetCost } from '../../../src/vendor/engine.mjs';
import { CATEGORY_NAMES } from '../../../src/vendor/catalog.mjs';
import { parseKey } from '../memory/keys.mjs';

export const MAX_TAG = 12;

/** One money format everywhere (K50): 15000 -> "1.5만원", 50000 -> "5만원", 8000 -> "8,000원", 8500 -> "8,500원" */
export function wonShort(n) {
  if (n >= 10000 && n % 1000 === 0) return `${n / 10000}만원`;
  return `${n.toLocaleString('ko-KR')}원`;
}

/** Rating as shown on the up chip: one decimal ("4.5"). */
export const ratingText = r => Number(r).toFixed(1);

/**
 * The tag of a preference that came from memory: the memory's own words and the person, not the engine category name.
 * hobby:등산 of 아버지 -> "등산 좋아하심(아버지)"; other keys use their label ("커피·차 선호(어머니)"). Shortened to fit 12.
 */
export function memoryTag(item) {
  const k = parseKey(item?.key);
  if (!k) return null;
  const phrase = k.kind === 'hobby' ? `${k.value} 좋아하심` : item.label;
  const who = item.recipientName;
  for (const t of [who && `${phrase}(${who})`, phrase, k.kind === 'hobby' && who && `${k.value}(${who})`, k.kind === 'hobby' && k.value]) {
    if (t && t.length <= MAX_TAG) return t;
  }
  return null;
}

/**
 * {"category:fitness": "등산 좋아하심(아버지)"} for category preferences whose sources are memories only
 * (a value the user said this session keeps the engine wording). First memory in memory.items order wins.
 */
export function memoryPreferenceTags(memory, provenance) {
  const out = {};
  for (const e of provenance?.preferences ?? []) {
    if (typeof e.value !== 'string' || !e.value.startsWith('category:')) continue;
    const sources = e.sources ?? [];
    if (sources.includes('utterance')) continue;
    const ids = sources.filter(s => s.startsWith('memory:')).map(s => s.slice(7));
    const m = (memory?.items ?? []).find(i => ids.includes(i.memoryId));
    const tag = m && memoryTag(m);
    if (tag) out[e.value] = tag;
  }
  return out;
}

function tagsFor(product, state, ranked, memoryTags) {
  const tags = [];
  const cat = `category:${product.category}`;
  if (state.preferences.includes(cat)) tags.push(memoryTags[cat] ?? `${CATEGORY_NAMES[product.category]} 선호`);
  const soft = state.preferences.includes('less_sweet') || state.preferences.includes('unsweetened');
  if (soft && product.sweetness === 'unsweetened') tags.push('단맛 없음');
  else if (state.preferences.includes('less_sweet') && product.sweetness === 'naturally_sweet') tags.push('자연 단맛');
  // A review count is a fact of this card only; any comparison ("가장 많음") belongs to the B contrast chip (K50).
  const reviews = (product.rating_count ?? 0) > 0 ? `리뷰 ${product.rating_count.toLocaleString('ko-KR')}개` : null;
  const headroom = state.budget.amount_krw - budgetCost(product, state);
  const room = headroom > 0 ? `${wonShort(headroom)} 여유` : '예산 딱 맞음';
  tags.push(...(reviews && tags.length < 2 ? [reviews, room] : [room])); // the review count only fills a short list (3 max)
  if (tags.length < 2) tags.unshift(CATEGORY_NAMES[product.category] ?? '예산 안');
  return tags.filter(t => t.length <= MAX_TAG).slice(0, 3);
}

const SWEET_KO = { unsweetened: '단맛 없음', naturally_sweet: '자연 단맛', sweet: '단맛 있음' };

/** Contrast chip text; every number and name comes from the factsheet's contrast facts. */
export function contrastText(c) {
  switch (c?.kind) {
    case 'preference': return `2위와 달리 ${c.categoryKo} 선호에 맞아요`;
    case 'sweetness': return `2위보다 덜 달아요 (${SWEET_KO[c.top]})`;
    case 'rating_count': return `2위보다 리뷰 ${c.diff.toLocaleString('ko-KR')}개 많아요`;
    case 'budget_cost': return `2위보다 ${wonShort(c.diff)} 저렴해요`;
    case 'category': return `2위와 종류가 달라요 (${c.top})`;
    default: return null;
  }
}

export const memoryCfText = cf => (cf ? `'${cf.label}' 기억이 없었다면 1위는 ${cf.newTopName}` : null);

/**
 * "아끼기 -1.5만원 · 같은 적합도" (amount_krw = the budget it re-runs at) /
 * "올리기 +5,000원 · 평점 4.3 → 4.6" (productId = the alternative; picking it only fills the compare tray, K50).
 * Amounts are the factsheet's costDelta, ratings its rating.from/to.
 */
export function ladderChip(o) {
  if (o.direction === 'up') return { direction: 'up', label: `올리기 +${wonShort(Math.abs(o.costDelta))} · 평점 ${ratingText(o.rating.from)} → ${ratingText(o.rating.to)}`, productId: o.productId };
  return { direction: 'down', label: `아끼기 -${wonShort(Math.abs(o.costDelta))} · 같은 적합도`, amount_krw: o.amount_krw };
}

/**
 * @param {{cards:object[], products:object[], state:object, factsheet?:object, memoryTags?:object}} p  cards = baseline result.cards,
 *   state = evaluatedState, memoryTags = memoryPreferenceTags() (defaults to the factsheet's)
 * @returns {{items:[{id, tags, contrastChip?, memoryCfLine?, ladderChips?, ladderNotice?}]}}
 * The B-only fields go on the rank-1 item and only when the factsheet has them (condition A never does, AC12).
 */
export function templateExplanations({ cards, products, state, factsheet = null, memoryTags = factsheet?.memoryTags ?? {} }) {
  const byId = new Map(products.map(p => [p.id, p]));
  const ranked = cards.map(c => byId.get(c.id)).filter(Boolean);
  const items = ranked.map(p => ({ id: p.id, tags: tagsFor(p, state, ranked, memoryTags) }));
  if (!factsheet || factsheet.experiment !== 'B' || !items.length) return { items };
  const top = items[0];
  const contrast = contrastText(factsheet.contrast);
  if (contrast) top.contrastChip = contrast;
  const cf = memoryCfText(factsheet.memoryCf);
  if (cf) top.memoryCfLine = cf;
  const ladder = factsheet.valueLadder;
  if (ladder) {
    const chips = [...ladder.down, ...ladder.up].map(ladderChip);
    if (chips.length) top.ladderChips = chips;
    if (ladder.upNotice) top.ladderNotice = ladder.upNotice;
  }
  return { items };
}
