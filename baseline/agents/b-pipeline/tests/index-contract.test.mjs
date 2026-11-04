// index.mjs keeps its public contract: interpretMessage / createAgent. Without a key the old question comes back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initial } from '../../../src/vendor/engine.mjs';
import { createSession, runTurn } from '../../../src/index.mjs';
import { interpretMessage, createAgent, llmFromEnv } from '../index.mjs';
import { createFakeLlm } from '../llm/index.mjs';
import { createDialogue, toPort } from '../dialogue/agent.mjs';
import { products } from './fixtures/catalog.mjs';

const KEYS = ['LLM_PROVIDER', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'OPENAI_COMPAT_API_KEY', 'OPENAI_COMPAT_MODEL'];
const withoutKeys = async fn => {
  const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  try { return await fn(); } finally { for (const k of KEYS) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
};

test('no key: interpretMessage returns the unresolved fallback question', () => withoutKeys(async () => {
  assert.deepEqual(await interpretMessage({ text: '센스 있는 선물', state: initial() }), {
    patch: {}, unresolved: true,
    questions: ['받는 분과 예산을 조금 더 구체적으로 알려주세요.'],
  });
}));

test('under node --test a key in the environment still creates no LLM and makes no network call', async () => {
  assert.ok(process.env.NODE_TEST_CONTEXT, 'node --test sets NODE_TEST_CONTEXT');
  const saved = Object.fromEntries([...KEYS, 'GEMINI_EMBED_MODEL'].map(k => [k, process.env[k]]));
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('network used in a test'); };
  Object.assign(process.env, { LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-not-a-key', GEMINI_MODEL: 'm' });
  try {
    assert.equal(llmFromEnv(), null);
    const out = await interpretMessage({ text: '센스 있는 선물', state: initial() });
    assert.equal(out.unresolved, true);
    const session = createSession('s');
    assert.equal((await createAgent().runTurn({ session, products, request: { kind: 'message', text: '센스 있는 선물', expectedVersion: 0 } })).kind, 'question');
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

test('outside tests (no NODE_TEST_CONTEXT) llmFromEnv builds from the given env; no key or a bad provider is null', () => {
  assert.equal(llmFromEnv({ LLM_PROVIDER: 'fake' }).provider, 'fake');
  assert.equal(llmFromEnv({ LLM_PROVIDER: 'fake', NODE_TEST_CONTEXT: 'child-v8' }), null);
  assert.equal(llmFromEnv({}), null);
  assert.equal(llmFromEnv({ LLM_PROVIDER: 'gemini', GEMINI_API_KEY: '' }), null);
  assert.equal(llmFromEnv({ LLM_PROVIDER: 'nope' }), null);
});

test('no key: createAgent() asks for clarification on free text and leaves the session unchanged', () => withoutKeys(async () => {
  const agent = createAgent();
  assert.equal(agent.id, 'b-pipeline');
  const session = createSession('s'), before = structuredClone(session);
  const out = await agent.runTurn({ session, products, request: { kind: 'message', text: '센스 있는 선물', expectedVersion: 0 } });
  assert.equal(out.kind, 'question'); assert.deepEqual(out.session, before);
}));

test('createAgent({interpret}) keeps its signature: an injected dialogue port drives the turn', async () => {
  const llm = createFakeLlm({ json: [{ recipients: ['어머니'], budget_amount_krw: 50000, budget_scope: 'per_set', shipping_included: true, quantity: 1, memoryCandidates: [] }] });
  const agent = createAgent({ interpret: toPort(createDialogue({ llm })) });
  const out = await agent.runTurn({ session: createSession('s'), products, request: { kind: 'message', text: '어머니께 센스 있는 선물 5만원 세트당 배송비 포함 한 세트', expectedVersion: 0 } });
  assert.equal(out.kind, 'recommendation');
  assert.equal(llm.calls.length, 1);
});

test('rule-resolvable messages through createAgent() never reach the LLM', async () => {
  const llm = createFakeLlm({ json: [] });
  const agent = createAgent({ interpret: toPort(createDialogue({ llm })) });
  const out = await agent.runTurn({ session: createSession('s'), products, request: { kind: 'message', text: '어머니 한 세트 세트당 예산 5만원 이하 배송비 포함 추천', expectedVersion: 0 } });
  assert.equal(out.kind, 'recommendation'); assert.equal(llm.calls.length, 0);
  const base = await runTurn({ session: createSession('s'), products, request: { kind: 'message', text: '어머니 한 세트 세트당 예산 5만원 이하 배송비 포함 추천', expectedVersion: 0 } });
  assert.deepEqual(out, base);
});
