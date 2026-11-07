// F1/F2 (2026-11-08, last fix): past/recovery/negation sentences never confirm an LLM claim; strength is normalized.
// Mock LLM only. IDs follow ../TEST-PLAN.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInterpreter } from '../index.mjs';
import { hasPastMarker } from '../rules.mjs';
import { claim, classifyAll, mockLlm, readySession, runMessage } from './helpers.mjs';

const call = (interpret, session, text) => interpret({ text, state: structuredClone(session.state) });
const CONFIRM = /지금도 받는 분께 해당하는 조건인가요\?$/;

test('T1-63 a past, recovery or negation sentence never confirms an LLM claim', async () => {
  const session = await readySession(), before = structuredClone(session);
  // Each mock answer is a misreading that would otherwise change the state.
  const cases = [
    ['엄마가 견과류 알레르기였는데 다 나으셨대', claim('견과류 알레르기였는데', 'ingredient', '견과류', 'avoid', 'strong')], // s-03
    ['엄마가 땅콩 알레르기였는데 이제 괜찮아지셨대', claim('땅콩 알레르기였는데', 'ingredient', '땅콩', 'avoid', 'strong')],
    ['엄마는 예전엔 단 걸 피하셨어', claim('단 걸 피하셨어', 'sweetness', 'less_sweet', 'avoid')],
    ['엄마가 커피를 좋아하셨었는데 요즘은 안 드셔', claim('커피를 좋아하셨었는데', 'category', 'coffee_tea', 'prefer')],
    ['엄마는 견과류 알레르기가 없어', claim('견과류 알레르기가 없어', 'ingredient', '견과류', 'avoid', 'strong')],
  ];
  for (const [text, misread] of cases) {
    assert.equal(hasPastMarker(text), true, text);
    const llm = mockLlm([{ claims: [misread] }, classifyAll('recipient')]);
    const result = await call(createInterpreter({ llm }), session, text);
    assert.deepEqual(result.patch, {}, text); assert.equal(result.unresolved, true, text);
    assert.equal(result.questions.length, 1, text); assert.match(result.questions[0], CONFIRM, text);
    const out = await runMessage(session, text, createInterpreter({ llm: mockLlm([{ claims: [misread] }, classifyAll('recipient')]) }));
    assert.equal(out.kind, 'question', text); assert.deepEqual(out.session, before, text);
  }
});

test('T1-63 value phrases with 없 and current-change markers keep applying', async () => {
  const session = await readySession();
  // D4 phrases: "없" is part of the value, not a marker. Rules alone, as before.
  for (const text of ['엄마는 단맛 없는 걸 좋아하셔', '엄마는 설탕 없는 차를 좋아하셔', '엄마는 무가당을 좋아하셔']) {
    assert.equal(hasPastMarker(text), false, text);
    const result = await call(createInterpreter({ llm: mockLlm([]) }), session, text);
    assert.ok(result.patch.preferences?.includes('unsweetened'), text); assert.equal(result.unresolved, false, text);
  }
  // The same phrase through the LLM path (quoted speech) is applied too.
  const quoted = "엄마가 '나는 단맛 없는 게 좋아'라고 하셨어";
  assert.equal(hasPastMarker(quoted), false);
  // Rules read the phrase; only the owner (quoted speech) needs the classification step.
  const quotedStats = [];
  const viaLlm = await call(createInterpreter({ llm: mockLlm([classifyAll('recipient')]), onStats: s => quotedStats.push(s) }), session, quoted);
  assert.deepEqual(viaLlm, { patch: { preferences: ['unsweetened'] }, questions: [], unresolved: false });
  assert.deepEqual(quotedStats[0].path, ['rules', 'llm_classify']);
  // Current-change markers (작년·요즘·부터) describe the present: applied as before (s-02).
  const current = [
    ['엄마가 작년부터 단 걸 줄이셨어', claim('단 걸 줄이셨어', 'sweetness', 'less_sweet', 'avoid'), { preferences: ['less_sweet'] }],
    ['엄마는 요즘 커피를 좋아하셔', claim('커피를 좋아하셔', 'category', 'coffee_tea', 'prefer'), { preferences: ['category:coffee_tea'] }],
  ];
  for (const [text, extracted, patch] of current) {
    assert.equal(hasPastMarker(text), false, text);
    const result = await call(createInterpreter({ llm: mockLlm([{ claims: [extracted] }]) }), session, text);
    assert.deepEqual(result, { patch, questions: [], unresolved: false }, text);
  }
});

test('T1-64 strength is normalized; kind, value and polarity stay strict', async () => {
  const session = await readySession();
  const stats = [];
  // prefer with a strength → strength dropped, preference applied.
  const prefer = await call(createInterpreter({ llm: mockLlm([{ claims: [claim('홍삼을 좋아하셔', 'category', 'health', 'prefer', 'strong')] }]), onStats: s => stats.push(s) }), session, '엄마가 예전부터 홍삼을 좋아하셔');
  assert.deepEqual(prefer, { patch: { preferences: ['category:health'] }, questions: [], unresolved: false });
  assert.equal(stats[0].strengthNormalized, 1); assert.equal(stats[0].calls[0].errorCode, null);
  // avoid without a strength → weak → confirmation question, never an exclusion.
  const avoid = await call(createInterpreter({ llm: mockLlm([{ claims: [claim('홍삼은 글쎄', 'category', 'health', 'avoid', null)] }]) }), session, '엄마는 홍삼은 글쎄');
  assert.deepEqual(avoid, { patch: {}, questions: ['건강식품 상품을 추천에서 빼 드릴까요?'], unresolved: true });
  const invalid = await call(createInterpreter({ llm: mockLlm([{ claims: [claim('홍삼은 글쎄', 'category', 'health', 'avoid', 'very')] }]) }), session, '엄마는 홍삼은 글쎄');
  assert.deepEqual(invalid.patch, {});
  // Strength on sweetness / other is dropped.
  const other = await call(createInterpreter({ llm: mockLlm([{ claims: [claim('그거', 'other', null, null, 'weak')] }]) }), session, '엄마는 그거 좀 그래');
  assert.equal(other.unresolved, true);
  // Still strict: wrong kind, value or polarity is rejected.
  for (const bad of [claim('그거', 'budget', 1), claim('그거', 'ingredient', '설탕', 'avoid', 'strong'), claim('그거', 'category', 'health', 'maybe')])
    await assert.rejects(call(createInterpreter({ llm: mockLlm([{ claims: [bad] }]) }), session, '엄마는 그거 좀 그래'), { code: 'invalid_response' });
});

test('T1-63 the crab allergen "게" is read only in an ingredient context, not in "…는 게"', async () => {
  const session = await readySession();
  for (const [text, patch] of [['엄마는 단맛 없는 게 좋으셔', { preferences: ['unsweetened'] }], ['엄마는 게 알레르기가 있어', { excluded_ingredients: ['게'] }], ['엄마는 게를 못 드셔', { excluded_ingredients: ['게'] }]]) {
    const result = await call(createInterpreter({ llm: mockLlm([]) }), session, text);
    assert.deepEqual(result, { patch, questions: [], unresolved: false }, text);
  }
});

test('T1-63 spaced negation markers are recognized ("안 싫", "싫지 않")', () => {
  for (const text of ['엄마는 단 걸 안 싫어해', '엄마는 견과류가 싫지 않대', '엄마는 커피를 안  싫어하셔']) assert.equal(hasPastMarker(text), true, text);
  for (const text of ['엄마는 단 걸 싫어하셔', '엄마가 작년부터 단 걸 줄이셨어', '엄마가 예전부터 홍삼을 좋아하셔']) assert.equal(hasPastMarker(text), false, text);
});
