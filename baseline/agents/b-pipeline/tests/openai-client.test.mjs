// K72: one OpenAI-compatible generation client for llmTurn (① + L1 memory), the explainer (④) and the common port.
// json_object + schema in the prompt + validation; content only (reasoning_content ignored); LLM_REASONING;
// HTTP status -> main's failure codes. Fake fetchers only: no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createLlm, llmProvider, LlmError } from '../llm/index.mjs';
import { createOpenAiCompatible, failureCode, jsonSystem, reasoningMode } from '../llm/openai-compatible.mjs';
import { llmTurn, geminiFailure, GeminiError } from '../proto/lib/llm.mjs';
import { singleInitial } from '../proto/lib/single-gift.mjs';
import { createPipeline } from '../pipeline/index.mjs';
import { createExplainer } from '../explainer/agent.mjs';
import { dialogueLlmFrom } from '../server/index.mjs';
import { products } from './fixtures/catalog.mjs';
import { stores } from './fixtures/people.mjs';
import { fakeOpenAi, protoState, REASONING_SECRET } from './fixtures/proto-llm.mjs';

const KEY = 'test-key-not-real';
const ENV = { LLM_BASE_URL: 'https://llm.example/v1', LLM_API_KEY: KEY, LLM_MODEL: 'deepseek-test' };
const schema = { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } };
const reply = (content, extra = {}) => async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content, reasoning_content: REASONING_SECRET, ...extra } }], usage: { prompt_tokens: 3, completion_tokens: 2, completion_tokens_details: { reasoning_tokens: 7 } } }) });
const status = (code, text = '') => async () => ({ ok: false, status: code, text: async () => text, json: async () => ({}) });

test('provider: LLM_PROVIDER wins; else LLM_API_KEY -> openai-compatible; else GEMINI_API_KEY -> gemini (K71); else none', () => {
  assert.equal(llmProvider({}), null);
  assert.equal(llmProvider({ LLM_API_KEY: KEY }), 'openai-compatible');
  assert.equal(llmProvider({ GEMINI_API_KEY: KEY }), 'gemini');
  assert.equal(llmProvider({ LLM_API_KEY: KEY, GEMINI_API_KEY: KEY }), 'openai-compatible');
  assert.equal(llmProvider({ LLM_PROVIDER: 'gemini', LLM_API_KEY: KEY, GEMINI_API_KEY: KEY }), 'gemini', 'LLM_PROVIDER=gemini rolls back');
  assert.equal(createLlm({ env: ENV }).provider, 'openai-compatible');
  assert.equal(createLlm({ env: { ...ENV, LLM_MODEL: '' } }), null);
  assert.equal(createLlm({ env: { ...ENV, LLM_BASE_URL: ' ' } }), null);
  assert.equal(reasoningMode(undefined), 'off');
  assert.equal(reasoningMode(' ON '), 'on');
  assert.equal(reasoningMode('nope'), 'off');
});

test('request: json_object, schema + the word "json" in the system prompt, reasoning:{enabled:false} by default', async () => {
  const record = [];
  const llm = createLlm({ env: ENV, fetcher: async (url, init) => { record.push({ url, init }); return reply('{"ok":true}')(); } });
  assert.deepEqual(await llm.json({ system: '규칙', input: { a: 1 }, schema }), { ok: true });
  const body = JSON.parse(record[0].init.body);
  assert.equal(record[0].url, 'https://llm.example/v1/chat/completions');
  assert.equal(record[0].init.headers.authorization, `Bearer ${KEY}`);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.model, 'deepseek-test');
  assert.deepEqual(body.reasoning, { enabled: false });
  assert.match(body.messages[0].content, /^규칙/);
  assert.match(body.messages[0].content, /json/);
  assert.ok(body.messages[0].content.includes(JSON.stringify(schema)));
  assert.equal(body.messages[1].content, '{"a":1}');
  assert.equal(body.response_format.json_schema, undefined, 'no Gemini-style schema field');
  assert.ok(!record[0].url.includes(KEY));
});

test('LLM_REASONING=on leaves the reasoning field out', async () => {
  const record = [];
  const llm = createLlm({ env: { ...ENV, LLM_REASONING: 'on' }, fetcher: async (url, init) => { record.push(init); return reply('{"ok":true}')(); } });
  await llm.json({ system: 's', input: {}, schema });
  assert.equal(Object.hasOwn(JSON.parse(record[0].body), 'reasoning'), false);
  assert.equal(llm.reasoning, 'on');
});

test('only message.content is parsed; reasoning_content / provider_specific_fields never reach the result, usage or errors', async () => {
  const usage = [], errors = [];
  const ok = createLlm({ env: ENV, fetcher: reply('{"ok":true}', { provider_specific_fields: { x: REASONING_SECRET } }), onUsage: u => usage.push(u), onError: e => errors.push(e) });
  const out = await ok.json({ system: 's', input: {}, schema, role: 'explainer' });
  assert.deepEqual(out, { ok: true });
  assert.deepEqual(usage[0], { provider: 'openai-compatible', role: 'explainer', model: 'deepseek-test', inputTokens: 3, outputTokens: 2, reasoningTokens: 7, latencyMs: usage[0].latencyMs, ok: true });
  // content missing (reasoning only) is a parse failure, not a fallback to reasoning_content
  const onlyReasoning = createLlm({ env: ENV, fetcher: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: null, reasoning_content: '{"ok":true}' } }] }) }), onUsage: u => usage.push(u), onError: e => errors.push(e) });
  await assert.rejects(onlyReasoning.json({ system: 's', input: {}, schema }), { code: 'llm_parse' });
  assert.ok(!JSON.stringify({ usage, errors }).includes(REASONING_SECRET));
});

test('answers are validated: schema mismatch and a failing validate() are llm_schema', async () => {
  const llm = createLlm({ env: ENV, fetcher: reply('{"ok":"yes"}') });
  await assert.rejects(llm.json({ system: 's', input: {}, schema }), { code: 'llm_schema' });
  const strict = createLlm({ env: ENV, fetcher: reply('{"ok":true,"extra":1}') });
  await assert.rejects(strict.json({ system: 's', input: {}, schema, validate: v => { if (Object.keys(v).length > 1) throw Error('x'); } }), { code: 'llm_schema' });
});

test('a server that rejects the reasoning field is a configuration error: no retry without it', async () => {
  const calls = [], lines = [];
  const llm = createLlm({ env: ENV, fetcher: async (...a) => { calls.push(a); return status(400, '{"error":{"message":"Unrecognized request argument: reasoning"}}')(); }, onError: e => lines.push(e) });
  await assert.rejects(llm.json({ system: 's', input: {}, schema, role: 'dialogue' }), e => e.code === 'llm_config' && e.detail === 'reasoning');
  assert.equal(calls.length, 1, 'not retried');
  assert.deepEqual(lines, [{ role: 'dialogue', code: 'llm_config', detail: 'reasoning' }]);
  assert.equal(failureCode(new LlmError('llm_config', 'reasoning')), 'request_rejected');
  // a 400 that does not name the field stays an HTTP error; with LLM_REASONING=on the body is not inspected at all
  await assert.rejects(createLlm({ env: ENV, fetcher: status(400, 'bad json') }).json({ system: 's', input: {}, schema }), { code: 'llm_http', detail: '400' });
  await assert.rejects(createLlm({ env: { ...ENV, LLM_REASONING: 'on' }, fetcher: status(400, 'reasoning') }).json({ system: 's', input: {}, schema }), { code: 'llm_http' });
});

test('HTTP status / timeout / network / parse -> main failure codes (trace names unchanged)', async () => {
  const cases = [[401, 'auth_failed'], [403, 'auth_failed'], [429, 'quota_exceeded'], [404, 'model_not_found'], [500, 'provider_unavailable'], [502, 'provider_unavailable'], [503, 'provider_unavailable'], [400, 'request_rejected'], [422, 'request_rejected']];
  for (const [code, want] of cases) {
    const e = await createLlm({ env: ENV, fetcher: status(code) }).json({ system: 's', input: {}, schema }).catch(x => x);
    assert.equal(failureCode(e), want, String(code));
    assert.ok(!e.message.includes(KEY));
  }
  const hang = (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  assert.equal(failureCode(await createLlm({ env: ENV, fetcher: hang }).json({ system: 's', input: {}, schema, timeoutMs: 20 }).catch(x => x)), 'timeout');
  assert.equal(failureCode(await createLlm({ env: ENV, fetcher: async () => { throw new TypeError('fetch failed'); } }).json({ system: 's', input: {}, schema }).catch(x => x)), 'provider_unavailable');
  assert.equal(failureCode(await createLlm({ env: ENV, fetcher: reply('not json') }).json({ system: 's', input: {}, schema }).catch(x => x)), 'invalid_response');
  // geminiFailure keeps main's messages for these codes
  assert.match(geminiFailure(new GeminiError('quota_exceeded', 429)).error, /사용 한도/);
});

test('embeddings are untouched: openai-compatible has none (keyword search), gemini still embeds', async () => {
  const llm = createLlm({ env: ENV, fetcher: reply('{}') });
  assert.equal(llm.canEmbed, false);
  assert.equal(await llm.embed(['x']), null);
});

test('llmTurn through generate: same instructions + schema in the prompt, memory candidates, allergy union, validation', async () => {
  const input = { state: { ...singleInitial(), excluded_ingredients: ['땅콩'] }, issues: [], text: '엄마 추석 선물 5만원', history: [], source: 'typed' };
  const f = fakeOpenAi([{ state: protoState({ recipients: ['어머니'], occasion: '추석', budget: { amount_krw: 50000 } }), memory: [{ recipient: '엄마', key: 'pref:less_sweet', polarity: 1, evidence: '엄마' }] }]);
  const out = await llmTurn(input, products, f.llm);
  const body = f.calls[0].body;
  assert.match(body.messages[0].content, /You extract Korean gift preferences/);
  assert.match(body.messages[0].content, /"memory"/, 'extraction schema (with L1 memory) is in the prompt');
  assert.deepEqual(f.calls[0].input.text, '엄마 추석 선물 5만원');
  assert.deepEqual(out.session.state.recipients, ['어머니']);
  assert.equal(out.session.state.budget.amount_krw, 50000);
  assert.deepEqual(out.session.state.excluded_ingredients, ['땅콩'], 'an omitted allergy is kept');
  assert.equal(out.memory.length, 1);
  assert.equal(f.usage[0].role, 'dialogue');
  // main-shaped answer without memory still passes; a state outside the schema is rejected
  assert.deepEqual((await llmTurn(input, products, fakeOpenAi([{ state: protoState() }]).llm)).memory, []);
  await assert.rejects(llmTurn(input, products, fakeOpenAi([{ state: { ...protoState(), packaging: 'gold' } }]).llm));
});

for (const [name, make] of Object.entries(stores)) {
  test(`[${name}] pipeline: an LLM HTTP 429 is main's quota message with code quota_exceeded; nothing saved`, async () => {
    const store = make();
    const f = fakeOpenAi([{ status: 429 }]);
    const pipe = createPipeline({ store, products, dialogueLlm: f.llm, explain: null, now: () => '2026-09-20T03:00:00.000Z' });
    const out = await pipe.runPipelineTurn({ ownerId: 'userA', sessionId: 's', request: { kind: 'message', text: '엄마 추석 선물 5만원' } });
    const q = out.events.find(e => e.type === 'question');
    assert.equal(q.code, 'quota_exceeded');
    assert.match(q.question, /조건은 바뀌지 않았어요\.$/);
    assert.equal(await store.getSession('userA', 's'), null);
    assert.ok(!JSON.stringify(out).includes(REASONING_SECRET));
  });

  test(`[${name}] pipeline: a reasoning-field rejection is reported as a configuration error (request_rejected), one call`, async () => {
    const f = fakeOpenAi([{ status: 400, text: 'unknown field reasoning' }]);
    const pipe = createPipeline({ store: make(), products, dialogueLlm: f.llm, explain: null, now: () => '2026-09-20T03:00:00.000Z' });
    const out = await pipe.runPipelineTurn({ ownerId: 'userA', sessionId: 's', request: { kind: 'message', text: '엄마 추석 선물 5만원' } });
    assert.equal(out.events.find(e => e.type === 'question').code, 'request_rejected');
    assert.equal(f.calls.length, 1);
  });

  test(`[${name}] pipeline: a valid answer gives cards; reasoning_content never appears in events`, async () => {
    const f = fakeOpenAi([{ state: protoState({ recipients: ['어머니'], occasion: '추석', budget: { amount_krw: 50000, shipping_included: true } }) }]);
    const pipe = createPipeline({ store: make(), products, dialogueLlm: f.llm, explain: null, now: () => '2026-09-20T03:00:00.000Z' });
    const out = await pipe.runPipelineTurn({ ownerId: 'userA', sessionId: 's', request: { kind: 'message', text: '엄마 추석 선물 5만원 배송비 포함' } });
    assert.ok(out.events.some(e => e.type === 'cards'));
    assert.ok(!JSON.stringify(out).includes(REASONING_SECRET));
  });
}

test('explainer uses the same client (role explainer, json_object)', async () => {
  const record = [];
  const llm = createLlm({ env: ENV, fetcher: async (url, init) => { record.push(JSON.parse(init.body)); return reply('{"items":[{"id":"a","tags":["x","y"]}]}')(); } });
  const explain = createExplainer({ llm });
  const out = await explain({ factsheet: { items: [] }, draft: null });
  assert.equal(out.items[0].id, 'a');
  assert.deepEqual(record[0].response_format, { type: 'json_object' });
  assert.match(record[0].messages[0].content, /json/);
});

test('server: LLM_API_KEY turns the dialogue on through the shared client; LLM_PROVIDER=gemini keeps the Gemini path', async () => {
  assert.equal(dialogueLlmFrom({ LLM_API_KEY: KEY }), null, 'no base URL / model -> rules');
  const shared = createOpenAiCompatible({ baseUrl: 'https://llm.example', apiKey: KEY, model: 'm', fetcher: reply('{"ok":true}') });
  const d = dialogueLlmFrom({ ...ENV, DIALOGUE_LLM_TIMEOUT_MS: '9000' }, { llm: shared });
  assert.deepEqual(Object.keys(d).sort(), ['generate', 'timeoutMs']);
  assert.equal(d.timeoutMs, 9000);
  assert.deepEqual(await d.generate({ system: 's', input: {}, schema }), { ok: true });
  assert.ok(typeof dialogueLlmFrom(ENV).generate === 'function', 'a client is made from env when none is given');
  const g = dialogueLlmFrom({ ...ENV, LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gm' });
  assert.deepEqual({ ...g, apiKey: '*' }, { apiKey: '*', model: 'gm', thinkingBudget: 0 });
  assert.ok(jsonSystem('a', null).includes('json'));
});
