// Real-key smoke test for ① dialogue understanding: one sentence, one real LLM call.
//   node --env-file=.env scripts/llm-smoke.mjs ["문장"]
// Prints provider, model, timeout, elapsed ms, outcome and the validated patch. Never prints the key or the sentence.
// The default sentence is not resolvable by rules, so it always reaches the LLM. This calls the real API (costs a little).
import { createLlm, logLlmError } from '../llm/index.mjs';
import { createDialogue, dialogueTimeoutMs, FALLBACK_QUESTION, TIMEOUT_TEXT } from '../dialogue/agent.mjs';
import { initial } from '../../../src/vendor/engine.mjs';

const text = process.argv[2] || '부모님 추석 선물이야. 엄마는 단 거 싫어하시고 땅콩 알레르기 있어. 아빠는 등산 좋아하셔. 5만 원 안쪽으로.';
const usage = [];
let llm;
try { llm = createLlm({ env: process.env, onError: logLlmError, onUsage: u => usage.push(u) }); }
catch { llm = null; }
if (!llm) { console.error('LLM이 설정되지 않았어요: LLM_BASE_URL·LLM_API_KEY·LLM_MODEL(또는 LLM_PROVIDER=gemini + GEMINI_API_KEY·GEMINI_MODEL)을 확인하세요 (.env).'); process.exit(2); }

const timeoutMs = dialogueTimeoutMs(process.env);
const started = Date.now();
const out = await createDialogue({ llm, timeoutMs }).interpret({ text, state: initial() });
const elapsedMs = Date.now() - started;

const failed = out.unresolved && [FALLBACK_QUESTION, TIMEOUT_TEXT].includes(out.questions[0]);
const call = usage.at(-1);
console.log(JSON.stringify({
  provider: llm.provider, model: call?.model ?? null, timeoutMs, llmCalls: usage.length,
  elapsedMs, llmLatencyMs: call?.latencyMs ?? null, tokens: call ? { in: call.inputTokens, out: call.outputTokens } : null,
  outcome: out.unresolved ? (failed ? 'failed' : 'asked') : 'ok',
  question: out.unresolved ? out.questions[0] : null,
  patch: out.patch, memoryCandidates: (out.memoryCandidates ?? []).map(c => ({ recipient: c.recipientName, key: c.key, polarity: c.polarity })),
}, null, 2));
process.exit(failed ? 1 : 0);
