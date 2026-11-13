import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalogId, catalogSource, fromWebItem, mergeCatalogs } from '../lib/catalog-source.mjs';
import { isGiftSet } from '../lib/ranking.mjs';
import { packagingFor, sweetnessFor } from '../scripts/catalog/demo-rules.mjs';

const web = JSON.parse(readFileSync(new URL('../supabase/seed/products-kr.json', import.meta.url)));

test('catalog source defaults to amazon and rejects unknown values', () => {
  assert.equal(catalogSource(undefined), 'amazon');
  assert.equal(catalogSource(''), 'amazon');
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
  assert.equal(product.image, item.image_url); // our Storage copy, never the seller's own address
  assert.equal(fromWebItem(item, '2026-11-13', { imageBase: 'http://127.0.0.1:8788/catalog-images/' }).image, `http://127.0.0.1:8788/catalog-images/${item.id}.webp`);
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
