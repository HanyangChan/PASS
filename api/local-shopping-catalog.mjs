import { DatabaseSync } from 'node:sqlite';
import { todayKst, toEngineProduct } from '../lib/catalog.mjs';

export const demoShippingFee = 2500;
const shoppingSet = /(?<![가-힣])(스팸|백설(?:\s*(?:식용유|해바라기씨유|카놀라유|포도씨유|올리브유|요리유))?|동원\s*참치)(?:\s*(?:선물\s*)?세트)?/g;
function productLink(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch {
    return undefined;
  }
}

export function rewriteShoppingRequest(text) {
  const matches = [...text.matchAll(shoppingSet)];
  if (matches.length !== 1) return null;
  const [phrase, name] = matches[0];
  const brand = name.match(/^(스팸|백설|동원)/)[0];
  return text.replace(phrase, `브랜드 "${brand}"`);
}

export function readShoppingCatalog(dbPath, day = todayKst()) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const original = db.prepare('SELECT source_json FROM original_products ORDER BY id').all();
    const observations = db.prepare("SELECT * FROM shopping_observations WHERE eligibility = 'name_match' ORDER BY id").all();
    const brands = new Map([
      ['스팸 선물세트', '스팸'],
      ['백설 식용유 선물세트', '백설'],
      ['동원 참치 선물세트', '동원'],
    ]);
    return [
      ...original.map(row => toEngineProduct(JSON.parse(row.source_json), day)),
      ...observations.map(row => ({ ...toEngineProduct({
        id: row.id,
        name: row.title,
        category: 'food',
        brand: brands.get(row.query),
        description: 'SearchApi 표시가 기준. 배송비 2,500원은 실험값이며 실제 배송비와 재고는 판매처에서 확인해 주세요.',
        price_krw: row.price_krw,
        stock: 1,
        shipping_fee_krw: demoShippingFee,
        source_url: productLink(JSON.parse(row.source_json).product_link),
        demo_fields: ['stock', 'arrival_days', 'packaging', 'shipping_fee_krw', 'brand_from_title'],
      }, day), gift_set: true })),
    ];
  } finally {
    db.close();
  }
}
