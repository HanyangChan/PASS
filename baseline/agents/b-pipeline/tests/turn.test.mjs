// P8: ① is main's prototype chatbot (proto fastRuleTurn -> llmTurn -> singleTurn) in front of ② ③ merge runTurn planner.
// Multi-turn short answers, pending questions + history, recipient switch, allergy protection, memory fill timing,
// L1 memory candidates, L2 timeout/thinking, LLM failure. Fake Gemini fetcher and in-memory/SQLite stores only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipeline } from '../pipeline/index.mjs';
import { llmTurn, geminiFailure } from '../proto/lib/llm.mjs';
import { singleInitial } from '../proto/lib/single-gift.mjs';
import { recommendationView } from '../proto/api/worker.mjs';
import { dialogueLlmFrom } from '../server/index.mjs';
import { products } from './fixtures/catalog.mjs';
import { stores, seedPeople, seedS1Memories } from './fixtures/people.mjs';
import { fakeGemini, protoState } from './fixtures/proto-llm.mjs';

const S1 = '추석 선물이야. 엄마는 단 거 싫어하시고 땅콩 알레르기, 아빠는 등산 좋아하셔. 5만 원';
const S1_REPLY = {
  state: protoState({ recipients: ['어머니', '아버지'], occasion: '추석', budget: { amount_krw: 50000 }, preferences: ['less_sweet'], excluded_ingredients: ['땅콩'] }),
  memory: [
    { recipient: '엄마', key: 'pref:less_sweet', polarity: 1, evidence: '엄마는 단 거 싫어하시고' },
    { recipient: '엄마', key: 'allergy:땅콩', polarity: -1, evidence: '땅콩 알레르기' },
    { recipient: '아빠', key: 'hobby:등산', polarity: 1, evidence: '아빠는 등산 좋아하셔' },
  ],
};
const MOM = '어머니 한 세트 세트당 예산 5만원 이하 배송비 포함 추천';
const PARENTS = '부모님 한 세트 세트당 예산 5만원 이하 배송비 포함 추천';
const ev = (r, type) => r.events.find(e => e.type === type);
const types = r => r.events.map(e => e.type);

function setup(make, replies) {
  const store = make();
  const dialogue = replies ? fakeGemini(replies) : null;
  const pipe = createPipeline({ store, products, dialogueLlm: dialogue?.llm ?? null, explain: null, now: () => '2026-09-20T03:00:00.000Z' });
  const turn = (text, extra = {}) => pipe.runPipelineTurn({ ownerId: 'userA', sessionId: 's', request: { kind: 'message', text, ...extra } });
  const row = () => store.getSession('userA', 's');
  return { store, pipe, turn, row, dialogue };
}

for (const [name, make] of Object.entries(stores)) {
  test(`[${name}] short answer "아니" to main's shipping question is solved by fastRuleTurn: no LLM call`, async () => {
    const { turn, row, dialogue } = setup(make, [S1_REPLY]);
    assert.equal(ev(await turn(S1), 'question').question, '예산에 배송비도 포함할까요?');
    const out = await turn('아니');
    assert.deepEqual(types(out), ['cards', 'explanations']);
    assert.equal(dialogue.calls.length, 1, 'only S1 went to the LLM');
    const state = (await row()).session.state;
    assert.equal(state.budget.shipping_included, false);
    assert.deepEqual([state.quantity, state.same_product, state.budget.scope], [1, true, 'per_set'], 'engineState: one gift');
    assert.ok(!ev(out, 'cards').result.cards.some(c => c.id === 'peanut-gangjeong'), 'AC7');
  });

  test(`[${name}] a pending question and the client's history go to the next llmTurn; the answer closes it`, async () => {
    const ASK = '어떤 성분을 피해야 하나요?';
    const { turn, row, dialogue } = setup(make, [
      { state: protoState({ recipients: ['어머니'] }), question: ASK },
      input => {
        assert.deepEqual(input.issues, [ASK]);
        assert.deepEqual(input.history, [{ role: 'user', text: '엄마 선물' }, { role: 'assistant', text: ASK }]);
        return { state: { ...input.state, excluded_ingredients: ['땅콩'] }, question: null };
      },
    ]);
    const first = await turn('엄마 선물');
    assert.equal(ev(first, 'question').question, ASK, 'the LLM question is the one question');
    assert.deepEqual((await row()).meta.issues, [ASK]);
    const second = await turn('땅콩', { history: [{ role: 'user', text: '엄마 선물' }, { role: 'assistant', text: ASK }] });
    assert.equal(ev(second, 'question').question, '얼마까지 쓰고 싶으세요?', "next: main's budget question");
    assert.deepEqual(ev(second, 'question').choices, ['총 10만 원', '총 20만 원', '세트당 5만 원']);
    const r = await row();
    assert.deepEqual([r.meta.issues, r.session.state.excluded_ingredients], [[], ['땅콩']]);
    assert.equal(dialogue.calls.length, 2);
  });

  test(`[${name}] recipient switch: the previous person's tastes and allergies do not carry over; budget does (main)`, async () => {
    const { store, turn, row, dialogue } = setup(make, [input => ({ state: { ...input.state, recipients: ['친구'] } })]);
    const people = await seedPeople(store);
    await seedS1Memories(store, people);
    // the first turn uses main's rules shape through the LLM fake: send the full state
    dialogue.queue.unshift({ state: protoState({ recipients: ['어머니'], budget: { amount_krw: 50000, shipping_included: true } }) });
    await turn(MOM);
    let s = (await row()).session.state;
    assert.deepEqual([s.preferences, s.excluded_ingredients], [['less_sweet'], ['땅콩']], "② mother's memory on the first naming");
    const out = await turn('친구 선물로 바꿔줘');
    assert.deepEqual([dialogue.calls[1].input.state.recipients, dialogue.calls[1].input.state.preferences, dialogue.calls[1].input.state.excluded_ingredients], [['친구'], [], []], 'switched before ① (main switchRecipient)');
    s = (await row()).session.state;
    assert.deepEqual([s.recipients, s.preferences, s.excluded_ingredients, s.budget.amount_krw], [['친구'], [], [], 50000]);
    assert.deepEqual((await row()).meta.recipientIds, [people.friend.id]);
    assert.equal(ev(out, 'cards').banner, null);
  });

  test(`[${name}] 어머니 -> 부모님 keeps every allergy (group union), including one said only in this session`, async () => {
    const { store, turn, row } = setup(make); // main's rules (no key)
    const people = await seedPeople(store);
    await seedS1Memories(store, people);
    await turn(MOM);
    await turn('우유 알레르기도 있어');
    assert.deepEqual((await row()).session.state.excluded_ingredients.sort(), ['우유', '땅콩'].sort());
    await turn('부모님 선물로 할게');
    const s = (await row()).session.state;
    assert.deepEqual(s.recipients, ['부모님']);
    assert.deepEqual(s.excluded_ingredients.sort(), ['우유', '땅콩'].sort());
    assert.ok(s.preferences.includes('category:fitness'), "② father's hobby filled on the change");
  });

  test(`[${name}] AC7 review: in a 부모님 session, a sentence about one parent never drops a session allergy (rules and LLM)`, async () => {
    // rules: proto extract sees 어머니 and narrows the people (main switchRecipient); the allergy stays
    for (const text of ['엄마는 단 거 싫어하셔', '엄마가 땅콩 알레르기 있어']) {
      const { turn, row } = setup(make);
      await turn(PARENTS);
      await turn('우유 알레르기도 있어');
      await turn(text);
      assert.ok((await row()).session.state.excluded_ingredients.includes('우유'), text);
    }
    // LLM: the model narrows 부모님 to 어머니 and leaves the allergy out
    const { turn, row } = setup(make, [
      { state: protoState({ recipients: ['부모님'], budget: { amount_krw: 50000, shipping_included: true }, excluded_ingredients: ['우유'] }) },
      input => ({ state: { ...input.state, recipients: ['어머니'], excluded_ingredients: [] } }),
    ]);
    await turn('부모님 선물 5만원 배송비 포함, 우유 알레르기');
    await turn('어머니 쪽으로 생각해 볼게');
    assert.deepEqual((await row()).session.state.excluded_ingredients, ['우유']);
  });

  test(`[${name}] an LLM question with no condition change is kept as main's open question for the next turn`, async () => {
    const ASK = '의류는 아직 추천하지 못해요. 다른 선물을 알려주세요.';
    const { turn, row, dialogue } = setup(make, [
      { state: protoState({ recipients: ['어머니'], budget: { amount_krw: 50000, shipping_included: true } }) },
      input => ({ state: input.state, question: ASK }), input => ({ state: input.state }),
    ]);
    await turn(MOM);
    const before = await row();
    assert.equal(ev(await turn('옷 선물은?'), 'question').question, ASK);
    const after = await row();
    assert.deepEqual([after.meta.issues, after.session], [[ASK], before.session], 'meta only; state and version unchanged');
    await turn('그럼 다른 걸로');
    assert.deepEqual(dialogue.calls[2].input.issues, [ASK]);
  });

  test(`[${name}] AC7: an LLM answer that drops a remembered allergy cannot remove it; a retraction asks first`, async () => {
    const { store, turn, row } = setup(make, [
      { state: protoState({ recipients: ['어머니'], budget: { amount_krw: 50000, shipping_included: true } }) },
      input => ({ state: { ...input.state, excluded_ingredients: [] } }), // silently omitted: proto keeps it
      input => ({ state: { ...input.state, excluded_ingredients: [] } }), // retracted in words: merge keeps it and asks
    ]);
    const people = await seedPeople(store);
    const m = await seedS1Memories(store, people);
    await turn(MOM);
    await turn('5만원으로 해줘');
    assert.deepEqual((await row()).session.state.excluded_ingredients, ['땅콩']);
    const out = await turn('땅콩 알레르기 없어졌어');
    assert.deepEqual((await row()).session.state.excluded_ingredients, ['땅콩']);
    const p = ev(out, 'memory_prompt');
    assert.deepEqual([p.kind, p.memoryIds], ['allergy_release', [m.peanut.id]]);
    assert.ok(!ev(out, 'cards').result.cards.some(c => c.id === 'peanut-gangjeong'));
  });

  test(`[${name}] ② memory fills only when the people are first named: a cancelled memory value stays cancelled`, async () => {
    const { store, turn, row, pipe } = setup(make);
    const people = await seedPeople(store);
    await seedS1Memories(store, people);
    await turn(PARENTS);
    const s = (await row()).session.state;
    assert.ok(s.preferences.includes('less_sweet'));
    await pipe.runPipelineTurn({ ownerId: 'userA', sessionId: 's', request: { kind: 'patch', patch: { preferences: s.preferences.filter(p => p !== 'less_sweet') } } });
    const out = await turn('배송비 별도로 할게');
    const after = (await row()).session.state;
    assert.equal(after.budget.shipping_included, false);
    assert.ok(!after.preferences.includes('less_sweet'), 'not brought back by the next message');
    assert.ok(after.preferences.includes('category:fitness'));
    assert.deepEqual(after.excluded_ingredients, ['땅콩'], 'allergies are always protected');
    assert.equal(ev(out, 'cards').banner.text, '지난 기억을 반영했어요: 땅콩 제외 · 등산');
  });

  test(`[${name}] L1: memory candidates need the person named and the user's own words; allergies their own name`, async () => {
    const text = '엄마는 땅콩 알레르기 있고 커피 좋아하셔';
    const { turn, row } = setup(make, [{
      state: protoState({ recipients: ['어머니'], excluded_ingredients: ['땅콩'], preferences: ['category:coffee_tea'] }),
      memory: [
        { recipient: '엄마', key: 'allergy:땅콩', polarity: -1, evidence: '땅콩 알레르기' },
        { recipient: '엄마', key: 'pref:category:coffee_tea', polarity: 1, evidence: '커피 좋아하셔' },
        { recipient: '엄마', key: 'allergy:우유', polarity: -1, evidence: '커피 좋아하셔' },      // allergen not named
        { recipient: '아빠', key: 'hobby:등산', polarity: 1, evidence: '커피 좋아하셔' },        // person not named
        { recipient: '엄마', key: 'pref:less_sweet', polarity: 1, evidence: '단 거 싫어하셔' },  // not the user's words
        { recipient: '엄마', key: 'pref:비싼거', polarity: 1, evidence: '커피 좋아하셔' },       // not a memory key
      ],
    }]);
    await turn(text);
    const r = await row();
    assert.deepEqual(r.meta.pendingCandidates.map(c => [c.recipientName, c.key, c.evidence]), [['어머니', 'allergy:땅콩', '땅콩 알레르기'], ['어머니', 'pref:category:coffee_tea', '커피 좋아하셔']]);
    assert.deepEqual(r.session.state.excluded_ingredients, ['땅콩']);
  });

  test(`[${name}] LLM failure: main's message, the code, and nothing saved`, async () => {
    const { turn, row } = setup(make, [{ status: 503 }, { status: 503 }]);
    const out = await turn(S1);
    assert.deepEqual(types(out), ['question']);
    assert.match(ev(out, 'question').question, /조건은 바뀌지 않았어요\.$/);
    assert.equal(ev(out, 'question').code, 'provider_unavailable');
    assert.equal(await row(), null);
  });

  test(`[${name}] a bad history (more than 6 messages) is an invalid request`, async () => {
    const { turn } = setup(make);
    const history = Array.from({ length: 7 }, () => ({ role: 'user', text: '선물' }));
    assert.equal(ev(await turn(MOM, { history }), 'error').code, 'invalid_request');
  });

  test(`[${name}] AC1: with an LLM answer and no memory, the cards are main's recommendationView result`, async () => {
    const state = protoState({ recipients: ['친구'], budget: { amount_krw: 30000, shipping_included: true }, preferences: ['category:coffee_tea'] });
    const { turn } = setup(make, [{ state }]);
    const out = await turn('친구한테 3만원 이하 커피 선물, 배송비 포함');
    const main = recommendationView({ state, issues: [] }, products).result;
    assert.deepEqual(ev(out, 'cards').result.cards.map(c => [c.id, c.rank, c.total_krw]), main.items.map((p, i) => [p.id, i + 1, p.total]));
  });
}

test('L2: thinkingConfig is sent only when asked, and dropped once if the model rejects it (400)', async () => {
  const input = { state: singleInitial(), issues: [], text: '엄마 선물 5만원', history: [], source: 'typed' };
  const ok = { state: protoState({ recipients: ['어머니'], budget: { amount_krw: 50000 } }) };
  const plain = fakeGemini([ok]);
  await llmTurn(input, products, plain.llm);
  assert.equal(plain.calls[0].body.generationConfig.thinkingConfig, undefined, "main's request when not asked");
  const picky = fakeGemini([(_, body) => (body.generationConfig.thinkingConfig ? { status: 400 } : ok)]);
  picky.queue.push(ok);
  const out = await llmTurn(input, products, { ...picky.llm, thinkingBudget: 0 });
  assert.deepEqual(picky.calls.map(c => c.body.generationConfig.thinkingConfig ?? null), [{ thinkingBudget: 0 }, null]);
  assert.deepEqual(out.session.state.recipients, ['어머니']);
  assert.deepEqual(out.memory, [], 'L1: a main-shaped answer has no memory field and still passes');
});

test('L2: timeoutMs bounds the call and maps to main\'s timeout message', async () => {
  const input = { state: singleInitial(), issues: [], text: '엄마 선물', history: [], source: 'typed' };
  // AbortSignal.timeout does not keep the process alive: hold a timer until the abort arrives
  const hang = (url, opts) => new Promise((_, reject) => { const t = setTimeout(() => {}, 5000); opts.signal.addEventListener('abort', () => { clearTimeout(t); reject(opts.signal.reason); }); });
  const started = Date.now();
  const error = await llmTurn(input, products, { apiKey: 'fake-key-not-a-secret', fetcher: hang, timeoutMs: 20 }).catch(e => e);
  assert.ok(Date.now() - started < 2000);
  assert.equal(geminiFailure(error).code, 'timeout');
});

test('server: the dialogue LLM is on only with GEMINI_API_KEY; model and timeout come from the environment', () => {
  assert.equal(dialogueLlmFrom({}), null);
  assert.equal(dialogueLlmFrom({ GEMINI_API_KEY: '  ' }), null);
  const d = dialogueLlmFrom({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'm', DIALOGUE_LLM_TIMEOUT_MS: '9000' });
  assert.deepEqual({ ...d, apiKey: '*' }, { apiKey: '*', model: 'm', timeoutMs: 9000, thinkingBudget: 0 });
  assert.equal(dialogueLlmFrom({ GEMINI_API_KEY: 'k', DIALOGUE_LLM_TIMEOUT_MS: 'x' }).timeoutMs, undefined, "proto's 18000 default");
});
