import test from 'node:test';
import assert from 'node:assert/strict';
import { initial } from '../../../src/vendor/engine.mjs';
import { parseConditions, classifyIntent } from '../parser.mjs';
import { createAgent } from '../index.mjs';
import { createSession, runTurn } from '../../../src/index.mjs';
import { products } from '../../../examples/catalog.mjs';

const state = (extra = {}) => ({ ...initial(), recipients: ['어머니'], quantity: 1, same_product: true, budget: { amount_krw: 50000, scope: 'per_set', shipping_included: true }, ...extra });
const parse = (text, s = state(), pendingQuestion = '') => parseConditions(text, structuredClone(s), { pendingQuestion });
const ok = r => { assert.equal(r.unresolved, false, `unresolved: ${r.questions?.[0]}`); return r.patch; };

test('what-if budget: "N으로 올리면" is absolute, "N 더 올리면" and "N 올리면" add', () => {
  assert.deepEqual(classifyIntent('7만원으로 올리면?', state()), { kind: 'what_if_budget', amount_krw: 70000, intent: 'compare_budget' });
  assert.equal(classifyIntent('3만원 더 올리면?', state()).amount_krw, 80000);
  assert.equal(classifyIntent('3만원 올리면?', state()).amount_krw, 80000);
  assert.equal(classifyIntent('4만원으로 낮추면?', state()).amount_krw, 40000);
  assert.equal(classifyIntent('만원 줄이면?', state()).amount_krw, 40000);
  assert.equal(classifyIntent('예산 7만원이면?', state()).amount_krw, 70000);
});

test('an explicit correction keeps the last amount', () => {
  assert.equal(ok(parse('예산 5만원. 아니, 7만원으로')).budget.amount_krw, 70000);
  assert.equal(ok(parse('5만원 말고 7만원으로 해줘')).budget.amount_krw, 70000);
  assert.equal(parse('5만원이나 7만원').unresolved, true);
});

test('several allergens in one sentence are all excluded and earlier ones kept', () => {
  assert.deepEqual(ok(parse('땅콩이랑 우유 알레르기 있어요')).excluded_ingredients, ['땅콩', '우유']);
  assert.deepEqual(ok(parse('우유는 빼고 땅콩도 제외해 주세요', state({ excluded_ingredients: ['밀'] }))).excluded_ingredients, ['밀', '우유', '땅콩']);
  assert.deepEqual(ok(parse('견과류는 빼주세요')).excluded_ingredients, ['견과류']);
});

test('"X 알레르기 없어요" removes only X; without a name it clears all', () => {
  assert.deepEqual(ok(parse('땅콩 알레르기 없어요', state({ excluded_ingredients: ['땅콩', '우유'] }))).excluded_ingredients, ['우유']);
  assert.deepEqual(ok(parse('알레르기 없어요', state({ excluded_ingredients: ['땅콩', '우유'] }))).excluded_ingredients, []);
});

test('"향수 말고" asks about the scope instead of excluding all beauty, and the reply applies it', () => {
  const r = parse('향수 말고 커피로 추천해줘');
  assert.equal(r.unresolved, false);
  assert.deepEqual(r.patch.preferences, ['category:coffee_tea', 'type:coffee']);
  assert.equal(r.patch.excluded_categories, undefined);
  assert.match(r.questions[0], /향수만.*뷰티/);
  assert.deepEqual(ok(parse('향수만', state(), r.questions[0])).preferences, ['avoid_fragrance']);
  assert.deepEqual(ok(parse('뷰티 전체', state(), r.questions[0])).excluded_categories, ['beauty']);
});

test('budget and shipping phrasings', () => {
  assert.equal(ok(parse('5만원 안쪽으로')).budget.amount_krw, 50000);
  const both = ok(parse('배송비까지 해서 5만원', state({ budget: { amount_krw: null, scope: 'per_set', shipping_included: null } })));
  assert.deepEqual([both.budget.amount_krw, both.budget.shipping_included], [50000, true]);
});

test('occasions: 생신, 합격 축하, 결혼기념일', () => {
  const birthday = ok(parse('엄마 생신 선물 추천', initial()));
  assert.deepEqual([birthday.recipients, birthday.occasion], [['어머니'], '생일']);
  assert.equal(ok(parse('합격 축하 선물')).occasion, '합격');
  assert.equal(ok(parse('결혼기념일 선물')).occasion, '기념일');
});

test('honorific tastes and polite exclusions', () => {
  const coffee = ok(parse('엄마는 커피를 좋아하세요', initial()));
  assert.deepEqual([coffee.recipients, coffee.preferences], [['어머니'], ['category:coffee_tea', 'type:coffee']]);
  assert.deepEqual(ok(parse('먹는 건 빼주세요')).excluded_categories, ['food', 'snack', 'coffee_tea', 'health']);
  assert.deepEqual(ok(parse('향이 센 건 싫어하세요')).preferences, ['avoid_fragrance']);
});

test('yes/no follow the pending shipping question; without it the conditions stay', () => {
  assert.equal(ok(parse('네', state(), '예산에 배송비도 포함할까요?')).budget.shipping_included, true);
  assert.equal(ok(parse('아니요', state(), '예산에 배송비도 포함할까요?')).budget.shipping_included, false);
  assert.equal(parse('네').unresolved, true);
});

test('"없어요" depends on whether the question asked about having an allergy or which ingredient', () => {
  assert.deepEqual(ok(parse('없어요', state({ excluded_ingredients: ['우유'] }), '피해야 할 알레르기가 있나요?')).excluded_ingredients, []);
  const ingredient = parse('없어요', state(), '피해야 할 알레르기 성분을 알려주세요.');
  assert.equal(ingredient.unresolved, true);
  assert.match(ingredient.questions[0], /알레르기가 없으면/);
});

test('"친구 말고 엄마한테" switches the recipient and starts fresh', () => {
  const friend = state({ recipients: ['친구'], preferences: ['category:audio'] });
  assert.deepEqual(ok(parse('친구 말고 엄마한테 줄 거야', friend)).recipients, ['어머니']);
});

test('the giver\'s own taste is set aside and only the recipient\'s is applied', () => {
  const r = ok(parse('저는 커피 좋아하는데 엄마는 차 좋아해요', initial()));
  assert.deepEqual([r.recipients, r.preferences], [['어머니'], ['category:coffee_tea', 'type:tea']]);
  assert.equal(parse('저는 커피 좋아해요').unresolved, true);
});

test('"왜 이게 1위야?" is an explanation request; a hypothetical with other changes asks', () => {
  for (const text of ['왜 이게 1위야?', '이게 왜 1위야?', '1위는 왜 추천했어?', '왜 이걸 추천했어?']) assert.equal(classifyIntent(text, state()).intent, 'explain', text);
  assert.equal(classifyIntent('예산 7만원이면 향수 빼고 어때?', state()).kind, 'clarify');
});

test('through the router: no model calls, hypotheticals never change the real conditions', async () => {
  let calls = 0;
  const agent = createAgent({ interpret: async () => { calls++; throw Error('rules only'); } });
  const base = (await runTurn({ session: createSession('cases'), products, request: { kind: 'patch', expectedVersion: 0, patch: state() } })).session;
  const send = (s, text, extra = {}) => agent.runTurn({ session: s, products, request: { kind: 'message', expectedVersion: s.version, text }, ...extra });
  const compare = await send(base, '7만원으로 올리면?');
  assert.equal(compare.kind, 'comparison');
  assert.equal(compare.evaluatedState.budget.amount_krw, 70000);
  assert.equal(compare.session.state.budget.amount_krw, 50000);
  const asked = await send(base, '예산 7만원이면 향수 빼고 어때?');
  assert.equal(asked.kind, 'question');
  assert.deepEqual(asked.session, base);
  const why = await send(base, '왜 이게 1위야?');
  assert.equal(why.routing.intent, 'explain');
  assert.deepEqual(why.session.state, base.state);
  for (const text of ['땅콩이랑 우유 알레르기 있어요', '배송비까지 해서 5만원', '저는 커피 좋아하는데 엄마는 차 좋아해요', '먹는 건 빼주세요']) {
    const out = await send(base, text);
    assert.notEqual(out.kind, 'question', `${text}: ${out.question}`);
  }
  assert.equal(calls, 0);
});
