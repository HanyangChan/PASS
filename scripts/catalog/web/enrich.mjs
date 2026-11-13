// ④ enrich (no network): selected.json → supabase/seed/products-kr.json (spec §4, §6).
// Usage: node scripts/catalog/web/enrich.mjs
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tagAllergens } from '../../../lib/allergens.mjs';
import { CATEGORIES } from '../../../lib/catalog.mjs';
import { PATHS, SITES, path } from './config.mjs';

export const CATEGORY_MAP = JSON.parse(readFileSync(new URL('./category-map.v1.json', import.meta.url), 'utf8'));
const EDIBLE = new Set(['food', 'snack', 'coffee_tea', 'health', 'liquor']);
// Alcohol is tagged for holidays only, whichever seed found it (decision 2026-11-13).
const occasionsFor = (category, occasions) => category === 'liquor' ? ['holiday'] : [...new Set(occasions)];
// Bracketed promo tags ([N배송], [슈퍼적립], [네이버단독], [본사직영] …). Brackets with quantities or options stay.
const PROMO = /배송|적립|단독|직영|공식|특가|할인|쿠폰|이벤트|증정|N페이|무료|PICK|평점|최신|당일|오늘출발|best|hot|sale/i;

export function cleanName(title) {
  return title
    .replace(/\[[^\]]*\]/g, tag => PROMO.test(tag) ? ' ' : tag)
    .replace(/(^|\s)N배송(?=\s|$)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function flowerSubtype(product, keyword) {
  const text = `${product.title} ${keyword}`;
  const leaf = product.category_path?.[0];
  for (const rule of CATEGORY_MAP.flower_subtype.rules) {
    if (rule.default) return rule.subtype;
    if (rule.site_categories?.includes(leaf) || rule.title_or_keyword?.some(word => text.includes(word))) return rule.subtype;
  }
  return null;
}

// Demo arrival rule (spec §6): badge → 1 day, fresh flowers 1, fresh food 2, otherwise 2–3 (stable per id).
export function arrivalDays(product, category, subtype) {
  if (product.delivery_badge) return 1;
  if (category === 'flower' && subtype === 'bouquet') return 1;
  if (product.is_fresh) return 2;
  return 2 + (createHash('sha256').update(product.id).digest()[0] % 2);
}

export function validate(item) {
  const issues = [];
  const need = (ok, field) => { if (!ok) issues.push(field); };
  need(/^naver_\d+$/.test(item.id), 'id');
  need(typeof item.name === 'string' && item.name.length > 0, 'name');
  need(Number.isSafeInteger(item.price) && item.price > 0, 'price');
  need(CATEGORIES.includes(item.category), 'category');
  need(item.category !== 'flower' || ['bouquet', 'pot', 'bulb', 'preserved'].includes(item.flower_subtype), 'flower_subtype');
  need(Array.isArray(item.occasions) && item.occasions.length > 0, 'occasions');
  need(/^b[1-5]$/.test(item.price_band), 'price_band');
  need(Number.isSafeInteger(item.search_rank) && item.search_rank > 0, 'search_rank');
  need(item.review_count === null || Number.isSafeInteger(item.review_count), 'review_count');
  need(item.shipping_fee === null || Number.isSafeInteger(item.shipping_fee), 'shipping_fee');
  need(['naver_listing', 'unknown'].includes(item.shipping_source), 'shipping_source');
  need([true, false, null].includes(item.gift_set), 'gift_set');
  need(Number.isSafeInteger(item.arrival_days) && item.arrival_source === 'synthetic', 'arrival');
  need(Array.isArray(item.allergens), 'allergens');
  need(['formal', 'basic'].includes(item.packaging) && (item.packaging === 'formal') === (item.packaging_source === 'inferred_gift_set'), 'packaging');
  need(item.alcohol === (item.category === 'liquor'), 'alcohol');
  need(item.category !== 'liquor' || (item.occasions.length === 1 && item.occasions[0] === 'holiday'), 'liquor_occasions');
  return issues;
}

export function enrich(keywords, { site = 'naver' } = {}) {
  const byId = new Map(), held = [], unmapped = new Set(), excluded = [];
  for (const entry of keywords) {
    for (const product of entry.picked) {
      const leaf = product.category_path?.[0] ?? null;
      if (CATEGORY_MAP.exclude_site_categories[leaf]) { excluded.push({ id: product.id, keyword: entry.keyword, leaf }); continue; }
      if (CATEGORY_MAP.held_site_categories[leaf]) { held.push({ id: product.id, keyword: entry.keyword, leaf, title: product.title }); continue; }
      const category = CATEGORY_MAP.by_site_category[leaf];
      if (!category) { unmapped.add(leaf); continue; }
      const existing = byId.get(product.id);
      if (existing) {
        // Same product under several seeds: merge occasion tags and keep the first record.
        existing.occasions = occasionsFor(existing.category, [...existing.occasions, entry.occasion]);
        existing.seed_keywords = [...new Set([...existing.seed_keywords, entry.keyword])];
        if (entry.season && !existing.season) existing.season = entry.season;
        if (product.gift_set === true) Object.assign(existing, { gift_set: true, packaging: 'formal', packaging_source: 'inferred_gift_set' });
        continue;
      }
      const subtype = category === 'flower' ? flowerSubtype(product, entry.keyword) : null;
      const name = cleanName(product.title);
      byId.set(product.id, {
        id: product.id,
        name,
        brand: product.brand ?? null,
        mall: product.mall,
        price: product.price,
        category,
        ...(subtype ? { flower_subtype: subtype } : {}),
        site_category: product.category_path,
        site_category_ids: product.category_ids,
        occasions: occasionsFor(category, [entry.occasion]),
        season: entry.season ?? null,
        seed_keyword: entry.keyword,
        seed_keywords: [entry.keyword],
        price_band: product.price_band,
        search_rank: product.search_rank,
        rating: product.rating,
        review_count: product.review_count,
        popularity_proxy: product.review_count == null ? Number((1 - (product.rank - 1) / entry.result_count).toFixed(3)) : null,
        gift_set: product.gift_set ?? null,
        // Listings say nothing about wrapping; a gift-set title is taken as formal packaging (inferred, demo-level).
        packaging: product.gift_set === true ? 'formal' : 'basic',
        packaging_source: product.gift_set === true ? 'inferred_gift_set' : 'default',
        delivery_badge: product.delivery_badge,
        shipping_fee: product.shipping_fee,
        shipping_free_over_krw: product.shipping_free_over_krw ?? null,
        shipping_source: product.shipping_source,
        arrival_days: arrivalDays(product, category, subtype),
        arrival_source: 'synthetic',
        alcohol: category === 'liquor',
        allergens: EDIBLE.has(category) ? tagAllergens(name) : [],
        image_url: product.image_url,
        product_url: product.product_url,
        source: SITES[site].source,
        collected_at: entry.collected_at,
      });
    }
  }
  const products = [...byId.values()];
  const invalid = products.map(item => [item.id, validate(item)]).filter(([, issues]) => issues.length);
  return { products, held, excluded, unmapped: [...unmapped], invalid };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { keywords } = JSON.parse(readFileSync(PATHS.selected, 'utf8'));
  const { products, held, excluded, unmapped, invalid } = enrich(keywords);
  if (unmapped.length || invalid.length) {
    console.error(JSON.stringify({ unmapped, invalid: invalid.slice(0, 20) }, null, 1));
    console.error('category-map.v1.json에 없는 카테고리나 스키마 오류가 있어 products-kr.json을 쓰지 않았습니다.');
    process.exit(1);
  }
  writeFileSync(PATHS.products, JSON.stringify(products, null, 1) + '\n');
  writeFileSync(path('data/catalog/web/enrich-held.json'), JSON.stringify({ held, excluded }, null, 1));
  const count = key => Object.fromEntries(Object.entries(Object.groupBy(products, key)).map(([k, v]) => [k, v.length]));
  console.log(JSON.stringify({ products: products.length, held: held.length, excluded: excluded.length,
    multi_occasion: products.filter(item => item.occasions.length > 1).length,
    by_category: count(item => item.category), flower_subtype: count(item => item.flower_subtype ?? '-') }));
}
