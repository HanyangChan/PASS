// Fold the extra run's products (data/catalog/web/products-kr.extra.json, written by `SEEDS=extra enrich.mjs`)
// into the committed catalog supabase/seed/products-kr.json.
//
// Same product → one record: the existing record stays exactly as it is and only gains the new `occasions` tags.
// "Same product" follows spec §4: same id, same product URL, or same normalized name and mall. Same brand but a
// different product stays separate. Existing order is kept; new products are appended.
//
// Usage: node scripts/catalog/web/merge-extra.mjs            (dry run: prints what would change)
//        node scripts/catalog/web/merge-extra.mjs --write    (writes products-kr.json)
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { PATHS, path } from './config.mjs';
import { validate } from './enrich.mjs';
import { normalizeTitle } from './select.mjs';

export const STAGING = path('data/catalog/web/products-kr.extra.json');

const keysOf = product => [
  `id:${product.id}`,
  product.product_url ? `url:${product.product_url}` : null,
  product.mall ? `name:${normalizeTitle(product.name)}|${product.mall}` : null,
].filter(Boolean);

/** Pure merge: returns { products, added, merged, within_extra } without touching disk. */
export function mergeExtra(existing, extra) {
  const products = existing.map(item => ({ ...item, occasions: [...item.occasions] }));
  const index = new Map();
  const origin = new Map(); // product → 'existing' | 'extra', to tell the two kinds of match apart
  for (const product of products) { origin.set(product, 'existing'); for (const key of keysOf(product)) if (!index.has(key)) index.set(key, product); }
  const added = [], merged = [], withinExtra = [];
  for (const item of extra) {
    const match = keysOf(item).map(key => index.get(key)).find(Boolean);
    if (!match) {
      const copy = { ...item, occasions: [...item.occasions] };
      products.push(copy);
      origin.set(copy, 'extra');
      for (const key of keysOf(copy)) if (!index.has(key)) index.set(key, copy);
      added.push(copy.id);
      continue;
    }
    // Alcohol stays holiday-only (decision 2026-11-13), whatever the new seeds say.
    const newTags = match.category === 'liquor' ? [] : item.occasions.filter(tag => !match.occasions.includes(tag));
    (origin.get(match) === 'existing' ? merged : withinExtra).push({ id: match.id, also_found_as: item.id, added_occasions: newTags });
    match.occasions.push(...newTags);
  }
  return { products, added, merged, within_extra: withinExtra };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values: args } = parseArgs({ options: { write: { type: 'boolean' } } });
  if (!existsSync(STAGING)) {
    console.error(`${STAGING} 이 없습니다. 먼저 SEEDS=extra node scripts/catalog/web/enrich.mjs 를 실행하세요.`);
    process.exit(1);
  }
  const existing = JSON.parse(readFileSync(PATHS.catalog, 'utf8'));
  const extra = JSON.parse(readFileSync(STAGING, 'utf8'));
  const result = mergeExtra(existing, extra);
  const invalid = result.products.map(item => [item.id, validate(item)]).filter(([, issues]) => issues.length);
  const tagged = result.merged.filter(entry => entry.added_occasions.length);
  console.log(JSON.stringify({
    existing: existing.length, extra: extra.length, after: result.products.length,
    new_products: result.added.length,
    same_product_as_existing: result.merged.length, existing_products_gaining_tags: tagged.length,
    same_product_within_extra: result.within_extra.length, invalid: invalid.slice(0, 10),
  }));
  if (invalid.length) { console.error('스키마 검증 실패: 파일을 쓰지 않았습니다.'); process.exit(1); }
  if (args.write) {
    writeFileSync(PATHS.catalog, JSON.stringify(result.products, null, 1) + '\n');
    console.log(`wrote ${PATHS.catalog}`);
  } else console.log('dry run: 파일을 쓰지 않았습니다. 적용하려면 --write');
}
