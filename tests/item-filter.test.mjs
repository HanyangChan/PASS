import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fromWebItem } from '../lib/catalog-source.mjs';
import { currentItem, itemFilterEnabled, itemVocabulary, narrowByItem, productsForItem } from '../lib/item-filter.mjs';

const products = JSON.parse(readFileSync(new URL('../supabase/seed/products-kr.json', import.meta.url))).map(item => fromWebItem(item, '2026-11-13'));
const vocabulary = itemVocabulary(products);
const terms = vocabulary.map(v => v.term);
const item = (texts, previous = null) => currentItem([].concat(texts), vocabulary, previous);

test('ITEM_FILTER is off unless set to on', () => {
  assert.equal(itemFilterEnabled({}), false);
  assert.equal(itemFilterEnabled({ ITEM_FILTER: 'off' }), false);
  assert.equal(itemFilterEnabled({ ITEM_FILTER: 'on' }), true);
});

test('vocabulary keeps items and drops modifiers and loose one-letter words', () => {
  for (const t of ['카네이션', '장미', '한우', '배', '김', '꿀', '카드지갑', '와인잔']) assert.ok(terms.includes(t), t);
  for (const t of ['가을', '크리스마스', '꽃', '차', '합격', '충전식', '미니', '블루투스']) assert.ok(!terms.includes(t), t);
});

test('the named item is found, including alternate spellings', () => {
  assert.equal(item('어버이날 부모님께 카네이션 꽃 선물, 상품값 3만원 이하'), '카네이션');
  assert.equal(item('후리지아 꽃다발 3만원'), '프리지아');
  assert.equal(item('카드지갑 선물'), '카드지갑');
  assert.equal(item('와인잔 세트'), '와인잔');
});

test('one-letter items count only as separate words', () => {
  assert.equal(item('배 선물세트 5만원'), '배');
  assert.equal(item('꿀 좋아하셔'), '꿀');
  assert.equal(item('배송비 포함이야'), null);
  assert.equal(item('김치 말고'), null);
  assert.equal(item('떡볶이 좋아해'), null);
  assert.equal(item('꿀잠 베개'), null);
  assert.equal(item('가을에 드릴 꽃 선물'), null);
});

test('the most recent mention wins and negations are honored', () => {
  assert.equal(item(['카네이션 꽃 선물', '아니 장미로 바꿔줘']), '장미');
  assert.equal(item('카네이션 말고 장미'), '장미');
  assert.equal(item('카네이션은 빼줘', '카네이션'), null);
  assert.equal(item('장미 말고', '카네이션'), '카네이션');
  assert.equal(item('배송비 포함', '카네이션'), '카네이션');
});

test('the list narrows only when at least three products match', () => {
  const carnation = narrowByItem(products, '카네이션');
  assert.ok(carnation.applied && carnation.products.length >= 3);
  assert.ok(carnation.products.every(p => p.seed_keywords.some(k => k.includes('카네이션')) || p.name.includes('카네이션')));
  const few = productsForItem(products, '카네이션').slice(0, 2);
  assert.equal(narrowByItem(few, '카네이션').applied, null);
  assert.equal(narrowByItem(products, null).products, products);
});
