import { todayKst } from '../lib/catalog.mjs';
import { mentionedAllergens } from '../lib/allergens.mjs';
import { recommend } from '../lib/engine.mjs';
import { budgetAlternatives } from '../lib/counterfactual.mjs';
import { engineState, fastRuleTurn, finishSingle, publicState } from '../lib/single-gift.mjs';
import { validate, validateState } from '../lib/llm.mjs';
import { validDate } from '../lib/language.mjs';
import { createLlmFromEnv } from '../baseline/llm/index.mjs';
import { PERSON_FIELDS } from '../baseline/agents/c-attribution/attribute.mjs';
import { fromItems, instructions, schema } from '../baseline/agents/c-attribution/output.mjs';
import { runAgentTurn } from '../baseline/agents/d-langgraph/index.mjs';
import { classifyIntent, moneyValues } from '../baseline/agents/a-router/parser.mjs';

export const LANGGRAPH_AGENT = 'langgraph-advisors';
const advisorNames = ['occasion', 'spending', 'taste', 'relationship'];

export function readAdvisorContext(raw) {
  if (raw === undefined) return { disabled: [], calendar: [] };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw Error('invalid advisor context');
  // Ignore historical context from older clients. The live graph only receives calendar and toggles.
  const { disabled = [], calendar = [] } = raw;
  if (!Array.isArray(disabled) || disabled.length > advisorNames.length || !disabled.every(name => advisorNames.includes(name))) throw Error('invalid advisor list');
  if (!Array.isArray(calendar) || calendar.length > 100 || calendar.some(e => !e || typeof e.title !== 'string' || !e.title || e.title.length > 60 || !/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(e.date) || !['birthday', 'anniversary', 'etc'].includes(e.kind))) throw Error('invalid calendar');
  return {
    disabled,
    calendar: calendar.map(({ title, date, kind }) => ({ title, date, kind })),
  };
}

function createAttributor(env, fetcher, signal) {
  if (env.LLM_PROVIDER !== 'openai-compatible' || !env.LLM_API_KEY) return undefined;
  const client = createLlmFromEnv(env, { fetcher, timeoutMs: 12000 });
  return async ({ text, state }) => {
    const result = await client.completeJson({
      messages: [
        { role: 'system', content: `${instructions}\nUse this JSON schema: ${JSON.stringify(schema)}` },
        { role: 'user', content: JSON.stringify({ message: text, current_recipient: state.recipients[0] ?? null, current: Object.fromEntries(PERSON_FIELDS.map(field => [field, state[field]])) }) },
      ],
      responseFormat: env.LLM_RESPONSE_FORMAT === 'text' ? 'text' : 'json_object',
      reasoningEnabled: env.LLM_REASONING_ENABLED === 'true',
      maxTokens: 900,
      signal,
      validate: parsed => validate(parsed, schema),
    });
    return fromItems(result.data, state);
  };
}

function prepareSingleGiftPatch(state, patch) {
  if (!patch.recipients || JSON.stringify(patch.recipients) === JSON.stringify(state.recipients)) return patch;
  const existing = state.recipients.length ? {} : state;
  return { ...existing, ...patch, quantity: 1, same_product: true, budget: { ...existing.budget, ...patch.budget, scope: 'per_set' } };
}

function conditionQuestion(text) {
  const amounts = moneyValues(text);
  if (amounts.length > 1 || amounts.length && /최소|하한/.test(text)) return '적용할 예산 상한 하나를 알려주세요.';
  for (const [, year, month, day] of text.matchAll(/(\d{4})[-년]\s*(\d{1,2})[-월]\s*(\d{1,2})/g)) {
    if (!validDate(`${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`)) return '실제 수령 마감일을 YYYY-MM-DD 형식으로 알려주세요.';
  }
  if (/알레르기|알러지/.test(text) && !/알레르기\s*(없|해제|취소)/.test(text) && !mentionedAllergens(text).length) return '피해야 할 알레르기 성분을 알려주세요.';
  return null;
}

export async function prototypeLangGraphTurn(input, products, { env, fetcher, signal, advisorContext }) {
  const before = input.state;
  const catalog = products.map(product => ({ ...product, rating_count: product.rating_count ?? 0 }));
  const session = { id: 'prototype-request', version: 0, state: engineState(before) };
  const question = input.operation === 'turn' ? conditionQuestion(input.text) : null;
  const shortcut = input.operation === 'turn' && !question ? fastRuleTurn(input, products) : null;
  const intent = question ? { kind: 'clarify', question } : input.operation === 'turn' ? classifyIntent(input.text, before) : { kind: 'view' };
  const request = { expectedVersion: 0, ...(input.operation === 'conditions' ? { kind: 'patch', patch: input.routerPatch ?? input.patch }
    : shortcut ? { kind: 'patch', patch: shortcut.session.state }
      : intent.kind === 'message' ? { kind: 'message', text: input.text } : { kind: 'view' }) };
  const { disabled, ...context } = advisorContext;
  const output = await runAgentTurn({ session, request, products: catalog, context: { ...context, today: todayKst() }, disabled, llm: createAttributor(env, fetcher, signal), preparePatch: prepareSingleGiftPatch });
  if (signal?.aborted) throw Error('aborted');
  const trace = output.agents?.trace ?? output.trace[0];
  const agents = output.agents ?? { attribution: [], opinions: [], suggestions: [], memoryProposals: [], autoApplied: [], trace };
  const routing = { agent: LANGGRAPH_AGENT, route: trace?.provider ?? 'rules', llmCalls: trace?.llmCalls ?? 0, intent: intent.intent ?? 'conditions' };
  let state = publicState(output.session.state);
  let issues = output.agents ? [] : [output.question];
  if (shortcut) issues = shortcut.session.issues;
  if (input.operation === 'view' || input.operation === 'conditions' && input.clearIssues === false) issues = input.issues;
  if (intent.kind === 'clarify') issues = [intent.question];
  if (!issues.length && agents.attribution.length && agents.attribution.every(item => item.holder === 'giver' && !item.applied)) issues = ['받는 분의 취향도 알려주세요.'];
  if (JSON.stringify(state.recipients) === JSON.stringify(before.recipients) && input.issues.some(q => q.includes('성분') || q.includes('알레르기는 누구')) && JSON.stringify(state.excluded_ingredients) === JSON.stringify(before.excluded_ingredients) && !/알레르기\s*(없|해제|취소)/.test(input.text ?? '')) issues = input.issues;
  let evaluated = engineState(publicState(output.evaluatedState ?? output.session.state));
  if (output.session.state.quantity !== 1 || output.session.state.same_product !== true || output.session.state.budget.scope !== 'per_set') {
    state = before;
    evaluated = engineState(before);
    issues = ['현재 앱은 선물 하나 기준입니다. 선물 하나의 예산과 조건을 알려주세요.'];
  }
  validateState(state);
  const turn = finishSingle(before, state, issues, products);
  const result = recommend(products, evaluated);
  let message = turn.question.key ? turn.question.text : result.message;
  if (!turn.question.key && intent.kind === 'what_if_budget') {
    const compared = recommend(products, { ...evaluated, budget: { ...evaluated.budget, amount_krw: intent.amount_krw } });
    const candidates = compared.items.map(p => `${p.name} (${p.total.toLocaleString('ko-KR')}원)`).join(', ');
    message = `예산을 ${intent.amount_krw.toLocaleString('ko-KR')}원으로 가정했어요. ${candidates || '조건에 맞는 상품이 없습니다.'}\n현재 예산은 그대로입니다.`;
  } else if (!turn.question.key && intent.intent === 'explain' && result.items.length) {
    message = result.items.map((p, index) => `${index + 1}위 ${p.name}: 적용 비용 ${p.total.toLocaleString('ko-KR')}원, 선호 점수 ${p.score}점`).join('\n');
  }
  return { ...turn, message, agent: LANGGRAPH_AGENT, mode: 'agents', agents, routing, view: { question: turn.question, result, comparison: budgetAlternatives(products, evaluated) } };
}
