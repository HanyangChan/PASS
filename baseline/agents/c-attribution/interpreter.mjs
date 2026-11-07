// Attribution interpreter: rules → (LLM extraction) → subject guard → (LLM classification) → routing.
// Output contract of the common interpret port: {patch, questions, unresolved}.
import { LlmError } from '../../llm/index.mjs';
import { checkedPatch } from '../../src/contracts.mjs';
import { analyze, hasSubjectMarker, ownerForSpan } from './rules.mjs';
import { isOwnerFree, routeClaims, validateClassification, validateExtraction } from './attribution.mjs';
import { PROMPT_VERSION, classificationMessages, extractionMessages } from './prompts.mjs';
import { CONDITION_KINDS, MIXED_POLICIES, QUESTIONS } from './vocabulary.mjs';

/**
 * Defaults decided 2026-11-07 from the reasoning comparison (see README "결정 기록").
 * - reasoning off: 0 failures, max 40 output tokens, max 3.3 s per sentence; same accuracy on #4·#6.
 * - maxTokens: largest JSON the validators accept for a realistic message plus margin (README).
 * - timeout: 3.3 s observed × ~2.4; below the transport's 18 s so this limit is normally hit first.
 */
export const DEFAULT_REASONING = Object.freeze({ enabled: false });
export const DEFAULT_MAX_TOKENS = Object.freeze({ extract: 1200, classify: 400 });
export const DEFAULT_TIMEOUT_MS = 8000;
const REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
const CLIENT_STAGE_NOTE = '클라이언트 단계 실패(끊김·빈 응답·JSON 파싱 가능성). 공통 클라이언트가 finish_reason을 노출하지 않아 원인은 단정하지 않음';
const GENERIC = Object.freeze({ patch: {}, questions: [QUESTIONS.generic], unresolved: true });
const CONDITION = Object.freeze({ patch: {}, questions: [QUESTIONS.condition], unresolved: true });
const copy = result => structuredClone(result);
const tokenLimit = n => Number.isSafeInteger(n) && n >= 1 && n <= 100000;

function addUsage(total, usage = {}) {
  for (const [key, value] of Object.entries(usage)) if (Number.isSafeInteger(value)) total[key] = (total[key] ?? 0) + value;
}

function resolveMaxTokens(maxTokens) {
  if (maxTokens === undefined) return { ...DEFAULT_MAX_TOKENS };
  if (typeof maxTokens === 'number') {
    if (!tokenLimit(maxTokens)) throw new TypeError('maxTokens must be an integer 1..100000');
    return { extract: maxTokens, classify: maxTokens };
  }
  if (!maxTokens || typeof maxTokens !== 'object' || Object.keys(maxTokens).some(k => !['extract', 'classify'].includes(k))) throw new TypeError('maxTokens must be a number or {extract, classify}');
  const resolved = { ...DEFAULT_MAX_TOKENS, ...maxTokens };
  if (!tokenLimit(resolved.extract) || !tokenLimit(resolved.classify)) throw new TypeError('maxTokens must be an integer 1..100000');
  return resolved;
}

/**
 * reasoning: undefined → DEFAULT_REASONING (off); null → send nothing (provider default);
 * {enabled?: boolean, effort?: one of REASONING_EFFORTS} → sent as given.
 * Mapped to the common client's reasoningEnabled → payload.reasoning={enabled}, reasoningEffort → payload.reasoning_effort.
 */
function resolveReasoning(reasoning) {
  if (reasoning === undefined) return { ...DEFAULT_REASONING };
  if (reasoning === null) return null;
  const valid = typeof reasoning === 'object' && !Array.isArray(reasoning)
    && Object.keys(reasoning).length > 0 && Object.keys(reasoning).every(k => k === 'enabled' || k === 'effort')
    && (reasoning.enabled === undefined || typeof reasoning.enabled === 'boolean')
    && (reasoning.effort === undefined || REASONING_EFFORTS.includes(reasoning.effort));
  if (!valid) throw new TypeError(`reasoning must be null or {enabled?: boolean, effort?: ${REASONING_EFFORTS.join('|')}}`);
  return { ...reasoning };
}
function reasoningRequest(reasoning) {
  if (!reasoning) return {};
  return {
    ...(reasoning.enabled !== undefined ? { reasoningEnabled: reasoning.enabled } : {}),
    ...(reasoning.effort !== undefined ? { reasoningEffort: reasoning.effort } : {}),
  };
}

/**
 * createInterpreter({llm, mixedPolicy, timeoutMs, maxTokens, reasoning, onStats}) → interpret({text, state, signal})
 * - llm: object with completeJson (from baseline/llm). Omit it to use rules only (no network).
 * - mixedPolicy: 'ask_first' (default) or 'apply_confirmed'.
 * - timeoutMs: whole-interpreter limit. When hit, throws LlmError('timeout') like the transport does.
 * - maxTokens: number or {extract, classify}; default DEFAULT_MAX_TOKENS.
 * - reasoning: see resolveReasoning; default off.
 * - onStats: receives {promptVersion, llmCalls, latencyMs, usage, timedOut, timeoutSource, path, claims, calls, skipped}
 *   after each call. calls[] holds one diagnostic per LLM request; no key and no raw response.
 */
export function createInterpreter({ llm = null, mixedPolicy = 'ask_first', timeoutMs = DEFAULT_TIMEOUT_MS, maxTokens, reasoning, onStats } = {}) {
  if (llm !== null && typeof llm?.completeJson !== 'function') throw new TypeError('llm must provide completeJson');
  if (!MIXED_POLICIES.includes(mixedPolicy)) throw new TypeError(`mixedPolicy must be one of ${MIXED_POLICIES.join(', ')}`);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new TypeError('timeoutMs must be 1..120000');
  if (onStats !== undefined && typeof onStats !== 'function') throw new TypeError('onStats must be a function');
  const limits = resolveMaxTokens(maxTokens);
  const thinking = resolveReasoning(reasoning);

  return async function interpret({ text, state, signal } = {}) {
    const started = performance.now();
    const stats = { promptVersion: PROMPT_VERSION, llmCalls: 0, latencyMs: 0, usage: {}, timedOut: false, timeoutSource: null, path: ['rules'], claims: [], calls: [], skipped: null };
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { stats.timedOut = true; stats.timeoutSource = 'interpreter'; controller.abort(); reject(new LlmError('timeout')); }, timeoutMs);
    });
    deadline.catch(() => {});
    const callSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;

    const ask = async (stage, { validate, ...request }) => {
      stats.llmCalls++; stats.path.push(`llm_${stage}`);
      const diag = { stage, maxTokens: limits[stage], reasoning: thinking ? { ...thinking } : null, errorCode: null, limit: null, validateCalled: false, rejectReason: null, clientStageFailure: false, note: null, completionTokens: null, latencyMs: 0 };
      stats.calls.push(diag);
      const checked = async data => {
        diag.validateCalled = true;
        try {
          const ok = await validate(data);
          if (ok === false) diag.rejectReason = 'returned_false';
          return ok;
        } catch (error) { diag.rejectReason = error?.reason ?? 'validate_error'; throw error; }
      };
      const t0 = performance.now();
      try {
        const result = await Promise.race([
          llm.completeJson({ temperature: 0, ...request, ...reasoningRequest(thinking), maxTokens: limits[stage], validate: checked, signal: callSignal }),
          deadline,
        ]);
        addUsage(stats.usage, result.usage);
        if (Number.isSafeInteger(result.usage?.completion_tokens)) diag.completionTokens = result.usage.completion_tokens;
        return result.data;
      } catch (error) {
        if (stats.timeoutSource === 'interpreter') { diag.errorCode = 'timeout'; diag.limit = 'interpreter'; }
        else {
          diag.errorCode = error?.code ?? 'error';
          if (diag.errorCode === 'timeout') { diag.limit = 'transport'; stats.timedOut = true; stats.timeoutSource = 'transport'; }
        }
        diag.clientStageFailure = diag.errorCode === 'invalid_response' && !diag.validateCalled;
        if (diag.clientStageFailure) diag.note = CLIENT_STAGE_NOTE;
        throw error;
      } finally { diag.latencyMs = Math.round(performance.now() - t0); }
    };

    try {
      return await interpretOnce({ text, state: structuredClone(state), llm, ask, mixedPolicy, stats });
    } catch (error) {
      // Same contract as the transport (LLM-USAGE.md §6): the host sees the error and keeps state.
      if (stats.timeoutSource === 'interpreter') throw new LlmError('timeout');
      throw error;
    } finally {
      clearTimeout(timer);
      stats.latencyMs = Math.round(performance.now() - started);
      if (onStats) { try { onStats(structuredClone(stats)); } catch { /* reporting must not change the result */ } }
    }
  };
}

async function interpretOnce({ text, state, llm, ask, mixedPolicy, stats }) {
  const analysis = analyze(text, state);
  let claims = analysis.claims;
  if (!analysis.complete) {
    // A gift condition already guarantees "guidance question, no change" under ask_first,
    // whatever the LLM would add, so the call is skipped.
    const hasCondition = claims.some(c => CONDITION_KINDS.includes(c.kind));
    if (hasCondition && (mixedPolicy === 'ask_first' || !llm)) { stats.skipped = 'condition_found_by_rules'; return copy(CONDITION); }
    if (!llm) return copy(GENERIC);
    const data = await ask('extract', { messages: extractionMessages({ text, state }), validate: d => validateExtraction(d, text) });
    claims = data.claims.map(c => ({ ...c, ...ownerForSpan(c.span, analysis, state) }));
  }
  if (!claims.length) return copy(GENERIC);

  // Subject guard: without a subject marker the owner is unknown, whatever the LLM would answer,
  // so the classification call is not made for such claims. Direct gift instructions are owned by rules.
  for (const c of claims) {
    if (c.owner === null && !isOwnerFree(c) && !hasSubjectMarker(c.span, analysis)) { c.owner = 'unknown'; c.reason = 'no_subject_guard'; }
  }

  // Kind before owner: conditions and `other` never need a classification call.
  const pending = claims.filter(c => c.owner === null && !isOwnerFree(c));
  if (pending.length && !llm) pending.forEach(c => { c.owner = 'unknown'; c.reason = 'no_llm'; });
  else if (pending.length) {
    const ids = pending.map((_, i) => `c${i}`);
    const sent = pending.map((c, i) => ({ id: ids[i], span: c.span, kind: c.kind, value: c.value, polarity: c.polarity }));
    const data = await ask('classify', { messages: classificationMessages({ text, state, claims: sent }), validate: d => validateClassification(d, ids) });
    const owners = new Map(data.owners.map(o => [o.id, o.owner]));
    pending.forEach((c, i) => { c.owner = owners.get(ids[i]); c.reason = 'llm'; });
  }
  stats.claims = claims.map(({ span, kind, value, polarity, strength, owner, reason }) => ({ span, kind, value, polarity, strength, owner: owner ?? null, reason: isOwnerFree({ kind }) ? 'kind_first' : reason }));

  const result = routeClaims(state, claims, mixedPolicy);
  checkedPatch(state, result.patch); // common schema check; throws invalid_input
  return result;
}
