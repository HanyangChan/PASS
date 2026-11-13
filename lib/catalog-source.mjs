// Catalog source switch (spec §4): CATALOG_SOURCE=amazon|web|both. Default amazon keeps existing behavior.
// "web" is the Korean gift catalog in supabase/seed/products-kr.json (Naver Shopping search results).
import { CATALOG_ID, CATEGORY_NAMES, toEngineProduct } from './catalog.mjs';

export const CATALOG_SOURCES = ['amazon', 'web', 'both'];
export const WEB_CATALOG_ID = 'naver-web-v1';

export function catalogSource(value) {
  const source = value || 'amazon';
  if (!CATALOG_SOURCES.includes(source)) throw Error(`CATALOG_SOURCE must be one of ${CATALOG_SOURCES.join(', ')}`);
  return source;
}
export const catalogId = source => ({ amazon: CATALOG_ID, web: WEB_CATALOG_ID, both: `${CATALOG_ID}+${WEB_CATALOG_ID}` })[catalogSource(source)];

// products-kr.json item → engine product, through the same toEngineProduct as the Amazon rows.
// Seller images are never passed on (spec §7): the app shows the category icon instead.
export function fromWebItem(item, today) {
  const product = toEngineProduct({
    id: item.id,
    name: item.name,
    category: item.category,
    description: CATEGORY_NAMES[item.category] ?? item.category,
    price_krw: item.price,
    shipping_fee_krw: item.shipping_fee ?? 0,
    stock: 99,
    arrival_days: item.arrival_days,
    packaging: item.packaging ?? 'basic',
    sweetness: 'unknown',
    brand: item.brand,
    allergens: item.allergens,
    rating: item.rating,
    rating_count: item.review_count ?? 0,
    image_url: null,
    source_url: item.product_url,
    demo_fields: ['stock', 'arrival_days', 'packaging', ...(item.shipping_source === 'naver_listing' ? [] : ['shipping_fee_krw'])],
  }, today);
  return {
    ...product,
    ...(item.gift_set === true ? { gift_set: true } : {}),
    source: item.source,
    packaging_source: item.packaging_source ?? 'default',
    seller: item.mall ?? undefined,
    occasions: item.occasions,
    alcohol: item.alcohol === true,
    ...(item.flower_subtype ? { flower_subtype: item.flower_subtype } : {}),
  };
}

const normalized = name => String(name ?? '').replace(/\[[^\]]*\]|\([^)]*\)|[^\p{L}\p{N}]/gu, '').toLowerCase();
// Merges catalogs, dropping only the same product: same id, same product link, or same normalized
// name from the same brand/seller. Different products of one brand are all kept. First list wins.
export function mergeCatalogs(...lists) {
  const ids = new Set(), links = new Set(), names = new Set(), merged = [];
  for (const product of lists.flat()) {
    const owner = product.brand ?? product.seller ?? '';
    const nameKey = `${normalized(product.name)}|${normalized(owner)}`;
    if (ids.has(product.id) || (product.link && links.has(product.link)) || (owner && names.has(nameKey))) continue;
    ids.add(product.id);
    if (product.link) links.add(product.link);
    if (owner) names.add(nameKey);
    merged.push(product);
  }
  return merged;
}
