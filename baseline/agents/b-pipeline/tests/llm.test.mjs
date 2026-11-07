import test from 'node:test';
import assert from 'node:assert/strict';
import { createLlm, createFakeLlm, LlmError } from '../llm/index.mjs';
import { toResponseSchema } from '../llm/gemini.mjs';
import { chatUrl } from '../llm/openai-compatible.mjs';

const KEY = 'test-key-not-real';
const schema = { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } };
const fakeFetch = (reply, record = []) => async (url, init) => {
  record.push({ url, init });
  if (reply instanceof Error) throw reply;
  return { ok: reply.status ? reply.status < 400 : true, status: reply.status ?? 200, json: async () => reply.body };
};

test('no provider, empty strings or missing key/model -> null (rules/templates only)', () => {
  assert.equal(createLlm({ env: {} }), null);
  assert.equal(createLlm({ env: { LLM_PROVIDER: '' } }), null);
  assert.equal(createLlm({ env: { LLM_PROVIDER: '  ' } }), null);
  assert.equal(createLlm({ env: { LLM_PROVIDER: 'gemini', GEMINI_API_KEY: '', GEMINI_MODEL: 'm' } }), null);
  assert.equal(createLlm({ env: { LLM_PROVIDER: 'gemini', GEMINI_API_KEY: KEY, GEMINI_MODEL: '' } }), null);
  assert.equal(createLlm({ env: { LLM_PROVIDER: 'openai-compatible', LLM_BASE_URL: 'https://x', LLM_API_KEY: KEY, LLM_MODEL: '' } }), null);
  assert.throws(() => createLlm({ env: { LLM_PROVIDER: 'other' } }), RangeError);
});

test('fake LLM returns queued values, records calls, throws queued errors and checks schema', async () => {
  const llm = createFakeLlm({ json: [{ ok: true }, call => ({ ok: call.input.n === 1 }), new LlmError('llm_timeout'), { ok: 'no' }] });
  assert.deepEqual(await llm.json({ system: 's', input: { n: 0 }, schema }), { ok: true });
  assert.deepEqual(await llm.json({ system: 's', input: { n: 1 }, schema }), { ok: true });
  await assert.rejects(llm.json({ system: 's', input: {}, schema }), { code: 'llm_timeout' });
  await assert.rejects(llm.json({ system: 's', input: {}, schema }), { code: 'llm_schema' });
  await assert.rejects(llm.json({ system: 's', input: {}, schema }), { code: 'llm_fake_exhausted' });
  assert.equal(llm.calls.length, 5);
  assert.equal(await llm.embed(['a']), null);
  assert.equal(llm.canEmbed, false);
});

test('gemini adapter: key in header (not URL), JSON mode, usage callback without text', async () => {
  const record = [], usage = [];
  const llm = createLlm({
    env: { LLM_PROVIDER: 'gemini', GEMINI_API_KEY: KEY, GEMINI_MODEL: 'model-a', GEMINI_EMBED_MODEL: 'embed-a' },
    fetcher: fakeFetch({ body: { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 } } }, record),
    onUsage: u => usage.push(u),
  });
  assert.deepEqual(await llm.json({ system: 'sys', input: { a: 1 }, schema, role: 'dialogue' }), { ok: true });
  const { url, init } = record[0];
  assert.match(url, /models\/model-a:generateContent$/);
  assert.ok(!url.includes(KEY));
  assert.equal(init.headers['x-goog-api-key'], KEY);
  const body = JSON.parse(init.body);
  assert.equal(body.generationConfig.responseMimeType, 'application/json');
  assert.equal(body.contents[0].parts[0].text, '{"a":1}');
  assert.deepEqual(Object.keys(usage[0]).sort(), ['inputTokens', 'latencyMs', 'model', 'ok', 'outputTokens', 'provider', 'role']);
  assert.equal(usage[0].ok, true);
  assert.ok(!JSON.stringify(usage).includes(KEY));
});

test('gemini embed: one call per text; null without embed model', async () => {
  const record = [];
  const llm = createLlm({ env: { LLM_PROVIDER: 'gemini', GEMINI_API_KEY: KEY, GEMINI_MODEL: 'm', GEMINI_EMBED_MODEL: 'e' }, fetcher: fakeFetch({ body: { embedding: { values: [0.1, 0.2] } } }, record) });
  assert.deepEqual(await llm.embed(['가', '나']), [[0.1, 0.2], [0.1, 0.2]]);
  assert.equal(record.length, 2);
  assert.match(record[0].url, /models\/e:embedContent$/);
  const noEmbed = createLlm({ env: { LLM_PROVIDER: 'gemini', GEMINI_API_KEY: KEY, GEMINI_MODEL: 'm' }, fetcher: fakeFetch({ body: {} }) });
  assert.equal(noEmbed.canEmbed, false);
  assert.equal(await noEmbed.embed(['가']), null);
});

test('openai-compatible adapter: bearer auth, chat URL, no embeddings', async () => {
  const record = [];
  const llm = createLlm({
    env: { LLM_PROVIDER: 'openai-compatible', LLM_BASE_URL: 'https://llm.example/', LLM_API_KEY: KEY, LLM_MODEL: 'chat-a' },
    fetcher: fakeFetch({ body: { choices: [{ message: { content: '```json\n{"ok":false}\n```' } }], usage: { prompt_tokens: 3, completion_tokens: 1 } } }, record),
  });
  assert.deepEqual(await llm.json({ system: 'sys', input: {}, schema }), { ok: false });
  assert.equal(record[0].url, 'https://llm.example/v1/chat/completions');
  assert.equal(record[0].init.headers.authorization, `Bearer ${KEY}`);
  assert.equal(JSON.parse(record[0].init.body).model, 'chat-a');
  assert.equal(chatUrl('https://llm.example/v1'), 'https://llm.example/v1/chat/completions');
  assert.equal(await llm.embed(['x']), null);
});

test('adapter failures map to codes that never contain the key', async () => {
  const env = { LLM_PROVIDER: 'gemini', GEMINI_API_KEY: KEY, GEMINI_MODEL: 'm' };
  const cases = [
    [fakeFetch({ status: 500, body: {} }), 'llm_http'],
    [fakeFetch(new TypeError('fetch failed')), 'llm_network'],
    [fakeFetch({ body: { candidates: [{ content: { parts: [{ text: 'not json' }] } }] } }), 'llm_parse'],
    [fakeFetch({ body: { candidates: [{ content: { parts: [{ text: '{"ok":1}' }] } }] } }), 'llm_schema'],
    [(url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))), 'llm_timeout'],
  ];
  for (const [fetcher, code] of cases) {
    const usage = [];
    const llm = createLlm({ env, fetcher, onUsage: u => usage.push(u) });
    await assert.rejects(llm.json({ system: 's', input: {}, schema, timeoutMs: 20 }), e => e.code === code && !e.message.includes(KEY));
    assert.equal(usage[0].ok, false);
  }
});

test('gemini request carries the response schema (supported keywords only) and turns thinking off', async () => {
  const record = [];
  const big = { type: 'object', required: ['a'], properties: { a: { type: 'string', maxLength: 5 }, b: { type: 'array', maxItems: 2, items: { type: 'integer' } }, c: { type: 'string', enum: ['x'] } } };
  const llm = createLlm({ env: { LLM_PROVIDER: 'gemini', GEMINI_API_KEY: KEY, GEMINI_MODEL: 'model-a' }, fetcher: fakeFetch({ body: { candidates: [{ content: { parts: [{ text: '{"a":"z"}' }] } }] } }, record) });
  await llm.json({ system: 's', input: {}, schema: big });
  const cfg = JSON.parse(record[0].init.body).generationConfig;
  assert.equal(cfg.responseMimeType, 'application/json');
  assert.deepEqual(cfg.responseJsonSchema, { type: 'object', required: ['a'], properties: { a: { type: 'string' }, b: { type: 'array', maxItems: 2, items: { type: 'integer' } }, c: { type: 'string', enum: ['x'] } } });
  assert.deepEqual(cfg.thinkingConfig, { thinkingBudget: 0 });
  assert.deepEqual(toResponseSchema(undefined), undefined);
});

test('gemini: a model that rejects thinkingConfig (HTTP 400) is retried once without it, then remembered', async () => {
  const bodies = [];
  const fetcher = async (url, init) => {
    const cfg = JSON.parse(init.body).generationConfig;
    bodies.push(cfg);
    if (cfg.thinkingConfig) return { ok: false, status: 400, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }) };
  };
  const llm = createLlm({ env: { LLM_PROVIDER: 'gemini', GEMINI_API_KEY: KEY, GEMINI_MODEL: 'm' }, fetcher });
  assert.deepEqual(await llm.json({ system: 's', input: {}, schema }), { ok: true });
  assert.deepEqual(await llm.json({ system: 's', input: {}, schema }), { ok: true });
  assert.deepEqual(bodies.map(b => Boolean(b.thinkingConfig)), [true, false, false]);
});

test('onError reports role + code + schema path only (no key, no text); llm_schema names the field', async () => {
  const lines = [];
  const llm = createLlm({
    env: { LLM_PROVIDER: 'gemini', GEMINI_API_KEY: KEY, GEMINI_MODEL: 'm' },
    fetcher: fakeFetch({ body: { candidates: [{ content: { parts: [{ text: '{"wrong":1}' }] } }] } }),
    onError: e => lines.push(e),
  });
  await assert.rejects(llm.json({ system: 's', input: { secret: '원문' }, schema, role: 'dialogue' }), { code: 'llm_schema' });
  assert.deepEqual(lines, [{ role: 'dialogue', code: 'llm_schema', detail: '$ missing ok' }]);
  assert.ok(!JSON.stringify(lines).includes(KEY) && !JSON.stringify(lines).includes('원문'));
});
