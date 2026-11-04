// index.mjs keeps its public contract: interpretMessage / createAgent. Without a key the old question comes back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initial } from '../../../src/vendor/engine.mjs';
import { createSession, runTurn } from '../../../src/index.mjs';
import { interpretMessage, createAgent } from '../index.mjs';
import { createFakeLlm } from '../llm/index.mjs';
import { createDialogue, toPort } from '../dialogue/agent.mjs';
import { products } from './fixtures/catalog.mjs';

const KEYS = ['LLM_PROVIDER', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'OPENAI_COMPAT_API_KEY', 'OPENAI_COMPAT_MODEL'];
const withoutKeys = async fn => {
  const saved = Object.fromEntries(KEYS.map(k => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  try { return await fn(); } finally { for (const k of KEYS) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
};

test('no key: interpretMessage returns the same unresolved question as before P2', () => withoutKeys(async () => {
  assert.deepEqual(await interpretMessage({ text: '센스 있는 선물', state: initial() }), {
    patch: {}, unresolved: true,
    questions: ['이 에이전트의 자유 발화 해석은 아직 구현 전입니다. 조건 편집으로 입력해 주세요.'],
  });
}));

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
