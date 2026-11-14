// ③ select (no network, deterministic): pick price-diverse representatives per keyword (spec §5).
// Usage: node scripts/catalog/web/select.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { photoChecker } from './images.mjs';
import { BLOCKED_TITLE_WORDS, CORE_TERMS, GENERIC_WORDS, TERM_ALIASES, OUTLIER_RATIO, PATHS, PER_KEYWORD, loadSeeds } from './config.mjs';

// Gift-set titles (seed keywords ending in 선물세트). Matches PR #17's gift_set flag on engine products.
export const GIFT_SET_TITLE = /선물|세트|기프트|박스|set/i;
export const MIN_GIFT_PICKS = 2;

const squash = text => text.replace(/\s+/g, '').toLowerCase();
export const normalizeTitle = title => squash(title.replace(/\[[^\]]*\]|\([^)]*\)|[^\p{L}\p{N}\s]/gu, ' '));

export function coreTerms(keyword) {
  if (CORE_TERMS[keyword]) return CORE_TERMS[keyword];
  const words = keyword.split(/\s+/).filter(word => !GENERIC_WORDS.includes(word));
  return words.length ? words : [keyword];
}

export const isRelevant = (title, keyword) => {
  const text = squash(title);
  return coreTerms(keyword).some(term => [term, ...(TERM_ALIASES[term] ?? [])].some(form => text.includes(squash(form))))
    && !BLOCKED_TITLE_WORDS.some(word => text.includes(squash(word)));
};

export const bandOf = (price, bands) => bands.find(band => price >= band.min && price <= band.max)?.id ?? null;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b), mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Returns { picked, excluded } for one keyword's parsed items (already in display order). */
// hasPhoto (optional): photo rule. Products without a usable photo are skipped at pick time, so the next
// ranked product with a photo takes the slot; the price median (rule 3) still uses every eligible item.
export function selectForKeyword(items, { keyword, priceBands, perKeyword = PER_KEYWORD, hasPhoto = null }) {
  const excluded = [];
  const drop = (item, reason) => { excluded.push({ id: item.id, reason }); return false; };
  // search_rank counts organic results only (ads never get a rank).
  let organicRank = 0;
  const ranked = items.map(item => ({ ...item, search_rank: item.is_ad ? null : ++organicRank }));

  // Rule 1: ads, missing prices, sold out.  Rule 2: relevance and blocked words.
  const eligible = ranked.filter(item =>
    item.is_ad ? drop(item, 'ad')
      : !(item.price > 0) ? drop(item, 'no_price')
      : item.sold_out ? drop(item, 'sold_out')
      : !isRelevant(item.title, keyword) ? drop(item, 'irrelevant')
      : true);
  // Rule 3: price outliers against this keyword's median.
  const mid = eligible.length ? median(eligible.map(item => item.price)) : 0;
  const priced = eligible.filter(item =>
    item.price < mid * OUTLIER_RATIO[0] || item.price > mid * OUTLIER_RATIO[1] ? drop(item, 'price_outlier') : true)
    .map(item => ({ ...item, price_band: bandOf(item.price, priceBands) }))
    .filter(item => item.price_band ? true : drop(item, 'outside_bands'));

  // Gift-set rule: for "…선물세트" seeds, prefer titles that read as a gift set; relax only to reach MIN_GIFT_PICKS.
  const giftRule = keyword.trim().endsWith('선물세트');
  const gifts = giftRule ? priced.filter(item => GIFT_SET_TITLE.test(item.title)) : priced;
  const others = giftRule ? priced.filter(item => !GIFT_SET_TITLE.test(item.title)) : [];

  // Rule 5: one per mall/brand, no duplicate products. Rule 4: best rank of each distinct band first.
  const picked = [], malls = new Set(), brands = new Set(), ids = new Set(), titles = new Set(), usedBands = new Set();
  const conflicts = item => (item.mall && malls.has(item.mall)) || (item.brand && brands.has(item.brand))
    || ids.has(item.id) || titles.has(normalizeTitle(item.title));
  // Photo rule, checked only for a product about to be picked: without a photo it is skipped for good.
  const noPhoto = new Set();
  const photoOk = item => !hasPhoto || (!noPhoto.has(item.id) && (hasPhoto(item) || (noPhoto.add(item.id), drop(item, 'no_photo'))));
  const take = (item, giftSet) => {
    picked.push({ ...item, gift_set: giftSet });
    if (item.mall) malls.add(item.mall);
    if (item.brand) brands.add(item.brand);
    ids.add(item.id);
    titles.add(normalizeTitle(item.title));
    usedBands.add(item.price_band);
  };
  const pickFrom = (list, giftSet, limit) => {
    for (const item of list) {
      if (picked.length >= limit) return;
      if (!usedBands.has(item.price_band) && !conflicts(item) && photoOk(item)) take(item, giftSet);
    }
    for (const item of list) {
      if (picked.length >= limit) return;
      if (!ids.has(item.id) && !conflicts(item) && photoOk(item)) take(item, giftSet);
    }
  };
  pickFrom(gifts, giftRule ? true : null, perKeyword);
  if (giftRule && picked.length < MIN_GIFT_PICKS) pickFrom(others, false, perKeyword);
  for (const item of others) if (!ids.has(item.id) && !noPhoto.has(item.id)) drop(item, 'not_gift_set');
  return { picked, excluded, median_price: mid || null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { priceBands } = loadSeeds();
  // Photo rule: a photo copied/downloaded by images.mjs, or one a saved page holds. Run images.mjs, then
  // select.mjs again: the result is the same for the same files on disk.
  const hasPhoto = photoChecker();
  const replacements = [];
  const lines = readFileSync(PATHS.parsed, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const keywords = lines.map(({ items, ...record }) => {
    const { picked, excluded, median_price } = selectForKeyword(items, { keyword: record.keyword, priceBands, hasPhoto });
    const without = selectForKeyword(items, { keyword: record.keyword, priceBands }).picked.map(p => p.id);
    const now = picked.map(p => p.id);
    const removed = without.filter(id => !now.includes(id)), added = now.filter(id => !without.includes(id));
    if (removed.length || added.length) replacements.push({ occasion: record.occasion, keyword: record.keyword, removed, added });
    const reasons = Object.groupBy(excluded, entry => entry.reason);
    return { ...record, result_count: items.length, median_price, picked,
      excluded_counts: Object.fromEntries(Object.entries(reasons).map(([reason, list]) => [reason, list.length])) };
  });
  writeFileSync(PATHS.selected, JSON.stringify({ per_keyword: PER_KEYWORD, photo_replacements: replacements, keywords }, null, 1));
  const short = keywords.filter(entry => entry.picked.length < 2).map(entry => `${entry.occasion}/${entry.keyword}(${entry.picked.length})`);
  console.log(JSON.stringify({ keywords: keywords.length, products: keywords.reduce((n, entry) => n + entry.picked.length, 0), under_two: short, photo_replacements: replacements }));
}
