// Real-key 3-turn check (K72): "엄마 추석 선물 5만원" -> "세트당 10만원" -> "네", once with LLM_REASONING=off and once with on.
//   node --env-file=.env scripts/llm-turns.mjs [--modes=off,on] [--experiment=B]
// Per turn: time to the first answer (question|cards), whole turn, dialogue/explainer LLM latency and reasoning_tokens,
// the conditions saved after the turn, and whether the turn fits 25 s and the explanation 8 s.
// Calls the real API (costs a little). Never prints the key, prompts, reasoning_content or LLM answers.
import { createSqliteStore } from '../db/store.mjs';
import { loadCatalog } from '../data/load.mjs';
import { createPipeline } from '../pipeline/index.mjs';
import { createLlm, llmProvider, logLlmError } from '../llm/index.mjs';
import { dialogueLlmFrom } from '../server/index.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v = 'true'] = a.replace(/^--/, '').split('='); return [k, v]; }));
const MODES = (args.modes || 'off,on').split(',');
const TURNS = ['엄마 추석 선물 5만원', '세트당 10만원', '네'];
const TURN_LIMIT_MS = 25000, EXPLAIN_LIMIT_MS = 8000;

if (llmProvider(process.env) !== 'openai-compatible') { console.error('LLM_API_KEY / LLM_BASE_URL / LLM_MODEL이 필요해요 (.env).'); process.exit(2); }
const products = loadCatalog();
const rows = [];

for (const mode of MODES) {
  const env = { ...process.env, LLM_REASONING: mode };
  const usage = [];
  const llm = createLlm({ env, onError: logLlmError, onUsage: u => usage.push({ ...u, at: performance.now() }) });
  if (!llm) { console.error('LLM 설정을 확인하세요.'); process.exit(2); }
  const store = createSqliteStore();
  const pipeline = createPipeline({ store, products, llm, dialogueLlm: dialogueLlmFrom(env, { llm }) });
  const history = [];
  for (const [i, text] of TURNS.entries()) {
    const marks = {}, started = performance.now(), from = usage.length;
    const emit = e => { if (!marks[e.type]) marks[e.type] = performance.now() - started; };
    const out = await pipeline.runPipelineTurn({ ownerId: 'latency', sessionId: `turns-${mode}`, experiment: args.experiment || 'B', request: { kind: 'message', text, history: [...history] }, emit });
    const turnMs = performance.now() - started;
    const calls = usage.slice(from);
    const dialogue = calls.filter(u => u.role === 'dialogue'), explainer = calls.filter(u => u.role === 'explainer');
    const q = out.events.find(e => e.type === 'question'), ex = out.events.find(e => e.type === 'explanations');
    const firstMs = Math.min(...['question', 'cards', 'comparison'].map(t => marks[t] ?? Infinity));
    const explainMs = marks.explanations !== undefined && marks.cards !== undefined ? marks.explanations - marks.cards : null;
    const s = (await store.getSession('latency', `turns-${mode}`))?.session.state;
    rows.push({
      reasoning: mode, turn: i + 1, text,
      firstMs: Number.isFinite(firstMs) ? Math.round(firstMs) : null, turnMs: Math.round(turnMs),
      dialogue: dialogue.map(u => ({ ms: u.latencyMs, ok: u.ok, reasoningTokens: u.reasoningTokens, out: u.outputTokens })),
      explainer: explainer.map(u => ({ ms: u.latencyMs, ok: u.ok, reasoningTokens: u.reasoningTokens, out: u.outputTokens })),
      explainMs: explainMs === null ? null : Math.round(explainMs), explainSource: ex?.source ?? null,
      events: out.events.map(e => e.type), question: q?.question ?? null, code: q?.code ?? null,
      state: s ? { recipients: s.recipients, occasion: s.occasion, amount_krw: s.budget.amount_krw, shipping_included: s.budget.shipping_included, scope: s.budget.scope, quantity: s.quantity, excluded_ingredients: s.excluded_ingredients, preferences: s.preferences } : null,
      turnOk: turnMs <= TURN_LIMIT_MS, explainOk: explainMs === null ? null : explainMs <= EXPLAIN_LIMIT_MS,
    });
    history.push({ role: 'user', text });
    if (q?.question) history.push({ role: 'assistant', text: q.question });
    while (history.length > 6) history.shift();
  }
}
console.log(JSON.stringify(rows, null, 2));
