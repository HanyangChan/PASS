// R1 (2026-11-08): tense/negation markers are checked on the whole message, and rule/LLM disagreement is never confirmed.
// Mock LLM only. IDs follow ../TEST-PLAN.md.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze } from '../rules.mjs';
import { createInterpreter } from '../index.mjs';
import { QUESTIONS } from '../vocabulary.mjs';
import { claim, classifyAll, mockLlm, readySession, runMessage } from './helpers.mjs';

const call = (interpret, session, text) => interpret({ text, state: structuredClone(session.state) });
const tasteClaims = (text, state) => analyze(text, state).claims.filter(c => ['ingredient', 'category', 'sweetness'].includes(c.kind));

test('T1-61 a tense or negation marker anywhere stops rules from confirming any taste claim', async () => {
  const session = await readySession(), before = structuredClone(session);
  const sentences = [
    '엄마가 견과류 알레르기였는데 다 나으셨대', // s-03 (B-layer regression)
    '엄마가 예전엔 단 걸 피했는데 지금은 괜찮대',
    '아빠가 견과류 알레르기였는데 다 나으셨어',
    '엄마는 커피를 좋아하셨는데 요즘은 안 드셔',
    '엄마는 견과류 알레르기가 있었는데 지금은 없어',
  ];
  for (const text of sentences) {
    const analysis = analyze(text, session.state);
    assert.equal(analysis.complete, false, text);
    assert.deepEqual(tasteClaims(text, session.state), [], text);
    // Without an llm: nothing is confirmed.
    const noLlm = await call(createInterpreter({}), session, text);
    assert.deepEqual(noLlm, { patch: {}, questions: [QUESTIONS.generic], unresolved: true }, text);
    // With an llm that reports the past fact as no longer true: still nothing is confirmed.
    const llm = mockLlm([{ claims: [] }]);
    const out = await runMessage(session, text, createInterpreter({ llm }));
    assert.equal(out.kind, 'question', text); assert.deepEqual(out.session, before, text);
    assert.equal(llm.calls.length, 1, text);
  }
});

test('T1-61 D4 sweetness phrases and condition phrases are still handled by rules alone', async () => {
  const session = await readySession();
  const d4 = [
    ['엄마는 단맛 없는 걸 좋아하셔', 'unsweetened'], ['엄마는 설탕 없는 차를 좋아하셔', 'unsweetened'], ['엄마는 무가당을 좋아하셔', 'unsweetened'],
    ['엄마는 무설탕을 좋아하셔', 'unsweetened'], ['엄마는 설탕 안 들어간 걸 좋아하셔', 'unsweetened'], ['엄마는 설탕을 피해', 'less_sweet'],
    ['어머니는 단 거 싫어하셔', 'less_sweet'], ['엄마는 덜 단 걸 좋아하셔', 'less_sweet'],
  ];
  for (const [text, value] of d4) {
    const llm = mockLlm([]);
    const result = await call(createInterpreter({ llm }), session, text);
    assert.ok(result.patch.preferences?.includes(value), `${text}: ${JSON.stringify(result)}`);
    assert.equal(llm.calls.length, 0, text);
  }
  const llm = mockLlm([]);
  assert.deepEqual(await call(createInterpreter({ llm }), session, '예산은 상관없어'), { patch: {}, questions: [QUESTIONS.condition], unresolved: true });
  assert.equal(llm.calls.length, 0);
});

test('T1-62 when rules and the LLM judge the same target differently, neither is confirmed', async () => {
  const session = await readySession(), before = structuredClone(session);
  const cases = [
    // Rules read "못 드셨" as a strong avoid; the LLM reads the whole sentence as "now fine".
    ['엄마는 견과류를 못 드셨는데 이제는 잘 드셔', claim('견과류를 못 드셨는데 이제는 잘 드셔', 'ingredient', '견과류', 'allow')],
    // Rules read "좋아하셨" as a preference; the LLM sees that she quit.
    ['엄마는 커피를 좋아하셨는데 끊으셨어', claim('커피를 좋아하셨는데 끊으셨어', 'category', 'coffee_tea', 'avoid', 'strong')],
    // The LLM puts its claim on the other clause but about the same target.
    ['엄마는 커피를 좋아하셨는데 끊으셨어', claim('끊으셨어', 'category', 'coffee_tea', 'avoid', 'strong')],
    // The LLM sees the rule-read clause only as `other`.
    ['엄마는 견과류를 못 드셨는데 이제는 잘 드셔', claim('엄마는 견과류를 못 드셨', 'other')],
  ];
  for (const [text, extracted] of cases) {
    const llm = mockLlm([{ claims: [extracted] }, classifyAll('recipient')]);
    const result = await call(createInterpreter({ llm }), session, text);
    assert.equal(result.unresolved, true, `${text} / ${extracted.span}`); assert.deepEqual(result.patch, {}, text);
    assert.equal(result.questions.length, 1, text); assert.match(result.questions[0], /지금도 받는 분께 해당하는 조건인가요\?$/, text);
    const out = await runMessage(session, text, createInterpreter({ llm: mockLlm([{ claims: [extracted] }, classifyAll('recipient')]) }));
    assert.deepEqual(out.session, before, text);
  }
  // Agreement keeps the rule claim (no extra question).
  const agree = mockLlm([{ claims: [claim('견과류를 못 드셨는데', 'ingredient', '견과류', 'avoid', 'strong')] }]);
  assert.deepEqual(await call(createInterpreter({ llm: agree }), session, '엄마는 견과류를 못 드셨는데 이제는 잘 드셔'), { patch: { excluded_ingredients: ['견과류'] }, questions: [], unresolved: false });
});
