import { StateGraph, Annotation, Send, START, END } from '@langchain/langgraph';
import { runTurn } from '../../src/index.mjs';
import { parseRules } from '../../src/parser.mjs';
import { apply, rankProducts } from '../../src/vendor/engine.mjs';
import { attribute, PERSON_FIELDS } from '../c-attribution/attribute.mjs';
import { ADVISORS } from './advisors.mjs';

const AGENTS = Object.keys(ADVISORS);
const concat = { reducer: (a, b) => a.concat(b), default: () => [] };
const Turn = Annotation.Root({
  input: Annotation(),      // { session, request, products, context, disabled, llm }
  attribution: Annotation(),
  persisted: Annotation(),  // common runTurn result with only the user's own conditions
  signals: Annotation(concat),
  output: Annotation(),
});

// C: interpret the message (common rules first, then attribution, at most one LLM call) and
// store only what the user said through the common core.
async function attributeNode({ input }) {
  const { session, request, products, llm, ranking } = input;
  let attribution = { patch: {}, questions: [], unresolved: false, items: [], provider: 'none', llmCalls: 0 };
  if (request.kind === 'message') {
    const rules = parseRules(request.text);
    attribution = rules.unresolved
      ? await attribute({ text: request.text, state: structuredClone(session.state), llm })
      : { ...rules, items: [], provider: 'rules', llmCalls: 0 };
  }
  if (attribution.unresolved) {
    const output = { session, kind: 'question', question: attribution.questions[0], trace: [{ stage: 'attribute', provider: attribution.provider, llmCalls: attribution.llmCalls }] };
    return { attribution, output };
  }
  const proposed = request.kind === 'message' ? attribution.patch : request.kind === 'patch' ? request.patch : {};
  const patch = input.preparePatch?.(session.state, proposed) ?? proposed;
  const persisted = Object.keys(patch).length
    ? await runTurn({ session, products, ranking, request: { kind: 'patch', expectedVersion: request.expectedVersion, patch } })
    : await runTurn({ session, products, ranking, request: { kind: 'view', expectedVersion: request.expectedVersion } });
  return { attribution, persisted };
}

const advisorNode = name => ({ input, persisted, attribution }) => {
  const stated = attribution.items.some(i => i.field === 'preferences' && i.applied) || Boolean(input.request.patch?.preferences);
  const out = ADVISORS[name]({ state: persisted.session.state, text: input.request.text ?? '', context: input.context, statedThisTurn: stated });
  return { signals: [{ agent: name, ...out }] };
};

// Merge: opinions are shown for every agent; only enabled agents add suggestions and the
// soft auto-preferences, which are evaluated on a copy and never stored in the session.
async function mergeNode({ input, persisted, attribution, signals }) {
  const { products, disabled = [], context, ranking } = input;
  const on = s => !disabled.includes(s.agent);
  const ordered = AGENTS.map(a => signals.find(s => s.agent === a)).filter(Boolean);
  const opinions = ordered.flatMap(s => s.opinions.filter(o => o.source).map(o => ({ agent: s.agent, ...o, enabled: on(s) })));
  const base = persisted.session.state;
  const auto = ordered.filter(on).flatMap(s => s.auto.preferences ?? []).filter(p => !base.preferences.includes(p));
  const temp = structuredClone(persisted.session);
  const evaluated = auto.length
    ? await runTurn({ session: temp, products, ranking, request: { kind: 'patch', expectedVersion: temp.version, patch: { preferences: [...base.preferences, ...auto] } } })
    : persisted;
  const state = evaluated.evaluatedState ?? evaluated.session.state;
  const suggestions = ordered.filter(on).flatMap(s => s.suggestions.map(x => {
    const items = rankProducts(products, apply(state, x.patch), ranking).items;
    return { agent: s.agent, ...x, preview: { candidates: items.length, top: items[0]?.name ?? null } };
  }));
  const remembered = context.memory ?? {};
  const fresh = attribution.items.filter(i => i.applied && i.holder === 'recipient' && PERSON_FIELDS.includes(i.field) && !(remembered[i.field] ?? []).includes(i.value));
  const recipient = base.recipients.length === 1 ? base.recipients[0] : null;
  const memoryProposals = recipient && fresh.length ? [Object.fromEntries([['recipient', recipient], ...PERSON_FIELDS.map(f => [f, fresh.filter(i => i.field === f).map(i => i.value)])])] : [];
  const output = {
    ...evaluated, session: persisted.session,
    agents: {
      attribution: attribution.items.map(({ holder, person, field, value, applied }) => ({ holder, person, field, value, applied })),
      opinions, suggestions, memoryProposals, autoApplied: auto,
      trace: { provider: attribution.provider, llmCalls: attribution.llmCalls, agents: ordered.map(s => s.agent), disabled },
    },
  };
  return { output };
}

const graph = new StateGraph(Turn)
  .addNode('attribute', attributeNode)
  .addNode('occasion', advisorNode('occasion'))
  .addNode('spending', advisorNode('spending'))
  .addNode('taste', advisorNode('taste'))
  .addNode('relationship', advisorNode('relationship'))
  .addNode('merge', mergeNode)
  .addEdge(START, 'attribute')
  // Every advisor runs each turn (a disabled one is still shown, switched off), so the join never waits.
  .addConditionalEdges('attribute', s => s.output ? END : AGENTS.map(a => new Send(a, s)), [...AGENTS, END])
  .addEdge(AGENTS, 'merge')
  .addEdge('merge', END)
  .compile();

/**
 * One PASS turn through the C + D graph. Same session/request/products contract as the
 * common runTurn, plus `context` ({today, memory, purchases, calendar} for the current
 * recipient), `disabled` agent names and an optional `llm` attributor.
 */
export async function runAgentTurn({ session, request, products, context = {}, disabled = [], llm, preparePatch, ranking }) {
  if (request?.kind === 'what_if_budget') return runTurn({ session, request, products, ranking });
  if (typeof context.today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(context.today)) throw new TypeError('context.today must be YYYY-MM-DD');
  const unknown = disabled.filter(a => !AGENTS.includes(a));
  if (unknown.length) throw new RangeError(`Unknown agents: ${unknown.join(', ')}`);
  const { output } = await graph.invoke({ input: { session, request, products, context, disabled, llm, preparePatch, ranking } });
  return output;
}
export const agentNames = AGENTS;
