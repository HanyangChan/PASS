// P5 live demo: the six-turn conversation through the assembled agent with the REAL LLM.
// Not part of npm test (name/folder do not match test patterns). Run manually from the repository root:
//   node --env-file=baseline/llm/.env baseline/agents/c-attribution/examples/live-demo.mjs
// Prints per turn: kind, applied conditions, question/notice, top cards, explanation, plan, LLM calls·tokens·latency.
// Never prints the key or the environment.
import { createSession } from '../../../src/index.mjs';
import { products } from '../../../examples/catalog.mjs';
import { createConfiguredAgent } from '../configured-agent.mjs';
import { PROMPT_VERSION } from '../prompts.mjs';

const RECIPIENT_ID = 'demo-recipient-1'; // a stable host id, not a display name
const TURNS = [
  { text: '어머니 한 세트 세트당 예산 5만원 이하 배송비 포함 추천' },
  { text: '나는 단 것을 좋아해' },
  { text: '엄마는 설탕을 피해' },
  { text: '견과류는 별로야' },
  { text: '응 엄마가 견과류 알레르기 있어' },
  { whatIf: 70000 },
];

let turnStats = [];
let agent;
try {
  agent = createConfiguredAgent(process.env, { onStats: s => turnStats.push(s) });
} catch (error) {
  console.error(JSON.stringify({ ok: false, code: error?.code ?? 'error' }));
  process.exit(1);
}
console.log(JSON.stringify({ model: agent.model, promptVersion: PROMPT_VERSION, recipientId: RECIPIENT_ID, turns: TURNS.length }));

let session = createSession('live-demo');
let plannerState;
const totals = { llmCalls: 0, outputTokens: 0, latencyMs: 0 };
for (const [i, turn] of TURNS.entries()) {
  turnStats = [];
  const request = turn.whatIf
    ? { kind: 'what_if_budget', amount_krw: turn.whatIf, expectedVersion: session.version }
    : { kind: 'message', text: turn.text, expectedVersion: session.version };
  const started = performance.now();
  let out;
  try {
    out = await agent.runTurn({ session, plannerState, request, products, recipientId: RECIPIENT_ID });
  } catch (error) {
    console.log(JSON.stringify({ turn: i + 1, request: turn.text ?? `what_if_budget ${turn.whatIf}`, ok: false, commonError: error?.code ?? 'error' }));
    break;
  }
  const latencyMs = Math.round(performance.now() - started);
  const llmCalls = turnStats.reduce((n, s) => n + s.llmCalls, 0);
  const outputTokens = turnStats.reduce((n, s) => n + (s.usage?.completion_tokens ?? 0), 0);
  totals.llmCalls += llmCalls; totals.outputTokens += outputTokens; totals.latencyMs += latencyMs;
  const s = out.session.state;
  console.log(JSON.stringify({
    turn: i + 1, request: turn.text ?? `what_if_budget ${turn.whatIf}`,
    kind: out.kind, version: out.session.version,
    state: { recipients: s.recipients, quantity: s.quantity, budget: s.budget, preferences: s.preferences, excluded_ingredients: s.excluded_ingredients, excluded_categories: s.excluded_categories },
    evaluatedBudget: out.evaluatedState?.budget.amount_krw ?? null,
    question: out.plan.question, notice: out.plan.notice,
    cards: (out.result?.cards ?? []).slice(0, 3).map(c => `${c.id}:${c.budget_cost_krw}`),
    explanation: out.explanation ? {
      reason: out.explanation.reason?.text ?? null,
      contrastive: out.explanation.contrastive ? `${out.explanation.contrastive.criterion}: ${out.explanation.contrastive.text}` : null,
      counterfactual: out.explanation.counterfactual ? `(${out.explanation.counterfactual.case}) ${out.explanation.counterfactual.text}` : null,
    } : null,
    plan: {
      action: out.plan.action, field: out.plan.field, turnLimitReached: out.plan.turnLimitReached, error: out.plan.error,
      unapplied: out.plan.unapplied.map(c => `${c.kind}:${c.value ?? '-'}→${c.owner}(${c.reason})`),
      attribution: (out.plan.attribution ?? []).map(c => `${c.kind}:${c.value ?? '-'}:${c.polarity ?? '-'}→${c.owner}(${c.reason})`),
      memory: out.plan.memory ? { applied: out.plan.memory.applied.map(a => a.value), skipped: out.plan.memory.skipped.map(x => `${x.value}:${x.reason}`), proposals: out.plan.memory.proposals.map(p => `${p.field}:${p.value}${p.sensitive ? '(민감)' : ''}`) } : null,
    },
    llm: { calls: llmCalls, outputTokens, diagnostics: turnStats.flatMap(x => x.calls).map(d => `${d.stage}:${d.errorCode ?? 'ok'}:${d.completionTokens ?? '-'}tok:${d.latencyMs}ms`) },
    latencyMs,
  }, null, 2));
  if (out.kind !== 'error') session = out.session;
  plannerState = out.plan.plannerState;
}
console.log(JSON.stringify({ totals, pendingMemoryProposals: agent.memory?.pending(RECIPIENT_ID).map(p => `${p.field}:${p.value}`) ?? [] }));
