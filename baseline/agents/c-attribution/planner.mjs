// P2 planner and orchestrator. Wraps the common runTurn; never changes its result, only adds `plan`.
// The default createAgent() in index.mjs is untouched; this is a separate entry point.
import { runTurn as commonRunTurn } from '../../src/index.mjs';
import { claimPatchValue, isOwnerFree } from './attribution.mjs';
import { explain } from './explain.mjs';
import { createInterpreter } from './interpreter.mjs';
import { RECIPIENT_ALIASES, categoryName, josa, unknownQuestion } from './vocabulary.mjs';

export const DEFAULT_MAX_TURNS = 8;
const PLANNER_KEYS = 'asked,memoryApplied,turn,v';

/** User-facing notices for LLM errors. The host decides about retries; this agent never retries. */
export const ERROR_NOTICES = Object.freeze({
  retry: '일시적인 문제로 이번 말씀을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.',
  operator: '서비스 설정 문제로 처리하지 못했어요. 운영자 확인이 필요해요.',
});
const RETRY_CODES = ['timeout', 'network_error', 'provider_unavailable', 'invalid_response', 'aborted'];
const NOTICES = Object.freeze({
  limitRecommend: '여러 번 여쭤봐도 확인되지 않은 조건은 빼고, 확인된 조건으로만 추천했어요.',
  limitMissing: label => `${josa(label, '이', '가')} 비어 있어 아직 추천할 수 없어요. 조건 편집에서 입력해 주세요.`,
  edit: label => `조건 편집에서 ${josa(label, '을', '를')} 입력해 주세요.`,
  editClaim: '같은 내용을 여러 번 여쭤봤어요. 조건 편집에서 직접 입력해 주세요.',
  rephrase: "받는 분에 대한 조건이라면 '엄마는 견과류를 피해'처럼 받는 분을 넣어 다시 말씀해 주세요.",
});

/** Mirror of the common core's missing() order and wording (checked against runTurn in T2-03). */
const REQUIRED = [
  ['recipients', '받는 사람', s => !s.recipients.length, '받는 사람을 알려주세요.'],
  ['budget.amount_krw', '예산 상한', s => s.budget.amount_krw === null, '예산 상한을 알려주세요.'],
  ['quantity', '선물 수량', s => !s.quantity, '선물 수량을 알려주세요.'],
  ['budget.scope', '예산 기준(총예산 또는 세트당)', s => !s.budget.scope, '총예산인지 세트당 예산인지 알려주세요.'],
  ['budget.shipping_included', '배송비 포함 여부', s => s.budget.shipping_included === null, '예산에 배송비를 포함할까요?'],
  ['same_product', '같은 상품 여부', s => s.quantity > 1 && s.same_product !== true, '여러 명에게 같은 상품을 보낼지 확인해 주세요.'],
];

/** missingField(state) → {field, label, question} for the first missing required condition, or null. */
export function missingField(state) {
  const hit = REQUIRED.find(([, , isMissing]) => isMissing(state));
  return hit ? { field: hit[0], label: hit[1], question: hit[3] } : null;
}

/** createPlannerState() → a fresh {v, turn, asked, memoryApplied}. Keep it outside the session. */
export function createPlannerState() { return { v: 1, turn: 0, asked: [], memoryApplied: false }; }

function checkedPlannerState(ps) {
  const ok = ps && typeof ps === 'object' && !Array.isArray(ps) && Object.keys(ps).sort().join() === PLANNER_KEYS
    && ps.v === 1 && Number.isSafeInteger(ps.turn) && ps.turn >= 0 && typeof ps.memoryApplied === 'boolean'
    && Array.isArray(ps.asked) && ps.asked.length <= 200
    && ps.asked.every(a => a && typeof a === 'object' && (a.text === null || typeof a.text === 'string') && (a.field === null || typeof a.field === 'string'));
  if (!ok) throw new TypeError('invalid plannerState; start with createPlannerState()');
  return structuredClone(ps);
}

const subjectName = person => (Object.values(RECIPIENT_ALIASES).includes(person) || person.endsWith('님') ? person : `${person}분`);
function thirdPartyQuestion(c) {
  const target = c.kind === 'ingredient' ? josa(c.value, '을', '를') : c.kind === 'category' ? josa(categoryName(c.value), '을', '를') : '단 것을';
  const verb = c.polarity === 'prefer' ? '좋아하시나요?' : '피하셔야 하나요?';
  return `${subjectName(c.person)} 이야기시죠? 받는 분도 ${target} ${verb}`;
}

/** Claims that were not turned into state (for the "unapplied" list). Givers are dropped on purpose. */
function unappliedClaims(claims, state) {
  return claims.filter(c => {
    if (c.owner === 'giver' && !isOwnerFree(c)) return false;
    const added = c.owner === 'recipient' ? claimPatchValue(c) : null;
    return !(added && state[added.field].includes(added.value));
  }).map(({ span, kind, value, polarity, owner, reason }) => ({ span, kind, value, polarity, owner, reason }));
}

/** Question candidates for an interpreter question, best first. Never written by an LLM. */
function confirmCandidates(commonQuestion, claims) {
  const third = claims.find(c => c.reason === 'third_party' && c.person && unknownQuestion(c) === commonQuestion);
  const unknownAsked = claims.some(c => c.owner === 'unknown' && !isOwnerFree(c) && unknownQuestion(c) === commonQuestion);
  return [third ? thirdPartyQuestion(third) : commonQuestion, ...(unknownAsked || third ? [NOTICES.rephrase] : [])];
}

/**
 * planNext — pure rule table (TEST-PLAN P2). Inputs are the common output and this turn's claims.
 * Returns {action, field, question, notice, unapplied, turnLimitReached, needsView, asked}.
 */
export function planNext({ request, output, claims, plannerState, maxTurns }) {
  const turn = plannerState.turn + 1;
  const limit = turn >= maxTurns;
  const askedTexts = new Set(plannerState.asked.map(a => a.text).filter(Boolean));
  const askedFields = new Set(plannerState.asked.map(a => a.field).filter(Boolean));
  const base = { action: null, field: null, question: null, notice: null, unapplied: [], turn, turnLimitReached: limit, needsView: false };
  if (request.kind === 'what_if_budget') return { ...base, action: 'compare' };
  if (output.kind !== 'question') return { ...base, action: 'recommend' };

  const state = output.session.state;
  const missing = missingField(state);
  const unapplied = unappliedClaims(claims ?? [], state);
  if (limit && !missing) return { ...base, action: 'recommend', needsView: true, notice: NOTICES.limitRecommend, unapplied };
  const limitNotice = limit && missing ? NOTICES.limitMissing(missing.label) : null;
  const fromInterpreter = !missing || output.question !== missing.question;
  if (fromInterpreter) {
    const question = confirmCandidates(output.question, claims ?? []).find(q => !askedTexts.has(q));
    if (question) return { ...base, action: 'confirm', question, notice: limitNotice, unapplied };
    return { ...base, action: 'request_edit', notice: limitNotice ?? NOTICES.editClaim, unapplied };
  }
  if (askedFields.has(missing.field)) return { ...base, action: 'request_edit', field: missing.field, notice: limitNotice ?? NOTICES.edit(missing.label), unapplied };
  return { ...base, action: 'ask', field: missing.field, question: missing.question, notice: limitNotice, unapplied };
}

const isLlmError = e => e?.name === 'LlmError' && typeof e.code === 'string';

/**
 * createPlannedAgent(options) → {id, runTurn({session, plannerState?, request, products, recipientId?})}
 * options: interpret (use as is) or interpreter options {llm, mixedPolicy, timeoutMs, maxTokens, reasoning, onStats};
 * maxTurns (default DEFAULT_MAX_TURNS). Hooks for P3 (explain) and P4 (memory) are added by later steps.
 */
export function createPlannedAgent({ interpret, maxTurns = DEFAULT_MAX_TURNS, onStats, explanation: withExplanation = true, hooks = {}, ...interpreterOptions } = {}) {
  if (interpret !== undefined && typeof interpret !== 'function') throw new TypeError('interpret must be a function');
  if (typeof withExplanation !== 'boolean') throw new TypeError('explanation must be a boolean');
  if (!Number.isSafeInteger(maxTurns) || maxTurns < 1 || maxTurns > 50) throw new TypeError('maxTurns must be an integer 1..50');
  if (onStats !== undefined && typeof onStats !== 'function') throw new TypeError('onStats must be a function');
  const options = { llm: interpreterOptions.llm ?? null, ...interpreterOptions };
  if (interpret === undefined) createInterpreter(options); // validate options early

  async function runTurn({ session, plannerState, request, products, recipientId } = {}) {
    const ps = checkedPlannerState(plannerState === undefined ? createPlannerState() : plannerState);
    let stats = null;
    // A fresh interpreter per turn keeps this turn's attribution separate from concurrent turns.
    const turnInterpret = interpret ?? createInterpreter({ ...options, onStats: s => { stats = s; onStats?.(s); } });
    let output;
    try {
      output = await commonRunTurn({ session, request, products, interpret: turnInterpret });
    } catch (error) {
      if (!isLlmError(error)) throw error; // common errors (version_conflict, invalid_input, ...) unchanged
      return {
        session: structuredClone(session), kind: 'error',
        plan: {
          action: 'error', field: null, question: null, notice: RETRY_CODES.includes(error.code) ? ERROR_NOTICES.retry : ERROR_NOTICES.operator,
          unapplied: [], turn: ps.turn, maxTurns, turnLimitReached: false, error: { code: error.code },
          attribution: null, llm: llmSummary(stats), plannerState: ps,
        },
      };
    }
    const claims = stats?.claims ?? [];
    const context = { session: output.session, request, products, recipientId, claims, plannerState: ps };
    if (hooks.afterCommon) output = await hooks.afterCommon(output, context);

    const decided = planNext({ request, output, claims, plannerState: ps, maxTurns });
    if (decided.needsView) output = await commonRunTurn({ session: output.session, request: { kind: 'view', expectedVersion: output.session.version }, products });
    const { needsView, ...plan } = decided;
    const asked = plan.question ? [...ps.asked, { text: plan.question, field: plan.field }] : ps.asked;
    const nextState = { ...ps, turn: decided.turn, asked, ...(context.plannerStatePatch ?? {}) };
    const response = {
      ...output,
      plan: { ...plan, maxTurns, error: null, attribution: stats ? claims : null, llm: llmSummary(stats), ...(context.planExtra ?? {}), plannerState: nextState },
    };
    // P3: engine-fact explanation for recommendations and comparisons (comparison uses the hypothetical state).
    if (withExplanation && (output.kind === 'recommendation' || output.kind === 'comparison'))
      response.explanation = explain({ products, state: output.evaluatedState, result: output.result });
    return hooks.decorate ? hooks.decorate(response, context) : response;
  }
  return { id: 'c-attribution-planned', runTurn };
}

function llmSummary(stats) {
  return stats ? { calls: stats.llmCalls, usage: stats.usage, timedOut: stats.timedOut, timeoutSource: stats.timeoutSource } : null;
}
