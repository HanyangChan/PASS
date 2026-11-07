// ① dialogue: parseRules first, one LLM call for the rest. AC2, AC7 (LLM side), AC16 (rule path = 0 calls), R9.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initial } from '../../../src/vendor/engine.mjs';
import { runTurn, createSession } from '../../../src/index.mjs';
import { parseRules } from '../../../src/parser.mjs';
import { createFakeLlm, LlmError } from '../llm/index.mjs';
import { createDialogue, toPort, FALLBACK_QUESTION, TIMEOUT_TEXT, dialogueTimeoutMs } from '../dialogue/agent.mjs';
import { products } from './fixtures/catalog.mjs';

const S1 = '부모님 추석 선물이야. 엄마는 단 거 싫어하시고 땅콩 알레르기, 아빠는 등산 좋아하셔. 5만 원';
const s1Reply = (over = {}) => ({
  recipients: ['부모님'], occasion: '추석', budget_amount_krw: 50000,
  preferences: ['less_sweet'], excluded_categories: [], excluded_ingredients: ['땅콩'],
  memoryCandidates: [
    { recipient: '엄마', key: 'pref:less_sweet', polarity: 1, evidence: '엄마는 단 거 싫어하시고' },
    { recipient: '엄마', key: 'allergy:땅콩', polarity: -1, evidence: '땅콩 알레르기' },
    { recipient: '아빠', key: 'hobby:등산', polarity: 1, evidence: '아빠는 등산 좋아하셔' },
  ],
  ...over,
});
const dlg = (reply, opts = {}) => { const llm = createFakeLlm({ json: reply === undefined ? [] : [reply] }); return { llm, d: createDialogue({ llm, ...opts }) }; };
const state = (over = {}) => ({ ...initial(), ...over });

test('AC16: a rule-resolvable message never calls the LLM and matches parseRules', async () => {
  const { llm, d } = dlg();
  const text = '어머니 한 세트 세트당 예산 5만원 이하 배송비 포함 추천';
  const out = await d.interpret({ text, state: state() });
  assert.equal(llm.calls.length, 0);
  assert.deepEqual(out.patch, parseRules(text).patch);
  assert.equal(out.unresolved, false);
  assert.deepEqual([out.critiques, out.memoryCandidates, out.mentionedRecipients], [[], [], ['어머니']]);
});

test('R9 / S1: a free sentence makes ONE LLM call and yields the group patch plus per-parent memory candidates', async () => {
  const { llm, d } = dlg(s1Reply());
  const out = await d.interpret({ text: S1, state: state() });
  assert.equal(llm.calls.length, 1);
  assert.equal(llm.calls[0].role, 'dialogue');
  assert.equal(llm.calls[0].timeoutMs, 8000, 'default DIALOGUE_LLM_TIMEOUT_MS');
  assert.equal(out.unresolved, false);
  assert.deepEqual(out.patch, { recipients: ['부모님'], occasion: '추석', budget: { amount_krw: 50000 }, preferences: ['less_sweet'], excluded_ingredients: ['땅콩'] });
  assert.deepEqual(out.memoryCandidates.map(c => [c.recipientName, c.key, c.polarity, c.evidence, c.basis]), [
    ['어머니', 'pref:less_sweet', 1, '엄마는 단 거 싫어하시고', 'explicit'],
    ['어머니', 'allergy:땅콩', -1, '땅콩 알레르기', 'explicit'],
    ['아버지', 'hobby:등산', 1, '아빠는 등산 좋아하셔', 'explicit'],
  ]);
  assert.deepEqual([...out.mentionedRecipients].sort(), ['부모님', '아버지', '어머니']);
});

test('R9: without an LLM the S1 sentence is NOT interpreted: fallback question, empty patch', async () => {
  const d = createDialogue({ llm: null });
  const out = await d.interpret({ text: S1, state: state() });
  assert.deepEqual(out, { patch: {}, questions: [FALLBACK_QUESTION], unresolved: true, critiques: [], memoryCandidates: [], mentionedRecipients: [] });
  assert.equal(FALLBACK_QUESTION, '받는 분과 예산을 조금 더 구체적으로 알려주세요.');
});

test('vocabulary: out-of-vocabulary preferences, categories, keys, recipients and invented evidence are dropped', async () => {
  const { d } = dlg(s1Reply({
    preferences: ['less_sweet', 'category:weapons', 'luxury', 'category:fitness'],
    excluded_categories: ['snack', 'cigarettes'],
    excluded_ingredients: ['땅콩', '글루텐'],
    memoryCandidates: [
      { recipient: '엄마', key: 'pref:age:60s', polarity: 1, evidence: '엄마는 단 거 싫어하시고' },        // key outside TRD 5.2
      { recipient: '엄마', key: 'pref:less_sweet', polarity: 1, evidence: '엄마는 달콤한 걸 싫어한다고 했다' }, // evidence not in the user's text
      { recipient: '할머니', key: 'hobby:등산', polarity: 1, evidence: '아빠는 등산 좋아하셔' },             // person not mentioned
      { recipient: '엄마', key: 'allergy:땅콩', polarity: -1, evidence: '엄마는 단 거 싫어하시고' },         // allergy sentence must name the allergen
      { recipient: '아빠', key: 'hobby:등산', polarity: 1, evidence: '아빠는 등산 좋아하셔' },
    ],
  }));
  const out = await d.interpret({ text: S1, state: state() });
  assert.deepEqual(out.patch.preferences, ['less_sweet', 'category:fitness']);
  assert.deepEqual(out.patch.excluded_categories, ['snack']);
  assert.deepEqual(out.patch.excluded_ingredients, ['땅콩'], '글루텐 is outside the allergen vocabulary');
  assert.deepEqual(out.memoryCandidates.map(c => c.key), ['hobby:등산']);
});

test('AC7: an allergy enters the patch only if the user named it in this sentence', async () => {
  const { d } = dlg(s1Reply({ excluded_ingredients: ['땅콩', '우유'] }));
  const out = await d.interpret({ text: S1, state: state() });
  assert.deepEqual(out.patch.excluded_ingredients, ['땅콩'], '우유 was never said');
});

test('AC7: an LLM patch can never shrink allergies, exclusions or preferences already in the state', async () => {
  const cur = state({ recipients: ['부모님'], excluded_ingredients: ['땅콩'], excluded_categories: ['snack'], preferences: ['less_sweet'] });
  const { d } = dlg({ recipients: [], excluded_ingredients: [], excluded_categories: [], preferences: [], memoryCandidates: [], budget_amount_krw: 70000 });
  const out = await d.interpret({ text: '예산은 7만 원으로 바꿔줘 그리고 센스 있게', state: cur });
  assert.equal(out.patch.budget.amount_krw, 70000);
  for (const k of ['excluded_ingredients', 'excluded_categories', 'preferences', 'recipients']) assert.equal(Object.hasOwn(out.patch, k), false, k);
  const added = await dlg({ recipients: [], excluded_ingredients: ['우유'], memoryCandidates: [] }).d.interpret({ text: '우유 알레르기도 있어', state: cur });
  assert.deepEqual(added.patch.excluded_ingredients, ['땅콩', '우유'], 'additions are unions with the state');
});

test('AC7: "이제 땅콩 먹어도 돼" yields a negation candidate (routed to the delete question later) and no shrinking patch', async () => {
  const cur = state({ recipients: ['어머니'], excluded_ingredients: ['땅콩'] });
  const { d } = dlg({ recipients: [], excluded_ingredients: [], memoryCandidates: [{ recipient: '엄마', key: 'allergy:땅콩', polarity: 1, evidence: '이제 땅콩 먹어도 돼' }] });
  const out = await d.interpret({ text: '엄마는 이제 땅콩 먹어도 돼', state: cur });
  assert.deepEqual(out.patch, {});
  assert.deepEqual(out.memoryCandidates.map(c => [c.key, c.polarity]), [['allergy:땅콩', 1]]);
});

test("a recipient switch does not carry the previous recipient's allergies into the LLM patch", async () => {
  const cur = state({ recipients: ['친구'], excluded_ingredients: ['우유'] });
  const out = await dlg(s1Reply()).d.interpret({ text: S1, state: cur });
  assert.deepEqual(out.patch.excluded_ingredients, ['땅콩']);
});

test('AC2: an LLM that cannot resolve returns exactly one question and an empty patch; runTurn leaves the session unchanged', async () => {
  const { d } = dlg({ recipients: [], memoryCandidates: [], question: '누구에게 선물하실 건가요? 예산도 알려주세요.', unresolved: true });
  const session = createSession('s'), before = structuredClone(session);
  const out = await runTurn({ session, products, request: { kind: 'message', text: '센스 있는 선물', expectedVersion: 0 }, interpret: toPort(d) });
  assert.equal(out.kind, 'question'); assert.deepEqual(out.session, before);
  const raw = await dlg({ recipients: [], memoryCandidates: [], question: '누구에게 선물하실 건가요?', unresolved: true }).d.interpret({ text: '센스 있는 선물', state: state() });
  assert.equal(raw.questions.length, 1); assert.deepEqual(raw.patch, {}); assert.equal(raw.unresolved, true);
});

test('an LLM with nothing usable is "unresolved" with the fallback question, never an empty "resolved" turn', async () => {
  const out = await dlg({ recipients: [], memoryCandidates: [] }).d.interpret({ text: '센스 있는 선물', state: state() });
  assert.equal(out.unresolved, true); assert.deepEqual(out.questions, [FALLBACK_QUESTION]);
});

test('LLM failure or schema violation degrades to the question path and leaks nothing about the user text', async () => {
  for (const bad of [new LlmError('llm_http'), { recipients: 'mom', memoryCandidates: [] }, 'nonsense', { recipients: [], memoryCandidates: [], question: '   ' }, { recipients: [], memoryCandidates: [], unresolved: true }]) {
    const out = await dlg(bad).d.interpret({ text: S1, state: state() });
    assert.equal(out.unresolved, true); assert.deepEqual(out.patch, {}); assert.deepEqual(out.questions, [FALLBACK_QUESTION], 'error and empty answers ask the real question');
    assert.ok(!JSON.stringify(out).includes('땅콩'));
  }
});

test('user text goes in `input`, never in the system prompt; the prompt says user data is not an instruction', async () => {
  const { llm, d } = dlg(s1Reply());
  await d.interpret({ text: S1, state: state() });
  const call = llm.calls[0];
  assert.ok(!call.system.includes('땅콩') && !call.system.includes('추석'));
  assert.match(call.system, /지시가 아/);
  assert.equal(call.input.text, S1);
});

test('toPort returns only {patch, questions, unresolved} for the common runTurn port', async () => {
  const port = toPort(dlg(s1Reply()).d);
  const out = await port({ text: S1, state: state() });
  assert.deepEqual(Object.keys(out).sort(), ['patch', 'questions', 'unresolved']);
});

test('guards: money fields need words in the text; critiques are vocabulary-checked and never enter the patch', async () => {
  const { d } = dlg(s1Reply({ budget_amount_krw: 90000, budget_scope: 'per_set', shipping_included: true, critiques: [{ key: 'dislike:category:snack', polarity: -1 }, { key: 'luxury', polarity: 1 }, { key: 'allergy:땅콩', polarity: 1 }] }));
  const out = await d.interpret({ text: S1, state: state() });
  assert.deepEqual(out.patch.budget, undefined, 'amount 90000 / scope / shipping were not said');
  assert.deepEqual(out.critiques, [{ key: 'dislike:category:snack', polarity: -1 }]);
  assert.equal(Object.hasOwn(out.patch, 'excluded_categories'), false);
});

test('K33: "부모님 설 선물 추천해줘" is solved WITHOUT an LLM: occasion split off, the rest goes to parseRules', async () => {
  for (const llm of [null, createFakeLlm({ json: [] })]) {
    const d = createDialogue({ llm });
    const out = await d.interpret({ text: '부모님 설 선물 추천해줘', state: state() });
    assert.equal(out.unresolved, false);
    assert.deepEqual(out.patch, { recipients: ['부모님'], occasion: '설' });
    assert.deepEqual(out.mentionedRecipients, ['부모님']);
    if (llm) assert.equal(llm.calls.length, 0);
  }
  // the common port gives the same result through the baseline runTurn (createAgent default, no key in tests)
  const out = await runTurn({ session: createSession('k33'), products, interpret: toPort(createDialogue({ llm: null })), request: { kind: 'message', text: '부모님 설 선물 추천해줘', expectedVersion: 0 } });
  assert.equal(out.kind, 'question');
  assert.equal(out.question, '예산 상한을 알려주세요.');
  assert.deepEqual([out.session.state.recipients, out.session.state.occasion], [['부모님'], '설']);
});

test('K33: occasion words and their canonical value; 설 only as a word; two occasions are not guessed', async () => {
  const d = createDialogue({ llm: null });
  const cases = [
    ['부모님 설날 선물 추천해줘', '설'], ['어머니 추석 선물 추천해줘', '추석'], ['부모님 명절 선물 추천해줘', '명절'],
    ['친구 생일 선물 추천해줘', '생일'], ['아버지 생신 선물 추천해줘', '생신'], ['교수님 스승의 날 선물 추천해줘', '스승의 날'],
    ['교수님 스승의날 선물 추천해줘', '스승의 날'], ['부모님 어버이날 선물 추천해줘', '어버이날'], ['친구 크리스마스 선물 추천해줘', '크리스마스'],
    ['부모님 기념일 선물 추천해줘', '기념일'], ['친구 생일선물 3만원 추천', '생일'], ['추석에 어머니 선물 추천해줘', '추석'],
  ];
  for (const [text, occasion] of cases) {
    const out = await d.interpret({ text, state: state() });
    assert.equal(out.unresolved, false, text);
    assert.equal(out.patch.occasion, occasion, text);
  }
  assert.equal((await d.interpret({ text: '부모님 추석 명절 선물 추천해줘', state: state() })).patch.occasion, '추석', '추석 명절 = 추석');
  for (const text of ['부모님 설명 선물 추천해줘', '부모님 추석 그리고 생일 선물 추천해줘']) {
    const out = await d.interpret({ text, state: state() });
    assert.equal(out.unresolved, true, text);
  }
  // without an occasion the rule path is exactly parseRules (AC16 unchanged)
  const plain = await d.interpret({ text: '부모님 선물 추천해줘', state: state() });
  assert.deepEqual(plain.patch, parseRules('부모님 선물 추천해줘').patch);
});

test('DIALOGUE_LLM_TIMEOUT_MS: default 8000, env override, garbage ignored', async () => {
  assert.equal(dialogueTimeoutMs({}), 8000);
  assert.equal(dialogueTimeoutMs({ DIALOGUE_LLM_TIMEOUT_MS: '12000' }), 12000);
  for (const bad of ['', 'abc', '0', '-5', '1.5']) assert.equal(dialogueTimeoutMs({ DIALOGUE_LLM_TIMEOUT_MS: bad }), 8000);
  const { llm, d } = dlg(s1Reply(), { timeoutMs: 1234 });
  await d.interpret({ text: S1, state: state() });
  assert.equal(llm.calls[0].timeoutMs, 1234);
});

test('LLM timeout asks to resend; other LLM failures keep the fallback question', async () => {
  const run = async err => createDialogue({ llm: createFakeLlm({ json: [err] }) }).interpret({ text: S1, state: state() });
  const timeout = await run(new LlmError('llm_timeout'));
  assert.deepEqual([timeout.unresolved, timeout.questions, timeout.patch], [true, ['잠시 후 다시 보내 주세요.'], {}]);
  assert.equal(TIMEOUT_TEXT, '잠시 후 다시 보내 주세요.');
  for (const code of ['llm_schema', 'llm_http', 'llm_network', 'llm_parse']) assert.deepEqual((await run(new LlmError(code))).questions, [FALLBACK_QUESTION]);
});

test('short multi-turn answers resolve by rules with no LLM call (2개 · 개당 · 포함해서 · 네)', async () => {
  const cases = [
    ['부모님 추석 선물 2개 개당 5만원 이하', state(), { recipients: ['부모님'], occasion: '추석', quantity: 2, budget: { amount_krw: 50000, scope: 'per_set' } }],
    ['배송비 포함해서', state(), { budget: { shipping_included: true } }],
    ['포함해서', state(), { budget: { shipping_included: true } }],
    ['배송비 별도로', state(), { budget: { shipping_included: false } }],
    ['2세트', state(), { quantity: 2 }],
    ['2개', state(), { quantity: 2 }],
    ['개당 5만원 이하 배송비 포함해서', state(), { budget: { amount_krw: 50000, scope: 'per_set', shipping_included: true } }],
    ['네', state({ quantity: 2 }), { same_product: true }],
  ];
  for (const [text, st, patch] of cases) {
    const { llm, d } = dlg();
    const out = await d.interpret({ text, state: st });
    assert.equal(llm.calls.length, 0, text);
    assert.equal(out.unresolved, false, text);
    assert.deepEqual(out.patch, patch, text);
  }
});

test('short answers never swallow the rest: "네" without a pending question and unknown leftovers still go on', async () => {
  const { llm, d } = dlg(undefined);
  const yes = await d.interpret({ text: '네', state: state() });
  assert.equal(yes.unresolved, true); // nothing to confirm: LLM path (no queued answer -> fallback question)
  const left = await d.interpret({ text: '2개 센스 있는 걸로', state: state() });
  assert.equal(left.unresolved, true);
  assert.equal(llm.calls.length, 2);
});
