import test from 'node:test';
import assert from 'node:assert/strict';
import { recipientGender, recipientAge, profilePrior, PREFERENCE_TAGS } from '../lib/catalog.mjs';
import { rankProducts, APP_RANKING } from '../lib/engine.mjs';
import { genderLean } from '../lib/ranking.mjs';
import { capabilityIssue, capabilityFix, profileTagsFromText, verifiedAction } from '../baseline/agents/full-chat/capabilities.mjs';

const product = (id, category, name, rating_count = 100) => ({ id, category, name, description: '', price_krw: 40000, shipping_fee_per_set_krw: 0, stock_sets: 9, arrival_date: '2026-11-27', packaging: 'basic', sweetness: 'unknown', brand: null, allergens_declared: [], allergen_information_complete: false, rating_count });
const state = (recipients, preferences = []) => ({ occasion: null, recipients, quantity: null, same_product: null, budget: { amount_krw: 50000, scope: null, shipping_included: false }, preferences, excluded_categories: [], excluded_ingredients: [], brand: null, delivery_by: null, packaging: null });
const top = (products, s) => rankProducts(products, s, APP_RANKING).items.map(p => p.id);

test('손주 is a grandchild of either gender; stated profile tags win over the recipient word', () => {
  assert.equal(recipientGender(['손주']), null);
  assert.equal(recipientGender(['손자']), 'male');
  assert.equal(recipientGender(['손녀']), 'female');
  assert.equal(recipientAge(['손주']), 'child');
  assert.equal(recipientGender(['손주'], ['gender:male']), 'male');
  assert.equal(recipientAge(['조카'], ['age:teen']), 'teen');
  for (const tag of ['gender:male', 'gender:female', 'age:child', 'age:teen', 'age:adult', 'age:elder']) assert.ok(PREFERENCE_TAGS.includes(tag));
});

test('gender and age give a rough prior; an unknown age adds no gender-specific guess', () => {
  assert.equal(profilePrior('toy', null, 'child'), 2);
  assert.equal(profilePrior('watch', 'male', 'adult'), 1);
  assert.equal(profilePrior('beauty', 'male', 'adult'), -1);
  assert.equal(profilePrior('toy', null, 'adult'), -1);
  assert.equal(profilePrior('accessory', 'male', null), 0);
  assert.equal(genderLean(product('a', 'toy', '트랜스포밍 자동차 장난감')), 'male');
  assert.equal(genderLean(product('b', 'toy', '유니콘 인형')), 'female');
  assert.equal(genderLean(product('c', 'toy', '가족 보드게임')), null);
});

test('a child of unknown gender gets unisex picks first; a stated gender moves its items up', () => {
  const products = [product('car', 'toy', '트랜스포밍 자동차 장난감', 300), product('doll', 'toy', '토끼 애착인형', 300), product('game', 'toy', '가족 보드게임', 100)];
  assert.equal(top(products, state(['손주']))[0], 'game');
  assert.equal(top(products, state(['손주'], ['gender:male']))[0], 'car');
  assert.equal(top(products, state(['손주'], ['gender:female']))[0], 'doll');
});

test('stated tastes outrank the gender/age prior, and alcohol never goes to children or teens', () => {
  const products = [product('watch', 'watch', '손목시계', 500), product('cream', 'beauty', '핸드크림 세트', 100), product('toy', 'toy', '퍼즐 1000 피스', 100), product('soju', 'liquor', '전통소주 세트', 900)];
  assert.equal(top(products, state(['친구'], ['gender:male']))[0], 'watch');
  assert.equal(top(products, state(['친구'], ['gender:male', 'category:beauty']))[0], 'cream');
  assert.equal(top(products, state(['친구'], ['category:toy']))[0], 'toy');
  assert.ok(!top(products, state(['조카'], ['age:teen', 'category:liquor'])).includes('soju'));
});

test('a follow-up describing the same recipient is not accepted as a recipient change', () => {
  const context = (recipients, text) => ({ state: { recipients, excluded_categories: [] }, text, history: [] });
  const change = recipients => ({ action: 'update_conditions', patch: { recipients } });
  assert.match(capabilityIssue(context(['손주'], '남자아이야'), change(['남자아이'])), /describes the current recipient/);
  assert.match(capabilityIssue(context(['친구'], '여자야'), change(['여자'])), /describes the current recipient/);
  assert.equal(capabilityIssue(context(['손주'], '손주 말고 친구 선물'), change(['친구'])), null);
  assert.equal(capabilityIssue(context(['손주'], '어머니 선물로 바꿀게'), change(['어머니'])), null);
  assert.equal(capabilityIssue(context([], '남자아이 선물'), change(['남자아이'])), null);
});

test('the agent cannot ask the question the user just answered', () => {
  const question = '30대 남성은 손주를 뜻하나요, 아니면 다른 수령인인가요?';
  const context = { state: { recipients: ['손주'], excluded_categories: [] }, text: '손주야', currentQuestion: question, history: [{ role: 'user', text: '30대 남자에게 어울리는 선물로' }, { role: 'assistant', text: question }] };
  assert.match(capabilityIssue(context, { action: 'clarify', question }), /already asked/);
  assert.match(capabilityIssue({ ...context, currentQuestion: '' }, { action: 'clarify', question: '30대 남성은 손주를 뜻하나요 아니면 다른 수령인인가요' }), /already asked/);
  assert.equal(capabilityIssue(context, { action: 'clarify', question: '손주분 취향을 알려주실래요?' }), null);
  assert.equal(capabilityIssue(context, { action: 'update_conditions', patch: { preferences: ['gender:male', 'age:adult'] } }), null);
});

test('reworded repeats and needless "is this the recipient?" questions are rejected; real ambiguity may still be asked', () => {
  const asked = '현재 수령인인 손주가 30대 남성이라는 뜻인가요, 아니면 손주 대신 다른 30대 남성에게 선물하시나요?';
  const one = { recipients: ['손주'], excluded_categories: [] };
  const clarify = question => ({ action: 'clarify', question });
  assert.match(capabilityIssue({ state: one, text: '손주야', currentQuestion: asked, history: [] }, clarify('손주가 30대 남성이라는 뜻인가요, 아니면 손주 대신 다른 30대 남성에게 선물하시나요?')), /already asked/);
  assert.match(capabilityIssue({ state: one, text: '30대 남자에게 어울리는 선물로', currentQuestion: '', history: [] }, clarify(asked)), /Do not ask/);
  assert.equal(capabilityIssue({ state: { recipients: ['손주', '친구'], excluded_categories: [] }, text: '30대 남자야', currentQuestion: '', history: [] }, clarify('30대 남자는 손주인가요, 친구인가요?')), null);
  assert.equal(capabilityIssue({ state: one, text: '손주 말고 30대 남자 동료 선물', currentQuestion: '', history: [] }, clarify('동료분은 어떤 걸 좋아하세요?')), null);
});

test('needless recipient questions are caught however they are worded', () => {
  const context = { state: { recipients: ['손주'], excluded_categories: [] }, text: '30대 남자에게 어울리는 선물로', currentQuestion: '', history: [] };
  for (const question of ['30대 남성은 기존 손주를 뜻하나요, 아니면 다른 수신자인가요?', '손주분이 30대 남성인 거죠?'])
    assert.match(capabilityIssue(context, { action: 'clarify', question }), /Do not ask/);
  assert.equal(capabilityIssue(context, { action: 'clarify', question: '선호하는 브랜드가 있나요?' }), null);
});

test('when the model keeps asking, the server applies the stated profile instead of looping', () => {
  assert.deepEqual(profileTagsFromText('30대 남자에게 어울리는 선물로'), ['gender:male', 'age:adult']);
  assert.deepEqual(profileTagsFromText('남자아이야'), ['gender:male', 'age:child']);
  assert.deepEqual(profileTagsFromText('손주야'), []);
  const question = '30대 남성은 기존 손주를 뜻하나요, 아니면 다른 수신자인가요?';
  const state = { recipients: ['손주'], preferences: ['less_sweet'], excluded_categories: [] };
  const update = { action: 'update_conditions', patch: { preferences: ['less_sweet', 'gender:male', 'age:adult'] } };
  assert.deepEqual(capabilityFix({ state, text: '30대 남자에게 어울리는 선물로', history: [], observations: [] }, { action: 'clarify', question }), update);
  assert.deepEqual(capabilityFix({ state, text: '손주야', currentQuestion: question, history: [{ role: 'user', text: '30대 남자에게 어울리는 선물로' }, { role: 'assistant', text: question }], observations: [] }, { action: 'clarify', question }), update);
  assert.deepEqual(capabilityFix({ state, text: '30대 남자에게 어울리는 선물로', history: [], observations: [{}] }, { action: 'clarify', question }), { action: 'respond', type: 'result' });
  assert.equal(capabilityFix({ state: { ...state, recipients: ['손주', '친구'] }, text: '30대 남자야', history: [], observations: [] }, { action: 'clarify', question: '30대 남자는 손주인가요, 친구인가요?' }), null);
});

test('a subjectless taste goes to the single recipient, and verified profile/taste updates skip model review', () => {
  const state = { recipients: ['친구'], preferences: ['gender:male', 'age:adult'], excluded_categories: [], excluded_ingredients: [] };
  assert.deepEqual(capabilityFix({ state, text: '화장품을 좋아해', history: [], observations: [] }, { action: 'clarify', question: '친구에게 화장품 선물을 원하시나요?' }), { action: 'update_conditions', patch: { preferences: ['gender:male', 'age:adult', 'category:beauty'] } });
  const colleague = { state: { recipients: ['동료'], preferences: [], excluded_categories: [] }, text: '50대 여성분이셔', history: [], observations: [] };
  assert.equal(verifiedAction(colleague, { action: 'update_conditions', patch: { preferences: ['gender:female', 'age:adult'] } }), true);
  assert.equal(verifiedAction(colleague, { action: 'update_conditions', patch: { preferences: ['gender:female', 'age:adult', 'category:beauty'] } }), false);
  assert.equal(verifiedAction(colleague, { action: 'update_conditions', patch: { recipients: ['50대 여성'] } }), false);
  assert.equal(verifiedAction({ ...colleague, state: { ...colleague.state, preferences: ['gender:female', 'age:adult'] }, observations: [{}] }, { action: 'respond', type: 'result' }), true);
  assert.equal(verifiedAction({ ...colleague, text: '동료 말고 50대 여성 상사' }, { action: 'update_conditions', patch: { preferences: ['gender:female', 'age:adult'] } }), false);
});
