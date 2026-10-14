import test from 'node:test';
import assert from 'node:assert/strict';
import { singleTurn, singleInitial } from '../../lib/single-gift.mjs';
import { recommend, extract } from '../../lib/engine.mjs';
import { engineState } from '../../lib/single-gift.mjs';
import { createPersonalizationRepository, emptyPersonalization, rememberConditions, personalizeSession, protectRememberedAllergies, decodePersonalization, switchRecipient, assertSameRecipient } from '../src/services/personalization.ts';
const session = () => ({ state: singleInitial(), issues: [] });
const memory = () => rememberConditions(emptyPersonalization(), { ...singleInitial(), recipients: ['어머니'], preferences: ['less_sweet'], excluded_ingredients: ['땅콩'] }, '2026-10-14');

test('new chat recalls only the exact recipient and does not reuse budget', () => {
  const result = personalizeSession(session(), memory(), '엄마 생신 선물 5만원');
  assert.deepEqual(result.session.state.recipients, ['어머니']);
  assert.deepEqual(result.session.state.excluded_ingredients, ['땅콩']);
  assert.equal(result.session.state.budget.amount_krw, null);
  assert.equal(result.reasons.length, 1);
  assert.deepEqual(personalizeSession(session(), memory(), '친구 선물').session.state.excluded_ingredients, []);
  assert.deepEqual(personalizeSession(session(), memory(), '부모님 선물').session.state.excluded_ingredients, []);
});
test('changing recipient removes previous recipient conditions and unresolved questions', () => {
  const mom = personalizeSession(session(), memory(), '엄마 선물').session;
  mom.issues = ['피해야 할 성분을 알려주세요.'];
  const friend = personalizeSession(mom, memory(), '친구 선물').session;
  assert.deepEqual(friend.state.excluded_ingredients, []);
  assert.deepEqual(friend.state.preferences, []);
  assert.deepEqual(friend.issues, []);
});
test('ambiguous or multiple recipients do not recall a single person memory', () => {
  assert.equal(personalizeSession(session(), memory(), '선물 추천').reasons.length, 0);
  assert.equal(personalizeSession(session(), memory(), '엄마와 친구 선물').reasons.length, 0);
});
test('remembered allergies survive a patch and incomplete products still block recommendations', () => {
  const patched = { state: { ...singleInitial(), recipients: ['어머니'] }, issues: [] };
  const protectedSession = protectRememberedAllergies(patched, memory());
  assert.deepEqual(protectedSession.state.excluded_ingredients, ['땅콩']);
  assert.equal(recommend([], engineState(protectedSession.state)).status, 'insufficient_product_info');
  assert.deepEqual(patched.state.excluded_ingredients, []);
  assert.deepEqual(protectRememberedAllergies(patched, emptyPersonalization()).state.excluded_ingredients, []);
});
test('new memories cannot silently clear allergies, and aliases work in the guest parser', () => {
  const next = rememberConditions(memory(), { ...singleInitial(), recipients: ['어머니'] }, 'later');
  assert.deepEqual(next.memories[0].excluded_ingredients, ['땅콩']);
  assert.deepEqual(extract('엄마 선물', singleInitial()).patch.recipients, ['어머니']);
  assert.throws(() => rememberConditions(memory(), singleInitial(), 'later'));
});
test('only positive purchase feedback influences ranking; current requests override it', () => {
  const data = { memories: [], purchases: [
    { id: '1', recipient: '친구', gift: { id: 'fruit', name: '과일', category: '과일' }, feedback: 'liked', source: 'user_reported', recordedAt: 'now' },
    { id: '2', recipient: '어머니', gift: { id: 'nuts', name: '견과', category: '견과류' }, feedback: 'liked', source: 'user_reported', recordedAt: 'now' },
  ] };
  assert.deepEqual(personalizeSession(session(), data, '친구 선물').session.state.preferences, ['category:fruit']);
  assert.deepEqual(personalizeSession(session(), data, '친구 차로 추천').session.state.preferences, ['category:tea']);
  assert.deepEqual(personalizeSession(session(), { ...data, purchases: data.purchases.map(p => ({ ...p, feedback: 'disliked' })) }, '친구 선물').session.state.preferences, []);
});
test('accounts and guest have separate storage and failed loads cannot overwrite data', async () => {
  const values = new Map();
  const storage = { getItem: async key => values.get(key) ?? null, setItem: async (key, value) => { values.set(key, value); } };
  const alice = createPersonalizationRepository(storage, 'alice');
  await assert.rejects(alice.save(memory()));
  await alice.load(); await alice.save(memory());
  assert.equal((await createPersonalizationRepository(storage, 'alice').load()).memories.length, 1);
  assert.deepEqual(await createPersonalizationRepository(storage, 'bob').load(), emptyPersonalization());
  assert.deepEqual(await createPersonalizationRepository(storage, null).load(), emptyPersonalization());
  const broken = createPersonalizationRepository({ ...storage, getItem: async () => '{' }, 'alice');
  await assert.rejects(broken.load()); await assert.rejects(broken.save(emptyPersonalization()));
  assert.throws(() => decodePersonalization('{"memories":[null],"purchases":[]}'));
});
test('writes are snapshots and a failed save does not poison subsequent writes', async () => {
  let fail = true;
  const values = [];
  const repo = createPersonalizationRepository({ getItem: async () => null, setItem: async (_, value) => { if (fail) { fail = false; throw Error('offline'); } values.push(value); } }, null);
  await repo.load(); await assert.rejects(repo.save(memory()));
  const data = memory(); const saved = repo.save(data); data.memories = [];
  await saved; assert.equal(JSON.parse(values[0]).memories.length, 1);
});

test('a single utterance extracts recipient, allergy and affirmative preference without inferring from negation', () => {
  const positive = extract('엄마는 땅콩 알레르기가 있어. 과일을 좋아해. 5만원', singleInitial()).patch;
  assert.deepEqual(positive.preferences, ['category:fruit']);
  assert.deepEqual(positive.excluded_ingredients, ['땅콩']);
  assert.equal(extract('친구는 과일을 좋아하지 않아', singleInitial()).patch.preferences, undefined);
});

test('recipient changes through condition editing also clear the previous person constraints', () => {
  const mom = personalizeSession(session(), memory(), '엄마 선물').session;
  const edited = personalizeSession(switchRecipient(mom, ['친구']), memory());
  assert.deepEqual(edited.session.state.excluded_ingredients, []);
  assert.deepEqual(edited.session.state.preferences, []);
  assert.deepEqual(edited.reasons, []);
});


test('choosing the first recipient preserves earlier exclusions and unresolved allergy questions', () => {
  const unscoped = { state: { ...singleInitial(), excluded_ingredients: ['땅콩'] }, issues: ['피해야 할 성분을 알려주세요.'] };
  const selected = personalizeSession(unscoped, emptyPersonalization(), '엄마 선물').session;
  assert.deepEqual(selected.state.excluded_ingredients, ['땅콩']);
  assert.deepEqual(selected.issues, unscoped.issues);
});
test('manual aliases and server aliases resolve to the same recipient memory', () => {
  const data = rememberConditions(emptyPersonalization(), { ...singleInitial(), recipients: ['엄마'], excluded_ingredients: ['땅콩'] }, '2026-10-14');
  assert.equal(data.memories[0].recipient, '어머니');
  assert.deepEqual(personalizeSession(session(), data, '어머니 선물').session.state.excluded_ingredients, ['땅콩']);
  const response = { state: { ...singleInitial(), recipients: ['엄마'] }, issues: [] };
  const safe = protectRememberedAllergies(response, data);
  assert.deepEqual(safe.state.recipients, ['어머니']);
  assert.deepEqual(safe.state.excluded_ingredients, ['땅콩']);
  assert.doesNotThrow(() => assertSameRecipient(safe, response));
  const same = switchRecipient({ state: { ...safe.state }, issues: ['확인 질문'] }, ['엄마']);
  assert.deepEqual(same.state.excluded_ingredients, ['땅콩']);
  assert.deepEqual(same.issues, ['확인 질문']);
});
test('unresolved allergy cannot become an empty saved memory', () => {
  assert.throws(() => rememberConditions(emptyPersonalization(), { ...singleInitial(), recipients: ['어머니'] }, '2026-10-14', ['피해야 할 성분을 알려주세요.']), /확인 중/);
});
test('model responses cannot silently switch an explicit recipient', () => {
  const request = { state: { ...singleInitial(), recipients: ['어머니'] }, issues: [] };
  assert.throws(() => assertSameRecipient(request, { state: { ...singleInitial(), recipients: ['친구'] }, issues: [] }), /받는 분/);
});
test('memory capacity does not silently evict a previously saved allergy', () => {
  const data = { memories: Array.from({ length: 100 }, (_, n) => ({ recipient: `대상 ${n}`, preferences: [], excluded_categories: [], excluded_ingredients: ['땅콩'], updatedAt: '2026-10-14' })), purchases: [] };
  assert.throws(() => rememberConditions(data, { ...singleInitial(), recipients: ['새 대상'] }, '2026-10-14'), /100명/);
  assert.equal(data.memories.length, 100);
  assert.doesNotThrow(() => rememberConditions(data, { ...singleInitial(), recipients: ['대상 0'] }, '2026-10-14'));
});
test('invalid stored preferences and duplicate aliases fail closed', async () => {
  const invalid = memory(); invalid.memories[0].preferences = ['unsupported'];
  assert.throws(() => decodePersonalization(JSON.stringify(invalid)));
  const duplicate = memory(); duplicate.memories.push({ ...duplicate.memories[0], recipient: '엄마' });
  assert.throws(() => decodePersonalization(JSON.stringify(duplicate)));
  let written = false;
  const repo = createPersonalizationRepository({ getItem: async () => null, setItem: async () => { written = true; } }, 'a');
  await repo.load(); await assert.rejects(repo.save(invalid)); assert.equal(written, false);
});
test('personalized purchase scoring and hard budget/exclusions use the same ranking path', () => {
  const data = { memories: [], purchases: [{ id: 'x', recipient: '친구', gift: { id: 'fruit', name: '과일', category: '과일' }, feedback: 'liked', source: 'user_reported', recordedAt: '2026-10-14' }] };
  const candidate = (id, category, price) => ({ id, name: id, category, price_krw: price, shipping_fee_per_set_krw: 0, stock_sets: 1, sweetness: 'unsweetened' });
  const catalog = [candidate('tea', 'tea', 10000), candidate('fruit', 'fruit', 20000), candidate('expensive', 'fruit', 60000)];
  const prepared = personalizeSession({ state: { ...singleInitial(), budget: { amount_krw: 30000, shipping_included: true } }, issues: [] }, data, '친구 선물').session;
  assert.deepEqual(recommend(catalog, engineState(prepared.state)).items.map(p => p.id), ['fruit', 'tea']);
  prepared.state.excluded_categories = ['fruit'];
  assert.deepEqual(recommend(catalog, engineState(prepared.state)).items.map(p => p.id), ['tea']);
  data.purchases[0].feedback = 'disliked';
  const neutral = personalizeSession(session(), data, '친구 선물').session;
  assert.equal(recommend(catalog, engineState(neutral.state)).items[0].id, 'tea');
});

test('memory defaults do not reappear after explicit cancellation during the same conversation', () => {
  const data = rememberConditions(emptyPersonalization(), { ...singleInitial(), recipients: ['어머니'], preferences: ['less_sweet'], excluded_categories: ['nuts'] }, '2026-10-14');
  const initial = personalizeSession(session(), data, '엄마 선물').session;
  const cancelled = singleTurn(initial, '단맛 조건 취소하고 견과류 포함해도 돼', []).session;
  assert.deepEqual(cancelled.state.preferences, []);
  assert.deepEqual(cancelled.state.excluded_categories, []);
  const followup = personalizeSession(cancelled, data, '예산 5만원').session;
  assert.deepEqual(followup.state.preferences, []);
  assert.deepEqual(followup.state.excluded_categories, []);
  assert.deepEqual(personalizeSession(session(), data, '엄마 선물').session.state.preferences, ['less_sweet']);
});
test('condition editor target override recalls the new recipient even without free text', () => {
  const edited = personalizeSession({ state: { ...singleInitial(), recipients: ['친구'] }, issues: [] }, memory(), '', ['엄마']);
  assert.deepEqual(edited.session.state.recipients, ['어머니']);
  assert.deepEqual(edited.session.state.excluded_ingredients, ['땅콩']);
  assert.equal(edited.reasons.length, 1);
});
test('prototype food tags are mapped without guessing ambiguous non-food categories', () => {
  const purchase = { id: '1', recipient: '친구', gift: { id: '1', name: '티 세트', category: '전통차' }, source: 'user_reported', feedback: 'liked', recordedAt: '2026-10-14' };
  assert.deepEqual(personalizeSession(session(), { memories: [], purchases: [purchase] }, '친구 선물').session.state.preferences, ['category:tea']);
  assert.deepEqual(personalizeSession(session(), { memories: [], purchases: [{ ...purchase, gift: { ...purchase.gift, category: '카페 선물' } }] }, '친구 선물').session.state.preferences, []);
});
