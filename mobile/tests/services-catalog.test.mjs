import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductRepository, catalogKey } from '../src/services/productRepository.ts';
import { giftFromProduct, rankGifts, selectGifts } from '../src/catalog.ts';
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
  assert.equal(gift.ratingCount, 5); assert.deepEqual(gift.demoFields, ['stock']); assert.deepEqual(gift.allergensDeclared, ['우유']); assert.equal(gift.icon, 'snack');
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


test('search and filters find items outside the first 100 ranking positions', () => {
  const products = Array.from({ length: 130 }, (_, i) => ({ ...row(`P${i}`, 'audio', 200-i), price_krw: 10000, shipping_fee_per_set_krw: 0, stock_sets: 99, arrival_date: '2026-10-16', ingredients: [], allergens_declared: [], allergen_information_complete: false }));
  products[129] = { ...products[129], name: '특별한 이어폰', name_en: 'Hidden Earphones', brand: 'UniqueBrand', price_krw: 1000 };
  assert.equal(rankGifts(products)['전체'].length, 100);
  for (const search of ['특별한 이어폰','hidden earphones','uniquebrand'])
    assert.deepEqual(selectGifts(products,{search}).map(g=>g.id),['P129']);
  assert.deepEqual(selectGifts(products,{priceLimit:1000}).map(g=>g.id),['P129']);
  assert.equal(selectGifts(products,{sort:'낮은 가격순'})[0].id,'P129');
  assert.equal(selectGifts(products).length,100);
});

test('the app catalog follows the chat server CATALOG_SOURCE, then the app setting', async () => {
  const { resolveCatalogSource } = await import('../src/services/catalogSource.ts');
  const health = catalog => async () => Response.json({ ok: true, catalog });
  assert.equal(await resolveCatalogSource({ chatApiUrl: 'http://127.0.0.1:8788', fetcher: health('naver-web-v1') }), 'web');
  assert.equal(await resolveCatalogSource({ chatApiUrl: 'http://127.0.0.1:8788', fetcher: health('amazon-kaggle-v1+naver-web-v1'), fallback: 'amazon' }), 'both');
  const offline = async () => { throw new TypeError('offline'); };
  assert.equal(await resolveCatalogSource({ chatApiUrl: 'http://127.0.0.1:8788', fetcher: offline, fallback: 'web' }), 'web');
  assert.equal(await resolveCatalogSource({ fallback: 'naver' }), 'amazon');
  assert.equal(await resolveCatalogSource({}), 'amazon');
  const { resolveCatalog } = await import('../src/services/catalogSource.ts');
  const withPhotos = async () => Response.json({ ok: true, catalog: 'naver-web-v1', webImageBase: 'http://127.0.0.1:8788/catalog-images' });
  assert.deepEqual(await resolveCatalog({ chatApiUrl: 'http://127.0.0.1:8788', fetcher: withPhotos }), { source: 'web', webImageBase: 'http://127.0.0.1:8788/catalog-images' });
  assert.deepEqual(await resolveCatalog({ chatApiUrl: 'http://127.0.0.1:8788', fetcher: health('naver-web-v1') }), { source: 'web' });
});

test('web and both sources load the Korean catalog for the ranking screen and guest chat', async () => {
  const web = [{ id: 'naver_1', name: '한우 선물세트', category: 'food', price: 99000, shipping_fee: 0, shipping_source: 'naver_listing',
    arrival_days: 2, packaging: 'formal', packaging_source: 'inferred_gift_set', brand: null, allergens: ['쇠고기'], rating: 4.9, review_count: 120,
    product_url: 'https://smartstore.naver.com/x/products/1', gift_set: true, occasions: ['holiday'], source: 'naver_shopping_web', mall: '한우맘',
    image_url: 'https://p.supabase.co/storage/v1/object/public/product-images-kr/naver_1.webp', image_file: 'naver_1.webp' }];
  let supabaseCalls = 0;
  const fetcher = async () => { supabaseCalls++; return Response.json([row('A', 'snack', 5)]); };
  const make = source => createProductRepository({ url: 'https://p.supabase.co', key: 'k', storage: memory(), fetcher, source: async () => source, webItems: async () => web });
  const onlyWeb = await make('web').load();
  assert.deepEqual(onlyWeb.map(p => p.id), ['naver_1']);
  assert.equal(supabaseCalls, 0);
  assert.equal(giftFromProduct(onlyWeb[0]).image, 'https://p.supabase.co/storage/v1/object/public/product-images-kr/naver_1.webp');
  const local = createProductRepository({ url: 'https://p.supabase.co', key: 'k', storage: memory(), fetcher,
    source: async () => ({ source: 'web', webImageBase: 'http://127.0.0.1:8788/catalog-images' }), webItems: async () => web });
  assert.equal((await local.load())[0].image, 'http://127.0.0.1:8788/catalog-images/naver_1.webp');
  assert.deepEqual((await make('both').load()).map(p => p.id), ['A', 'naver_1']);
  assert.deepEqual((await make('amazon').load()).map(p => p.id), ['A']);
});
