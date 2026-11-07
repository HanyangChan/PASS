// P1-live: send ONE message through the c-attribution agent with the REAL LLM. Not part of npm test.
// Run manually from the repository root:
//   node --env-file=baseline/llm/.env baseline/agents/c-attribution/eval/run-live.mjs "엄마는 견과류는 좀 그렇대" [--recipient 어머니] [--policy ask_first|apply_confirmed]
import { createSession, runTurn } from '../../../src/index.mjs';
import { products } from '../../../examples/catalog.mjs';
import { createConfiguredAgent } from '../configured-agent.mjs';
import { PROMPT_VERSION } from '../prompts.mjs';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const text = process.argv[2];
if (!text || text.startsWith('--')) {
  console.error('사용법: run-live.mjs "발화" [--recipient 어머니] [--policy ask_first|apply_confirmed]');
  process.exit(1);
}
const recipient = arg('recipient', '어머니');
const mixedPolicy = arg('policy', 'ask_first');

const ready = await runTurn({
  session: createSession('p1-live'), products,
  request: { kind: 'patch', expectedVersion: 0, patch: { recipients: [recipient], quantity: 1, same_product: true, budget: { amount_krw: 50000, scope: 'per_set', shipping_included: true } } },
});
let stats = null;
const agent = createConfiguredAgent(process.env, { mixedPolicy, onStats: s => { stats = s; } });
try {
  const out = await agent.runTurn({ session: ready.session, products, request: { kind: 'message', expectedVersion: ready.session.version, text } });
  const changed = Object.fromEntries(Object.keys(out.session.state)
    .filter(k => JSON.stringify(out.session.state[k]) !== JSON.stringify(ready.session.state[k]))
    .map(k => [k, out.session.state[k]]));
  console.log(JSON.stringify({
    ok: true, model: agent.model, promptVersion: PROMPT_VERSION, mixedPolicy, text,
    kind: out.kind, question: out.question ?? null, changedState: changed,
    version: { before: ready.session.version, after: out.session.version },
    cards: out.result?.cards.map(c => `${c.id}:${c.budget_cost_krw}`) ?? [],
    llmCalls: stats?.llmCalls ?? 0, latencyMs: stats?.latencyMs ?? null, usage: stats?.usage ?? {}, timedOut: stats?.timedOut ?? false,
    path: stats?.path ?? [], claims: stats?.claims ?? [],
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error?.code ?? 'error', llmCalls: stats?.llmCalls ?? 0, latencyMs: stats?.latencyMs ?? null }));
  process.exitCode = 1;
}
