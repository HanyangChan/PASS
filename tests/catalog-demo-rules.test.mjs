import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrivalDays, hash, packagingFor, sweetnessFor } from '../scripts/catalog/demo-rules.mjs';
import { toRow } from '../scripts/catalog/transform.mjs';
import { enrich } from '../scripts/catalog/web/enrich.mjs';

const NAMES = ['Sunfeast Gift Box cookies', 'Chocolate Hamper', 'Coffee Combo Pack', 'Boxer shorts', 'Sugar Free Mints', 'Coca-Cola Zero Sugar',
  '한우 선물세트', '홍삼 기프트 세트', '과일 바구니', '쿠키 박스', '머그컵 2P', '무가당 두유', '제로슈거 콜라', '제로 슈거 콜라', '슈가프리 캔디', '설탕무첨가 잼', '설탕 1kg'];

// The same name through the Amazon transform (as both English and Korean name) and through the web enrich.
function amazonRow(name) {
  const c = { asin: 'B000000099', name, sub_category: 'Snack Foods', image: 'https://m.media-amazon.com/i.jpg', link: 'https://www.amazon.in/dp/B000000099', inr: 500, rating: 4, count: 100 };
  return toRow(c, { name_ko: name, category: 'snack' });
}
function webItem(name) {
  const product = { id: 'naver_99', rank: 1, title: name, price: 30000, mall: 'm', brand: null, category_path: ['초콜릿'], category_ids: [],
    rating: 4.5, review_count: 10, sold_out: false, delivery_badge: null, shipping_fee: 0, shipping_free_over_krw: null,
    shipping_source: 'naver_listing', is_fresh: false, product_url: null, image_url: null, price_band: 'b3', search_rank: 1, gift_set: null };
  const { products, invalid } = enrich([{ occasion: 'birthday', keyword: '초콜릿', season: null, result_count: 40, collected_at: 'x', picked: [product] }]);
  assert.deepEqual(invalid, []);
  return products[0];
}

test('Amazon and web rules give the same packaging and sweetness for the same name', () => {
  for (const name of NAMES) {
    const amazon = amazonRow(name), web = webItem(name);
    assert.deepEqual([web.packaging, web.sweetness], [amazon.packaging, amazon.sweetness], name);
  }
  assert.deepEqual(NAMES.filter(name => packagingFor(name) === 'formal'),
    ['Sunfeast Gift Box cookies', 'Chocolate Hamper', 'Coffee Combo Pack', '한우 선물세트', '홍삼 기프트 세트', '과일 바구니', '쿠키 박스']);
  assert.deepEqual(NAMES.filter(name => sweetnessFor(name) === 'unsweetened'),
    ['Sugar Free Mints', 'Coca-Cola Zero Sugar', '무가당 두유', '제로슈거 콜라', '제로 슈거 콜라', '슈가프리 캔디', '설탕무첨가 잼']);
});

test('arrival days use the same hash in both catalogs: 2–4 days, stable per id', () => {
  assert.equal(amazonRow('x').arrival_days, arrivalDays('B000000099'));
  assert.equal(webItem('x').arrival_days, arrivalDays('naver_99'));
  assert.equal(hash('abc'), hash('abc'));
  const days = Array.from({ length: 300 }, (_, i) => arrivalDays(`naver_${i}`));
  assert.deepEqual([...new Set(days)].sort(), [2, 3, 4]);
});
