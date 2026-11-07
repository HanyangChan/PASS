// TRD §5.4 and AC6 (no cross-recipient / cross-owner memory), AC9 (deleted memory is not read).
import test from 'node:test';
import assert from 'node:assert/strict';
import { findRecipient, loadMemory } from '../memory/read.mjs';
import { stores, seedPeople, seedS1Memories } from './fixtures/people.mjs';

for (const [name, make] of Object.entries(stores)) {
  const setup = async () => { const store = make(); const p = await seedPeople(store); const mem = await seedS1Memories(store, p); return { store, mem, ...p }; };

  test(`[${name}] recipients are found by name, alias and single-member group`, async () => {
    const { store, mom, friend } = await setup();
    for (const m of ['어머니', '엄마', '어머님']) assert.deepEqual((await findRecipient(store, 'userA', m)).recipients.map(r => r.id), [mom.id]);
    assert.deepEqual((await findRecipient(store, 'userA', '친구')).recipients.map(r => r.id), [friend.id], '친구 group has one member');
    assert.equal((await findRecipient(store, 'userA', '이모')).status, 'none');
  });

  test(`[${name}] "부모님" with two members is ambiguous: chips 두 분 함께 / 어머니만 / 아버지만`, async () => {
    const { store, mom, dad } = await setup();
    const r = await findRecipient(store, 'userA', '부모님');
    assert.equal(r.status, 'ambiguous');
    assert.deepEqual(r.chips.map(c => c.label), ['두 분 함께', '어머니만', '아버지만']);
    assert.deepEqual(r.chips.map(c => c.choice), ['together', mom.id, dad.id]);
    const both = await findRecipient(store, 'userA', '부모님', { choice: 'together' });
    assert.equal(both.status, 'found'); assert.deepEqual(both.recipients.map(x => x.id).sort(), [mom.id, dad.id].sort());
    const one = await findRecipient(store, 'userA', '부모님', { choice: dad.id });
    assert.deepEqual(one.recipients.map(x => x.id), [dad.id]);
    assert.equal((await findRecipient(store, 'userA', '부모님', { choice: 'someone-else' })).status, 'ambiguous', 'a choice outside the group is ignored');
  });

  test(`[${name}] AC6: another owner's recipients are invisible, even by name`, async () => {
    const { store, prof } = await setup();
    assert.equal((await findRecipient(store, 'userA', '교수님')).status, 'none');
    assert.equal((await findRecipient(store, 'userB', '교수님')).recipients[0].id, prof.id);
    assert.equal((await findRecipient(store, 'userB', '부모님')).status, 'none');
  });

  test(`[${name}] AC5 S2: both parents' confirmed memories become conditions with their sources`, async () => {
    const { store, mom, dad, mem } = await setup();
    const out = await loadMemory(store, 'userA', [mom.id, dad.id]);
    assert.deepEqual(out.conditions.preferences, ['less_sweet']);
    assert.deepEqual(out.conditions.excluded_ingredients, ['땅콩']);
    assert.equal(out.conditions.packaging, null);
    const byKey = Object.fromEntries(out.items.map(i => [i.key, i]));
    assert.equal(byKey['allergy:땅콩'].memoryId, mem.peanut.id);
    assert.equal(byKey['allergy:땅콩'].evidence, '땅콩 알레르기');
    assert.equal(byKey['allergy:땅콩'].label, '땅콩 제외');
    assert.equal(byKey['hobby:등산'].field, null, 'hobby is not a direct condition');
    assert.equal(byKey['hobby:등산'].recipientId, dad.id);
    assert.deepEqual(out.hobbies, [{ memoryId: mem.hiking.id, recipientId: dad.id, word: '등산' }]);
  });

  test(`[${name}] §5.4 together: allergies and dislikes are unions, preferences included if either has them`, async () => {
    const { store, mom, dad } = await setup();
    await store.addMemory('userA', { recipientId: dad.id, key: 'allergy:우유', polarity: -1, status: 'confirmed', source: 'explicit', evidence: '아빠는 우유 알레르기' });
    await store.addMemory('userA', { recipientId: dad.id, key: 'dislike:category:snack', polarity: -1, status: 'confirmed', source: 'explicit', evidence: '과자는 싫어하셔' });
    await store.addMemory('userA', { recipientId: dad.id, key: 'pref:category:fitness', polarity: 1, status: 'confirmed', source: 'explicit', evidence: '운동 좋아하셔' });
    const out = await loadMemory(store, 'userA', [mom.id, dad.id]);
    assert.deepEqual(out.conditions.excluded_ingredients.sort(), ['우유', '땅콩'].sort());
    assert.deepEqual(out.conditions.excluded_categories, ['snack']);
    assert.deepEqual(out.conditions.preferences.sort(), ['category:fitness', 'less_sweet']);
    const onlyDad = await loadMemory(store, 'userA', [dad.id]);
    assert.deepEqual(onlyDad.conditions.excluded_ingredients, ['우유'], 'mother-only allergy is not applied to 아버지만');
  });

  test(`[${name}] packaging: if recipients disagree, formal wins (the safer choice for a gift)`, async () => {
    const { store, mom, dad } = await setup();
    const add = (id, v) => store.addMemory('userA', { recipientId: id, key: `constraint:packaging:${v}`, polarity: 1, status: 'confirmed', source: 'explicit', evidence: '포장' });
    await add(mom.id, 'basic'); await add(dad.id, 'formal');
    assert.equal((await loadMemory(store, 'userA', [mom.id, dad.id])).conditions.packaging, 'formal');
  });

  test(`[${name}] AC6 S3: friend gets no memory from parents; userB's professor gets none from userA`, async () => {
    const { store, friend, prof, mom } = await setup();
    for (const [owner, id] of [['userA', friend.id], ['userB', prof.id]]) {
      const out = await loadMemory(store, owner, [id]);
      assert.deepEqual(out.items, []); assert.deepEqual(out.conditions, { preferences: [], excluded_categories: [], excluded_ingredients: [], packaging: null });
    }
    const cross = await loadMemory(store, 'userB', [mom.id]);
    assert.deepEqual(cross.items, [], "userB asking for userA's recipient id reads nothing");
  });

  test(`[${name}] only confirmed memories are read; suggested ones are not`, async () => {
    const { store, friend } = await setup();
    await store.addMemory('userA', { recipientId: friend.id, key: 'pref:category:beauty', polarity: 1, status: 'suggested', source: 'feedback', evidence: 'feedback:s1' });
    assert.deepEqual((await loadMemory(store, 'userA', [friend.id])).items, []);
  });

  test(`[${name}] negated (opposite-sign) or out-of-vocabulary rows in the DB are ignored, never turned into conditions`, async () => {
    const { store, friend } = await setup();
    const add = (key, polarity) => store.addMemory('userA', { recipientId: friend.id, key, polarity, status: 'confirmed', source: 'explicit', evidence: 'x' });
    await add('pref:less_sweet', -1); await add('pref:age:60s', 1);
    assert.deepEqual((await loadMemory(store, 'userA', [friend.id])).conditions.preferences, []);
  });

  test(`[${name}] AC9: a deleted memory is no longer read`, async () => {
    const { store, mom, dad, mem } = await setup();
    await store.deleteMemory('userA', mem.sweet.id);
    assert.deepEqual((await loadMemory(store, 'userA', [mom.id, dad.id])).conditions.preferences, []);
  });

  test(`[${name}] gift history is returned with the recipient and used memories get last_used_at`, async () => {
    const { store, mom, mem } = await setup();
    await store.addGift('userA', { recipientId: mom.id, productId: 'yakgwa-set', occasion: '추석', givenAt: '2025-09-30', satisfaction: 5 });
    const out = await loadMemory(store, 'userA', [mom.id], { now: '2026-11-05T00:00:00.000Z' });
    assert.deepEqual(out.giftHistory.map(g => [g.productId, g.occasion, g.satisfaction, g.recipientId]), [['yakgwa-set', '추석', 5, mom.id]]);
    assert.equal((await store.getMemory('userA', mem.sweet.id)).lastUsedAt, '2026-11-05T00:00:00.000Z');
  });
}
