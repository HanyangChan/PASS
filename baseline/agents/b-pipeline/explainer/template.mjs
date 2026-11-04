// Template reason tags (TRD §7). No LLM. Every tag is built from engine facts of the card itself, so it is
// always true; P5's verifier uses these as the fallback for any item the LLM gets wrong.
// Tags: 2..3 per card, each at most 12 characters. Condition A/B does not change tags (F5).
import { budgetCost } from '../../../src/vendor/engine.mjs';
import { CATEGORY_NAMES } from '../../../src/vendor/catalog.mjs';
import { parseKey } from '../memory/keys.mjs';

export const MAX_TAG = 12;

/** 15000 -> "1.5만원", 8000 -> "8천원", 8500 -> "8,500원" */
export function wonShort(n) {
  if (n >= 10000 && n % 1000 === 0) return `${n / 10000}만원`;
  if (n >= 1000 && n < 10000 && n % 1000 === 0) return `${n / 1000}천원`;
  return `${n.toLocaleString('ko-KR')}원`;
}

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
  if (ranked.length > 1 && ranked.every(p => p.id === product.id || (p.rating_count ?? 0) < (product.rating_count ?? 0))) tags.push('리뷰 가장 많음');
  const headroom = state.budget.amount_krw - budgetCost(product, state);
  tags.push(headroom > 0 ? `${wonShort(headroom)} 여유` : '예산 딱 맞음');
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

/** "아끼기 -1.5만원 · 같은 적합도" / "올리기 +9천원 · 리뷰 더 많음" — amounts are the factsheet's costDelta. */
export function ladderChip(o) {
  const sign = o.direction === 'down' ? '-' : '+';
  const why = o.direction === 'down' ? '같은 적합도' : o.reason === 'score' ? '선호에 더 맞음' : '리뷰 더 많음';
  return { direction: o.direction, label: `${o.direction === 'down' ? '아끼기' : '올리기'} ${sign}${wonShort(Math.abs(o.costDelta))} · ${why}`, amount_krw: o.amount_krw };
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
