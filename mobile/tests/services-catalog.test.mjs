import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductRepository, catalogKey } from '../src/services/productRepository.ts';
import { giftFromProduct, rankGifts } from '../src/catalog.ts';
const row = (id, category, rating_count) => ({ id, name: `상품 ${id}`, name_en: `P ${id}`, category, description: '', price_krw: 10000, shipping_fee_krw: 3000, stock: 99, arrival_days: 2, packaging: 'basic', sweetness: 'unknown', brand: 'B', allergens: ['우유'], rating: 4.1, rating_count, image_url: 'https://m.media-amazon.com/i.jpg', source_url: `https://www.amazon.in/dp/${id}`, demo_fields: ['stock'] });
const memory = () => { const m = new Map(); return { m, getItem: async k => m.get(k) ?? null, setItem: async (k, v) => { m.set(k, v); } }; };
const DAY = 86400000;
test('loads from Supabase, caches for a day, and falls back to cache on failure', async () => {
  const storage = memory(); let calls = 0, fail = false, t = Date.UTC(2026, 9, 14);
  const fetcher = async () => { calls++; if (fail) throw new TypeError('offline'); return Response.json([row('A', 'snack', 5)]); };
  const repo = createProductRepository({ url: 'https://p.supabase.co', key: 'sb_publishable_x', storage, fetcher, now: () => t });
  const first = await repo.load();
  assert.equal(first[0].id, 'A'); assert.equal(first[0].arrival_date, '2026-10-16'); assert.ok(storage.m.has(catalogKey));
  await repo.load(); assert.equal(calls, 1);
  t += DAY + 1; fail = true;
  assert.equal((await repo.load())[0].id, 'A'); assert.equal(calls, 2);
  await assert.rejects(createProductRepository({ url: 'https://p.supabase.co', key: 'k', storage: memory(), fetcher }).load(), /상품 정보를/);
});
test('catalog gifts carry image, link, rating count and demo fields; rankings follow recipient categories', async () => {
  const repo = createProductRepository({ url: 'https://p.supabase.co', key: 'k', storage: memory(), fetcher: async () => Response.json([row('A', 'snack', 5), row('B', 'health', 9), row('C', 'jewelry', 7)]) });
  const products = await repo.load();
  const gift = giftFromProduct(products[0]);
  assert.equal(gift.category, '과자·간식'); assert.equal(gift.image, 'https://m.media-amazon.com/i.jpg'); assert.equal(gift.link, 'https://www.amazon.in/dp/A');
  assert.equal(gift.ratingCount, 5); assert.deepEqual(gift.demoFields, ['stock']); assert.deepEqual(gift.allergensDeclared, ['우유']); assert.equal(gift.icon, 'gift');
  const ranks = rankGifts(products);
  assert.deepEqual(Object.keys(ranks), ['전체', '부모님', '친구', '직장동료']);
  assert.deepEqual(ranks['전체'].map(g => g.id), ['B', 'C', 'A']);
  assert.deepEqual(ranks['부모님'].map(g => g.id), ['B']);
  assert.deepEqual(ranks['친구'].map(g => g.id), ['C', 'A']);
});
test('rankings alternate categories so one huge category cannot fill a tab', () => {
  const p = (id, category, rating_count) => ({ id, category, rating_count, name: id, description: '', price_krw: 1, shipping_fee_per_set_krw: 0, stock_sets: 1, arrival_date: '2026-10-16', packaging: 'basic', sweetness: 'unknown', brand: null, allergens_declared: [], allergen_information_complete: false });
  const ranks = rankGifts([p('E1', 'audio', 900), p('E2', 'audio', 800), p('E3', 'audio', 700), p('T1', 'coffee_tea', 5), p('S1', 'snack', 3)]);
  assert.deepEqual(ranks['전체'].map(g => g.id), ['E1', 'T1', 'S1', 'E2', 'E3']);
});
