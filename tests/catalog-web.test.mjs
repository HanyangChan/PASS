import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isBlocked, parse } from '../scripts/catalog/web/sites/naver.mjs';
import { coreTerms, isRelevant, normalizeTitle, selectForKeyword } from '../scripts/catalog/web/select.mjs';

// Trimmed from a saved 한우 선물세트 result page (2026-11-13); see scripts/catalog/web/make-fixture.mjs.
const html = readFileSync(new URL('./fixtures/naver-search-hanwoo.html', import.meta.url), 'utf8');
const items = parse(html);
const priceBands = [
  { id: 'b1', min: 0, max: 9999 }, { id: 'b2', min: 10000, max: 29999 }, { id: 'b3', min: 30000, max: 49999 },
  { id: 'b4', min: 50000, max: 99999 }, { id: 'b5', min: 100000, max: 500000 },
];
const keyword = '한우 선물세트';

test('naver parser reads product cards in display order', () => {
  assert.equal(items.length, 44);
  assert.deepEqual(items.map(item => item.rank), items.map((_, i) => i + 1));
  assert.equal(new Set(items.map(item => item.id)).size, items.length);
  const first = items.find(item => !item.is_ad);
  assert.match(first.id, /^naver_\d+$/);
  assert.ok(Number.isSafeInteger(first.price) && first.price > 0);
  assert.equal(typeof first.mall, 'string');
  assert.equal(first.brand, null);
  assert.equal(first.category_path.length, 1);
  assert.equal(first.category_ids.length, 4);
  assert.ok(first.review_count > 0 && first.rating > 0);
  assert.match(first.product_url, /^https:\/\//);
});

test('naver parser drops ad copies of organic results', () => {
  assert.equal(items.filter(item => item.is_ad).length, 9); // 12 ad slots, 3 duplicate organic results
});

test('naver block detection ignores the ncaptcha script on result pages', () => {
  assert.equal(isBlocked({ status: 200, html }), false);
  assert.equal(isBlocked({ status: 405, html: '' }), true);
  assert.equal(isBlocked({ status: 200, html: '<script src="ncaptcha.js"></script>보안 확인을 완료해 주세요' }), true);
});

test('selection on the saved page follows rules 1–5', () => {
  const { picked, excluded } = selectForKeyword(items, { keyword, priceBands, perKeyword: 3 });
  assert.equal(picked.length, 3);
  assert.ok(picked.every(item => !item.is_ad && item.search_rank > 0));            // rule 1
  assert.ok(picked.every(item => isRelevant(item.title, keyword)));                  // rule 2
  assert.ok(excluded.some(entry => entry.reason === 'price_outlier'));               // rule 3
  assert.equal(new Set(picked.map(item => item.price_band)).size, 3);                // rule 4
  assert.equal(new Set(picked.map(item => item.mall)).size, 3);                      // rule 5
  assert.deepEqual(selectForKeyword(items, { keyword, priceBands, perKeyword: 3 }).picked, picked); // deterministic
});

const item = (id, overrides = {}) => ({ id, rank: Number(id), title: `한우 선물세트 ${id}호`, price: 60000, mall: `mall${id}`, brand: null, is_ad: false, sold_out: false, ...overrides });

test('rule 1: ads, missing prices and sold-out items are excluded', () => {
  const { picked, excluded } = selectForKeyword([
    item('1', { is_ad: true }), item('2', { price: null }), item('3', { sold_out: true }), item('4'),
  ], { keyword, priceBands });
  assert.deepEqual(picked.map(p => p.id), ['4']);
  assert.deepEqual(excluded.map(e => e.reason), ['ad', 'no_price', 'sold_out']);
  assert.equal(picked[0].search_rank, 3); // ads do not take an organic rank
});

test('rule 2: titles need a core term and no blocked words', () => {
  assert.deepEqual(coreTerms('한우 선물세트'), ['한우']);
  assert.deepEqual(coreTerms('생일 케이크'), ['케이크']);
  assert.ok(isRelevant('LA 갈비 2kg', 'LA갈비 선물세트'));
  assert.equal(isRelevant('한돈 삼겹살', '한우 선물세트'), false);
  assert.equal(isRelevant('한우 선물세트 포장박스 10장', '한우 선물세트'), false);
});

test('rule 3: prices far from the keyword median are outliers', () => {
  const list = ['1', '2', '3', '4', '5'].map(id => item(id, { price: 60000 }));
  list.push(item('6', { price: 10000 }), item('7', { price: 400000 }));
  const { excluded } = selectForKeyword(list, { keyword, priceBands });
  assert.deepEqual(excluded.map(e => [e.id, e.reason]), [['6', 'price_outlier'], ['7', 'price_outlier']]);
});

test('rule 4: distinct price bands first, then next rank in the same band', () => {
  const list = [item('1', { price: 60000 }), item('2', { price: 65000 }), item('3', { price: 35000 }), item('4', { price: 70000 })];
  assert.deepEqual(selectForKeyword(list, { keyword, priceBands }).picked.map(p => p.id), ['1', '3', '2']);
});

test('rule 5: one per mall and brand, no duplicate titles', () => {
  const list = [
    item('1'), item('2', { mall: 'mall1', price: 35000 }), item('3', { brand: 'B', price: 120000 }),
    item('4', { brand: 'B', price: 20000 }), item('5', { title: '[특가] 한우 선물세트 1호', price: 25000 }), item('6', { price: 22000 }),
  ];
  assert.equal(normalizeTitle('[특가] 한우 선물세트 1호'), normalizeTitle('한우 선물세트 1호'));
  assert.deepEqual(selectForKeyword(list, { keyword, priceBands }).picked.map(p => p.id), ['1', '3', '6']);
});

test('naver parser keeps the listed shipping fee', () => {
  assert.ok(items.every(entry => entry.shipping_source === 'naver_listing' && Number.isSafeInteger(entry.shipping_fee)));
  assert.ok(items.some(entry => entry.shipping_fee > 0));
  assert.ok(items.every(entry => entry.shipping_free_over_krw === null));
});

test('gift-set seeds prefer gift-set titles and mark them', () => {
  const list = [
    item('1', { title: '한돈 대패 삼겹살 600g', price: 15000 }),
    item('2', { title: '한돈 삼겹살 목살 선물세트', price: 76900 }),
    item('3', { title: '한돈 GIFT SET 2kg', price: 45000 }),
    item('4', { title: '한돈 기프트 박스', price: 120000 }),
  ];
  const { picked, excluded } = selectForKeyword(list, { keyword: '한돈 선물세트', priceBands });
  assert.deepEqual(picked.map(p => [p.id, p.gift_set]), [['2', true], ['3', true], ['4', true]]);
  assert.deepEqual(excluded, [{ id: '1', reason: 'not_gift_set' }]);
});

test('gift-set rule relaxes when fewer than two titles pass', () => {
  const list = [
    item('1', { title: '한돈 대패 삼겹살 600g', price: 15000 }),
    item('2', { title: '한돈 삼겹살 목살 선물세트', price: 76900 }),
    item('3', { title: '한돈 목살 1kg', price: 35000 }),
  ];
  const { picked } = selectForKeyword(list, { keyword: '한돈 선물세트', priceBands });
  assert.deepEqual(picked.map(p => [p.id, p.gift_set]), [['2', true], ['1', false], ['3', false]]);
});

test('gift-set rule does not apply to other seeds', () => {
  const { picked } = selectForKeyword([item('1', { title: '홍삼정 240g', price: 60000 })], { keyword: '홍삼정', priceBands });
  assert.equal(picked[0].gift_set, null);
});
