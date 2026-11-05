// P8 ① dialogue understanding on main's prototype chatbot (PROTO-REBASE §2, K55).
// proto fastRuleTurn -> llmTurn (key) -> singleTurn (no key), run on the public "one gift" state, exactly as main's worker.
// The answer is turned into a baseline utterance patch; ② memory, ③ mapping, merge, runTurn, planner and template tags
// stay in the orchestrator (recommend()), which this module feeds. Nothing here ranks, scores or prices (K1).
import { fastRuleTurn, singleTurn, publicState, engineState, singleQuestion } from '../proto/lib/single-gift.mjs';
import { llmTurn, geminiFailure, validateRequest, GeminiError } from '../proto/lib/llm.mjs';
import { LlmError } from '../llm/errors.mjs';
import { failureCode } from '../llm/openai-compatible.mjs';
import { extract, initial as protoInitial, differences } from '../proto/lib/engine.mjs';
import { mentionedAllergens } from '../proto/lib/allergens.mjs';
import { checkKey, parseKey } from '../memory/keys.mjs';
import { splitCritiques } from '../dialogue/agent.mjs';
import { KNOWN_GROUPS } from './recipients.mjs';
import { BaselineError } from '../../../src/index.mjs';

export const LIST_FIELDS = ['preferences', 'excluded_categories', 'excluded_ingredients'];
// proto's rules ask this when "저렴" comes without an amount; condition B answers with the 아끼기 chip instead (K51)
export const NEW_BUDGET_ISSUE = '원하는 새 예산 상한을 알려주세요.';
const DEMO_ISSUE = '이 데모는'; // proto's rules fallback question; it is dropped by proto on the next turn anyway

const ALIASES = [['엄마', '어머니'], ['어머님', '어머니'], ['아빠', '아버지'], ['아버님', '아버지']];
const canon = s => ALIASES.reduce((t, [a, b]) => t.replaceAll(a, b), String(s ?? '').normalize('NFC').trim());
const uniq = a => [...new Set(a)];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** 부모님 = 어머니 + 아버지 (R9 fixed relation, K24); other names stand for themselves. */
const people = names => uniq(names.map(canon).flatMap(n => { const m = Object.keys(KNOWN_GROUPS).filter(k => KNOWN_GROUPS[k] === n); return m.length ? m : [n]; })).sort();
export const samePeople = (a, b) => same(people(a), people(b));
// AC7: allergies stay whenever one of the previous people is still a recipient (부모님 -> 어머니 narrows, never drops)
const overlaps = (next, prev) => { const n = people(next); return people(prev).some(p => n.includes(p)); };

/**
 * main switchRecipient (mobile personalization.ts): a turn that names other people starts their lists and open questions
 * from empty, so the previous person's tastes never leak (main docs/personalization.md rule 1). Allergies are kept when
 * the new and old people overlap (어머니 -> 부모님, P1 보완; 부모님 -> 어머니, review): an allergy said in this session never
 * disappears while anyone it may belong to is still a recipient (AC7, AGENTS.md). For anyone else they belong to someone who is no longer in the turn.
 */
function switchTo(state, recipients) {
  return { ...structuredClone(state), recipients, preferences: [], excluded_categories: [], excluded_ingredients: overlaps(recipients, state.recipients) ? [...state.excluded_ingredients] : [] };
}

/** L1 candidates are proposals: the person must be named in the sentence and the evidence must be the user's own words. */
function memoryCandidates(raw, text) {
  const t = canon(text), out = [];
  for (const c of Array.isArray(raw) ? raw : []) {
    const recipientName = canon(c?.recipient), evidence = String(c?.evidence ?? '').normalize('NFC').trim();
    const k = parseKey(c?.key);
    if (!k || !checkKey(c.key, c.polarity).ok || !recipientName || !t.includes(recipientName) || !evidence || !String(text).normalize('NFC').includes(evidence)) continue;
    if (k.kind === 'allergy' && !mentionedAllergens(evidence).includes(k.value)) continue; // AC7: an allergy only from its own name
    if (!out.some(x => x.recipientName === recipientName && x.key === c.key && x.polarity === c.polarity)) out.push({ recipientName, key: c.key, polarity: c.polarity, evidence, basis: 'explicit' });
  }
  return out;
}

/** K72: an OpenAI-compatible client error (HTTP status / timeout) becomes main's failure code, so the trace keeps its names. */
const asProtoError = e => (e instanceof LlmError ? new GeminiError(failureCode(e), Number(e.detail) || 0) : e);

/**
 * createProtoDialogue({llm}) -> {understand}
 * llm: null (rules, like main without a key) or llmTurn options: {apiKey, model?, fetcher?, timeoutMs?, thinkingBudget?}
 * (Gemini) or {generate, timeoutMs?} (the shared OpenAI-compatible client, K72).
 * The key is only passed through to proto llmTurn; it is never logged or returned.
 */
export function createProtoDialogue({ llm = null } = {}) {
  /**
   * understand({text, state (baseline), issues, history?, source?, products})
   * -> {failure} (LLM error: nothing changes, main's 503 message)
   *  | {patch, said, issues, mode, changed, memoryCandidates, cheaper, unsupported}
   * `patch` is a baseline patch against `state`: every field when the people change (baseline resets on a recipient
   * change), otherwise only the fields that differ. quantity 1 / same product / per-set scope come from engineState.
   */
  async function understand({ text, state, issues = [], history = [], source = 'typed', products }) {
    const original = publicState(state);
    let before = original, open = issues;
    const mentioned = typeof text === 'string' ? extract(text, protoInitial()).patch.recipients : undefined;
    if (mentioned?.length && original.recipients.length && !samePeople(mentioned, original.recipients)) { before = switchTo(original, mentioned); open = []; }
    let input;
    try { input = validateRequest({ state: before, issues: open, text, history, source }); } catch { throw new BaselineError('invalid_request'); }
    let turn = fastRuleTurn(input, products), mode = 'rules_fast';
    if (!turn && llm) {
      try { turn = await llmTurn(input, products, llm); mode = 'llm'; }
      catch (e) { return { failure: geminiFailure(asProtoError(e)) }; }
    } else if (!turn) { turn = singleTurn({ state: input.state, issues: input.issues }, input.text, products); mode = 'rules'; }

    let after = turn.session.state;
    // the LLM named other people than the rules saw: same rule as above, the old person's lists do not carry over
    if (before.recipients.length && after.recipients.length && !samePeople(after.recipients, before.recipients)) {
      const switched = switchTo(before, after.recipients);
      for (const f of LIST_FIELDS) after = { ...after, [f]: uniq([...switched[f], ...after[f].filter(v => !before[f].includes(v))]) };
    }
    // K44 critique phrases stay a b-pipeline extension on top of main: "덜 달게·덜 단·안 단" add less_sweet even when main's
    // rules do not know the phrase, and a sentence with any critique phrase is understood (no rules-demo question).
    const c = splitCritiques(text);
    const missing = c.preferences.filter(v => !after.preferences.includes(v));
    if (missing.length) after = { ...after, preferences: [...after.preferences, ...missing] };
    let nextIssues = turn.session.issues;
    if (c.preferences.length || c.cheaper || c.unsupported.length) nextIssues = nextIssues.filter(q => !isDemoIssue(q));
    const target = engineState(after);
    const peopleChanged = !same(after.recipients, state.recipients);
    const patch = {};
    for (const k of Object.keys(target)) if (peopleChanged || !same(target[k], state[k])) patch[k] = structuredClone(target[k]);
    // K44: a list value counts as said this turn only if it is new to the state the dialogue saw
    const said = LIST_FIELDS.flatMap(field => after[field].filter(v => !before[field].includes(v)).map(value => ({ field, value })));
    return {
      patch, said, issues: nextIssues, mode,
      changed: differences(original, after).length > 0,
      memoryCandidates: memoryCandidates(turn.memory, text),
      cheaper: c.cheaper, unsupported: c.unsupported,
    };
  }
  return { understand };
}

/** main's next question for a baseline state (AC2: the same one question main asks). */
export const protoQuestion = (state, issues = []) => singleQuestion({ state: publicState(state), issues });
export const isDemoIssue = q => typeof q === 'string' && q.startsWith(DEMO_ISSUE);
