import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadSeeds, PATHS } from '../scripts/catalog/web/config.mjs';
import { mergeExtra } from '../scripts/catalog/web/merge-extra.mjs';

const extraFile = fileURLToPath(new URL('../occasion-seeds.v2-extra.json', import.meta.url));

test('v2-extra seeds load next to v1.2 without colliding occasion ids', () => {
  const base = loadSeeds(PATHS.baseSeeds), extra = loadSeeds(extraFile);
  assert.equal(base.items.length, 200);
  assert.equal(extra.items.length, 128);
  assert.equal(Object.keys(extra.occasions).length, 32);
  assert.equal(extra.perKeyword, 5);
  assert.deepEqual(Object.keys(extra.groups), ['care', 'work', 'culture', 'event', 'mood', 'couple']);
  assert.ok(extra.items.every(item => item.group && extra.groups[item.group]));
  assert.deepEqual(extra.priceBands, base.priceBands); // extra reuses the v1.2 bands
  const baseIds = new Set(Object.keys(base.occasions));
  assert.ok(Object.keys(extra.occasions).every(id => !baseIds.has(id)));
});

const product = (id, overrides = {}) => ({ id, name: `상품 ${id}`, mall: `mall${id}`, category: 'food', occasions: ['holiday'],
  product_url: `https://shop.example/${id}`, ...overrides });

test('merge: same product (id, URL, or name+mall) gains only occasion tags', () => {
  const existing = [product('naver_1'), product('naver_2', { mall: 'A', name: '한우 세트' })];
  const extra = [
    product('naver_1', { occasions: ['thanks'], name: 'changed name', price: 1 }),          // same id
    product('naver_9', { occasions: ['invitation'], product_url: 'https://shop.example/naver_2' }), // same URL
    product('naver_8', { occasions: ['return_gift'], mall: 'A', name: '[N배송] 한우 세트', product_url: 'x' }), // same name+mall
    product('naver_5', { occasions: ['thanks'] }),                                             // new
  ];
  const { products, added, merged } = mergeExtra(existing, extra);
  assert.deepEqual(added, ['naver_5']);
  assert.equal(merged.length, 3);
  assert.deepEqual(products.map(p => p.id), ['naver_1', 'naver_2', 'naver_5']);
  assert.deepEqual(products[0].occasions, ['holiday', 'thanks']);
  assert.equal(products[0].name, '상품 naver_1');   // existing record untouched apart from tags
  assert.equal(products[0].price, undefined);
  assert.deepEqual(products[1].occasions, ['holiday', 'invitation', 'return_gift']);
  assert.deepEqual(existing[0].occasions, ['holiday']); // input not mutated
});

test('merge: alcohol stays holiday-only and the same product inside the extra run is merged once', () => {
  const wine = product('naver_3', { category: 'liquor' });
  const { products, within_extra } = mergeExtra([wine], [product('naver_3', { category: 'liquor', occasions: ['invitation'] })]);
  assert.deepEqual(products[0].occasions, ['holiday']);
  const dup = mergeExtra([], [product('naver_6', { occasions: ['a'] }), product('naver_7', { occasions: ['b'], mall: 'mallnaver_6', name: '상품 naver_6' })]);
  assert.equal(dup.products.length, 1);
  assert.deepEqual(dup.products[0].occasions, ['a', 'b']);
  assert.equal(dup.within_extra.length, 1);
  assert.equal(within_extra.length, 0);
});

import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sortInbox } from '../scripts/catalog/web/inbox.mjs';

test('inbox sorting files pages by name or page title, moves _files, never overwrites', () => {
  const root = mkdtempSync(join(tmpdir(), 'inbox-'));
  const inbox = join(root, '_inbox');
  const row = (occasion, keyword) => ({ occasion, keyword, slug: keyword.replace(/\s+/g, '-'), file: join(root, 'naver', occasion, `${keyword.replace(/\s+/g, '-')}.html`) });
  const rows = [row('thanks', '감사 떡 선물세트'), row('invitation', '초대 선물 와인'), row('farewell', '송별 꽃다발'), row('award', '수상 축하 꽃다발')];
  mkdirSync(inbox);
  const page = (name, body = 'x') => writeFileSync(join(inbox, name), body);
  page('감사-떡-선물세트.html'); mkdirSync(join(inbox, '감사-떡-선물세트_files')); writeFileSync(join(inbox, '감사-떡-선물세트_files', 'a.webp'), 'img');
  // Chrome renamed a re-save and the folder follows; the file is recognised by its page title.
  page('초대-선물-와인 (1).html', '<html><head><title>초대 선물 와인 : 네이버+ 스토어 검색</title>');
  mkdirSync(join(inbox, '초대-선물-와인 (1)_files'));
  page('unknown.html');
  // target already exists: left alone
  mkdirSync(join(root, 'naver', 'farewell'), { recursive: true }); writeFileSync(rows[2].file, 'keep');
  page('송별-꽃다발.html', 'new');

  const dry = sortInbox({ rows, inbox, dryRun: true });
  assert.equal(dry.moved.length, 2);
  assert.ok(existsSync(join(inbox, '감사-떡-선물세트.html'))); // dry run moves nothing

  const { moved, skipped } = sortInbox({ rows, inbox });
  assert.deepEqual(moved.map(m => m.to).sort(), ['invitation/초대-선물-와인.html', 'thanks/감사-떡-선물세트.html']);
  assert.ok(existsSync(join(root, 'naver', 'thanks', '감사-떡-선물세트_files', 'a.webp')));
  assert.ok(existsSync(join(root, 'naver', 'invitation', '초대-선물-와인_files')));
  assert.equal(readFileSync(rows[2].file, 'utf8'), 'keep');
  assert.deepEqual(skipped.map(s => s.file).sort(), ['unknown.html', '송별-꽃다발.html']);
  assert.equal(sortInbox({ rows, inbox }).moved.length, 0);
});

import { selectForKeyword } from '../scripts/catalog/web/select.mjs';

test('select drops excluded leaf categories so the next ranked products take the slots', () => {
  const bands = [{ id: 'b1', min: 0, max: 9999 }, { id: 'b2', min: 10000, max: 29999 }];
  const card = (id, leaf, price) => ({ id, rank: Number(id), title: `퇴원 축하 꽃다발 ${id}`, price, mall: `m${id}`, brand: null, is_ad: false, category_path: [leaf] });
  const items = [card('1', '케이크토퍼', 5000), card('2', '케이크토퍼', 6000), card('3', '생화', 15000), card('4', '생화', 8000)];
  const options = { keyword: '퇴원 축하 꽃다발', priceBands: bands, perKeyword: 5 };
  assert.deepEqual(selectForKeyword(items, options).picked.map(p => p.id).sort(), ['1', '2', '3', '4']);
  const { picked, excluded } = selectForKeyword(items, { ...options, blockedLeaves: ['케이크토퍼'] });
  assert.deepEqual(picked.map(p => p.id).sort(), ['3', '4']);
  assert.deepEqual(excluded.filter(e => e.reason === 'excluded_category').map(e => e.id), ['1', '2']);
});
