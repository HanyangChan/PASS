import test from 'node:test';
import assert from 'node:assert/strict';
import { initial } from '../../../src/vendor/engine.mjs';
import { attribute, attributeRules } from '../attribute.mjs';
import { fromItems } from '../gemini.mjs';
import { createAgent } from '../index.mjs';
import { createSession } from '../../../src/index.mjs';
import { products } from '../../../examples/catalog.mjs';

const mother = () => ({ ...initial(), recipients: ['어머니'] });
const held = (r, holder) => r.items.filter(i => i.holder === holder).map(i => i.value);

test('the giver\'s own taste is reported but never applied', () => {
  const r = attributeRules('나는 커피 좋아하는데 엄마는 차를 좋아해', initial());
  assert.deepEqual(r.patch.recipients, ['어머니']);
  assert.deepEqual(held(r, 'giver'), ['category:coffee_tea']);
  assert.deepEqual(held(r, 'recipient'), ['category:coffee_tea']);
  const mine = attributeRules('저는 과자 좋아해요', mother());
  assert.deepEqual(mine.patch, {});
  assert.equal(mine.items[0].applied, false);
});

test('another named person\'s taste does not leak into the gift', () => {
  const r = attributeRules('친구는 향수 좋아하는데 엄마는 건강식품이 좋대', mother());
  assert.deepEqual(r.patch.preferences, ['category:health']);
  assert.deepEqual(held(r, 'other'), ['category:beauty']);
});

test('the recipient\'s allergy carries to the next clause and is applied', () => {
  const r = attributeRules('엄마는 견과류 알레르기가 있고 과일을 좋아하셔', initial());
  assert.deepEqual(r.patch.excluded_ingredients, ['견과류']);
  assert.deepEqual(r.patch.preferences, ['category:food']);
});

test('an allergy with an unclear owner asks instead of guessing', () => {
  const r = attributeRules('아빠랑 엄마 중에 한 분이 견과류 알레르기야', mother());
  assert.equal(r.unresolved, true);
  assert.match(r.questions[0], /견과류 알레르기는 누구/);
  assert.deepEqual(r.patch, {});
});

test('negated statements are not read as a preference and go to the LLM', async () => {
  const r = attributeRules('엄마가 요즘 무릎이 안 좋으셔서 운동은 못 하셔', mother());
  assert.equal(r.patch.preferences, undefined);
  assert.equal(r.needsLlm, true);
  let calls = 0;
  const llm = async ({ state }) => { calls++; return fromItems({ items: [{ holder: 'recipient', person: '어머니', field: 'exclude_category', category: 'fitness' }], question: null }, state); };
  const out = await attribute({ text: '엄마가 요즘 무릎이 안 좋으셔서 운동은 못 하셔', state: mother(), llm });
  assert.equal(calls, 1);
  assert.deepEqual(out.patch.excluded_categories, ['fitness']);
});

test('without an LLM an unknown request asks and changes nothing', async () => {
  const out = await attribute({ text: '센스 있는 선물로 골라줘', state: mother() });
  assert.equal(out.unresolved, true);
  assert.deepEqual(out.patch, {});
  assert.equal(out.llmCalls, 0);
});

test('a failing LLM asks instead of failing the turn and changes nothing', async () => {
  const out = await attribute({ text: '센스 있는 선물로 골라줘', state: mother(), llm: async () => { throw new Error('gemini_http_429'); } });
  assert.equal(out.unresolved, true);
  assert.equal(out.provider, 'llm_failed');
  assert.deepEqual(out.patch, {});
});

test('LLM items outside the allowed values are dropped', () => {
  const out = fromItems({ items: [
    { holder: 'recipient', person: null, field: 'preference_category', category: 'cars' },
    { holder: 'giver', person: null, field: 'preference_category', category: 'snack' },
    { holder: 'unclear', person: null, field: 'exclude_ingredient', ingredient: '우유' },
  ], question: null }, mother());
  assert.deepEqual(out.patch, {});
  assert.equal(out.unresolved, true);
});

test('the C agent applies the recipient patch through the common core', async () => {
  const agent = createAgent();
  const first = await agent.runTurn({ session: createSession('c'), products, request: { kind: 'patch', expectedVersion: 0, patch: { recipients: ['어머니'], quantity: 1, same_product: true, budget: { amount_krw: 50000, scope: 'per_set', shipping_included: true } } } });
  const out = await agent.runTurn({ session: first.session, products, request: { kind: 'message', expectedVersion: first.session.version, text: '나는 과자 좋아하는데 엄마는 견과류 알레르기가 있어' } });
  assert.equal(out.kind, 'recommendation');
  assert.deepEqual(out.session.state.excluded_ingredients, ['견과류']);
  assert.deepEqual(out.session.state.preferences, []);
  assert.ok(out.result.cards.every(c => c.id !== 'snack'));
});

test('the DeepSeek attributor sends the schema prompt and maps its JSON like Gemini', async () => {
  const { createDeepSeekAttributor } = await import('../deepseek.mjs');
  let sent;
  const fetcher = async (url, options) => {
    sent = { url, auth: options.headers.Authorization, body: JSON.parse(options.body) };
    return Response.json({ choices: [{ message: { content: JSON.stringify({ items: [
      { holder: 'recipient', person: '어머니', field: 'preference_category', category: 'beauty', ingredient: null, amount_krw: null, date: null },
      { holder: 'giver', person: null, field: 'preference_category', category: 'snack', ingredient: null, amount_krw: null, date: null },
    ], question: null }) } }] });
  };
  const llm = createDeepSeekAttributor({ apiKey: 'k', baseUrl: 'https://proxy.example/v1', fetcher });
  const out = await attribute({ text: '어머니는 피부 관리에 관심이 많으셔', state: mother(), llm });
  assert.equal(sent.url, 'https://proxy.example/v1/chat/completions');
  assert.equal(sent.auth, 'Bearer k');
  assert.equal(sent.body.response_format.type, 'json_object');
  assert.deepEqual(sent.body.reasoning, { enabled: false });
  assert.deepEqual(out.patch.preferences, ['category:beauty']);
  assert.equal(out.items.find(i => i.holder === 'recipient').person, '어머니');
  const failing = createDeepSeekAttributor({ apiKey: 'k', fetcher: async () => new Response('{"error":"bad key k"}', { status: 401 }) });
  const failed = await attribute({ text: '센스 있는 선물로 골라줘', state: mother(), llm: failing });
  assert.equal(failed.provider, 'llm_failed');
});
