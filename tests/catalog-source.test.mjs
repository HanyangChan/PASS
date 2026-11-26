import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalogId, catalogSource, currentImageUrl, fromWebItem, mergeCatalogs } from '../lib/catalog-source.mjs';
import { isGiftSet } from '../lib/ranking.mjs';
import { packagingFor, sweetnessFor } from '../scripts/catalog/demo-rules.mjs';

const web = JSON.parse(readFileSync(new URL('../supabase/seed/products-kr.json', import.meta.url)));

test('catalog source defaults to both catalogs and rejects unknown values', () => {
  assert.equal(catalogSource(undefined), 'both');
  assert.equal(catalogSource(''), 'both');
  assert.equal(catalogSource('amazon'), 'amazon');
  assert.equal(catalogSource('both'), 'both');
  assert.throws(() => catalogSource('naver'));
  assert.equal(catalogId('web'), 'naver-web-v1');
});

test('web items become engine products through toEngineProduct', () => {
  const item = web.find(p => p.gift_set === true && p.shipping_fee > 0 && p.allergens.length);
  const product = fromWebItem(item, '2026-11-13');
  assert.equal(product.price_krw, item.price);
  assert.equal(product.shipping_fee_per_set_krw, item.shipping_fee);
  assert.equal(product.rating_count, item.review_count);
  assert.deepEqual(product.allergens_declared, item.allergens);
  assert.equal(product.allergen_information_complete, false);
  assert.equal(product.image, undefined); // no API address: no photo, and never the seller's own address
  assert.equal(fromWebItem(item, '2026-11-13', { apiBase: 'http://127.0.0.1:8788/' }).image, `http://127.0.0.1:8788/catalog-images/${item.id}.webp`);
  assert.equal(product.link, item.product_url);
  assert.ok(isGiftSet(product));
  assert.equal(product.packaging, item.packaging);
  assert.equal(product.packaging_source, 'name_rule');
  assert.equal(product.sweetness, item.sweetness);
  assert.ok(!product.demo_fields.includes('shipping_fee_krw')); // real listed fee
  assert.ok(product.demo_fields.includes('arrival_days'));
  assert.match(product.arrival_date, /^2026-11-1[5-7]$/);
});

test('every web item converts to a valid engine product', () => {
  for (const item of web) {
    const p = fromWebItem(item, '2026-11-13');
    assert.ok(Number.isSafeInteger(p.price_krw) && p.price_krw > 0, item.id);
    assert.ok(p.stock_sets > 0 && typeof p.category === 'string', item.id);
  }
  assert.ok(web.every(p => p.packaging === packagingFor(p.name) && p.sweetness === sweetnessFor(p.name)));
  assert.ok(web.some(p => p.gift_set !== true && p.packaging === 'formal')); // gift_set is kept apart from packaging
  const liquor = web.filter(p => p.category === 'liquor').map(p => fromWebItem(p, '2026-11-13'));
  assert.ok(liquor.length && liquor.every(p => p.alcohol === true));
});

test('merging drops only the same product', () => {
  const a = { id: 'amz-1', name: '스팸 클래식 8호 선물세트', brand: '스팸', link: 'https://a/1' };
  const sameLink = { id: 'naver_1', name: '다른 이름', brand: null, seller: '판매처', link: 'https://a/1' };
  const sameName = { id: 'searchapi-1', name: '[N배송] 스팸 클래식 8호 선물세트', brand: '스팸', link: 'https://b/2' };
  const otherOfBrand = { id: 'searchapi-2', name: '스팸 복합 1호 선물세트', brand: '스팸', link: 'https://b/3' };
  assert.deepEqual(mergeCatalogs([a], [sameLink, sameName, otherOfBrand, a]).map(p => p.id), ['amz-1', 'searchapi-2']);
});

test('stored web photo addresses point at the current API', () => {
  const api = 'http://127.0.0.1:8790/';
  assert.equal(currentImageUrl('https://x.supabase.co/storage/v1/object/public/product-images-kr/naver_5601213660.webp', api), 'http://127.0.0.1:8790/catalog-images/naver_5601213660.webp');
  assert.equal(currentImageUrl('http://127.0.0.1:8788/catalog-images/naver_1.webp', api), 'http://127.0.0.1:8790/catalog-images/naver_1.webp');
  const amazon = 'https://m.media-amazon.com/images/I/719elVA3FvL._AC_UL320_.jpg';
  assert.equal(currentImageUrl(amazon, api), amazon);
  assert.equal(currentImageUrl(undefined, api), undefined);
  assert.equal(currentImageUrl(undefined, api, 'naver_8514792794'), 'http://127.0.0.1:8790/catalog-images/naver_8514792794.webp');
  assert.equal(currentImageUrl(undefined, api, 'amz-B08X2M94KM'), undefined);
  assert.equal(currentImageUrl('https://x/product-images-kr/naver_1.webp', undefined), 'https://x/product-images-kr/naver_1.webp');
});
