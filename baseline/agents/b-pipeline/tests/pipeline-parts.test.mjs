// Helpers behind the orchestrator: R9 recipient resolution, AC9 memory drop, banner / gift labels, template tags.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initial } from '../../../src/vendor/engine.mjs';
import { resolveRecipients, linkCandidates } from '../pipeline/recipients.mjs';
import { dropMemories } from '../pipeline/provenance.mjs';
import { giftHistoryHit, memoryBanner } from '../pipeline/banner.mjs';
import { templateExplanations, wonShort } from '../explainer/template.mjs';
import { createMemoryStore } from '../db/memory-store.mjs';
import { seedPeople } from './fixtures/people.mjs';
import { byId } from './fixtures/catalog.mjs';

test('R9: two parents become 부모님 with rows or without; ids keep each person', async () => {
  const empty = createMemoryStore();
  const none = await resolveRecipients(empty, 'userA', ['어머니', '아버지']);
  assert.deepEqual(none.display, ['부모님']);
  assert.deepEqual(none.ids, ['new:어머니', 'new:아버지']);
  assert.deepEqual((await resolveRecipients(empty, 'userA', ['부모님'])).ids, ['new:어머니', 'new:아버지']);
  const store = createMemoryStore();
  const { mom, dad, friend } = await seedPeople(store);
  assert.deepEqual(await resolveRecipients(store, 'userA', ['어머니', '아버지']).then(r => [r.display, r.ids]), [['부모님'], [mom.id, dad.id]]);
  assert.deepEqual(await resolveRecipients(store, 'userA', ['어머니', '친구']).then(r => [r.display, r.ids]), [['어머니', '친구'], [mom.id, friend.id]], 'different groups are not merged');
  assert.deepEqual(await resolveRecipients(store, 'userA', ['부모님'], { choice: mom.id }).then(r => [r.display, r.ids]), [['어머니'], [mom.id]]);
  assert.deepEqual((await resolveRecipients(store, 'userB', ['어머니'])).ids, ['new:어머니'], 'another owner never sees userA rows');
  const linked = await linkCandidates(store, 'userA', [{ recipientName: '부모님', key: 'allergy:땅콩', polarity: -1, evidence: '땅콩 알레르기', basis: 'explicit' }]);
  assert.deepEqual(linked.map(c => c.recipientId), [mom.id, dad.id]);
});

test('AC9: dropMemories removes only values whose every independent source is a removed memory', () => {
  const state = { ...initial(), preferences: ['less_sweet', 'category:fitness', 'category:coffee_tea'], excluded_ingredients: ['땅콩'], packaging: 'formal' };
  const prov = {
    preferences: [{ value: 'less_sweet', sources: ['memory:m1'] }, { value: 'category:fitness', sources: ['rag', 'memory:h'] }, { value: 'category:coffee_tea', sources: ['utterance', 'memory:m1'] }],
    excluded_ingredients: [{ value: '땅콩', sources: ['memory:p', 'utterance'] }],
    packaging: [{ value: 'formal', sources: ['memory:m1'] }],
  };
  const d = dropMemories(state, prov, ['m1', 'h']);
  assert.deepEqual(d.patch, { preferences: ['category:coffee_tea'], packaging: null });
  assert.deepEqual(d.provenance.preferences, [{ value: 'category:coffee_tea', sources: ['utterance'] }]);
  assert.deepEqual(dropMemories(state, prov, ['p']).patch, {}, 'the allergy was also said: kept');
});

test('banner and gift labels', () => {
  const memory = { items: [{ memoryId: 'a', label: '단 음식 X', evidence: 'e' }, { memoryId: 'b', label: '등산', evidence: 'e' }], giftHistory: [{ productId: 'x', occasion: '추석', givenAt: '2026-09-20' }] };
  assert.equal(memoryBanner(memory, { preferences: [{ value: 'less_sweet', sources: ['memory:a'] }] }).text, '지난 추석 기억을 반영했어요: 단 음식 X');
  assert.equal(memoryBanner(memory, {}), null);
  const g = [{ id: 'g', productId: 'x', occasion: '추석', givenAt: '2026-09-20' }];
  assert.equal(giftHistoryHit('x', g, '2027-01-25T00:00:00Z').label, '작년 추석에 드린 선물');
  assert.equal(giftHistoryHit('x', g, '2026-12-01T00:00:00Z').label, '올해 추석에 드린 선물');
  assert.equal(giftHistoryHit('x', [{ id: 'g', productId: 'x', occasion: null, givenAt: null }]).label, '지난번에 드린 선물');
  assert.equal(giftHistoryHit('y', g), null);
});

test('template tags: 2..3 tags of <= 12 chars, built only from the card facts', () => {
  assert.deepEqual([wonShort(15000), wonShort(8000), wonShort(8500), wonShort(20000)], ['1.5만원', '8천원', '8,500원', '2만원']);
  const state = { ...initial(), recipients: ['부모님'], quantity: 1, same_product: true, budget: { amount_krw: 50000, scope: 'per_set', shipping_included: true }, preferences: ['less_sweet', 'category:fitness'] };
  const cards = ['hiking-socks', 'green-tea', 'hiking-poles'].map(id => ({ id }));
  const out = templateExplanations({ cards, products: Object.values(byId), state });
  assert.deepEqual(out.items.find(i => i.id === 'hiking-socks').tags, ['운동용품 선호', '리뷰 가장 많음', '2.8만원 여유']);
  assert.deepEqual(out.items.find(i => i.id === 'green-tea').tags, ['단맛 없음', '1.8만원 여유']);
  assert.deepEqual(out.items.find(i => i.id === 'hiking-poles').tags, ['운동용품 선호', '5천원 여유']);
});
