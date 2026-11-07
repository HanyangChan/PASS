// LLM output validation and claim routing. The LLM never writes patches or questions.
import {
  ALLERGEN_NAMES, CATEGORIES, CLAIM_KINDS, CONDITION_KINDS, OWNER_FREE_KINDS, OWNERS, POLARITIES, STRENGTHS,
  SWEETNESS_VALUES, PATCH_FIELDS, QUESTIONS,
  unknownQuestion, confirmExclusionQuestion, confirmReleaseQuestion, unsupportedQuestion,
} from './vocabulary.mjs';

const MAX_CLAIMS = 10;
const CLAIM_KEYS = 'kind,polarity,span,strength,value';
const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const keysAre = (x, keys) => Object.keys(x).sort().join() === keys;

/** Thrown by the validators. reason is a short code recorded in diagnostics (never the raw response). */
export class InvalidLlmOutput extends TypeError {
  constructor(reason) { super(`invalid_llm_output: ${reason}`); this.name = 'InvalidLlmOutput'; this.reason = reason; }
}
const reject = reason => { throw new InvalidLlmOutput(reason); };

export const isOwnerFree = c => OWNER_FREE_KINDS.includes(c.kind);

function checkClaim(c, text) {
  if (!isObject(c) || !keysAre(c, CLAIM_KEYS)) reject('claim_keys');
  if (typeof c.span !== 'string' || !c.span.trim() || c.span.length > 200 || !text.includes(c.span.trim())) reject('span');
  if (!CLAIM_KINDS.includes(c.kind)) reject('kind');
  if (isOwnerFree(c)) {
    if (c.value !== null || c.polarity !== null || c.strength !== null) reject('owner_free_fields');
    return;
  }
  if (!POLARITIES.includes(c.polarity)) reject('polarity');
  if (c.kind === 'sweetness') {
    if (c.polarity === 'avoid' ? !SWEETNESS_VALUES.includes(c.value) : c.value !== null) reject('sweetness_value');
    if (c.strength !== null && !STRENGTHS.includes(c.strength)) reject('strength');
    return;
  }
  const vocabulary = c.kind === 'ingredient' ? ALLERGEN_NAMES : CATEGORIES;
  if (!vocabulary.includes(c.value)) reject('value_vocabulary');
  if (c.polarity === 'avoid' ? !STRENGTHS.includes(c.strength) : c.strength !== null) reject('strength');
}

/** validate callback for the extraction step: {claims:[...]} only. */
export function validateExtraction(data, text) {
  if (!isObject(data) || !keysAre(data, 'claims') || !Array.isArray(data.claims) || data.claims.length > MAX_CLAIMS) reject('extraction_shape');
  for (const c of data.claims) checkClaim(c, text);
  return true;
}

/** validate callback for the classification step: exactly one owner per sent id. */
export function validateClassification(data, ids) {
  if (!isObject(data) || !keysAre(data, 'owners') || !Array.isArray(data.owners) || data.owners.length !== ids.length) reject('classification_shape');
  const seen = new Set();
  for (const o of data.owners) {
    if (!isObject(o) || !keysAre(o, 'id,owner') || !ids.includes(o.id) || seen.has(o.id) || !OWNERS.includes(o.owner)) reject('owner_entry');
    seen.add(o.id);
  }
  return true;
}

/** The state field and value a recipient claim would add, or null when it adds nothing directly. */
export function claimPatchValue(c) {
  if (c.kind === 'ingredient' && c.polarity === 'avoid') return { field: 'excluded_ingredients', value: c.value };
  if (c.kind === 'category' && c.polarity === 'avoid') return { field: 'excluded_categories', value: c.value };
  if (c.kind === 'category' && c.polarity === 'prefer') return { field: 'preferences', value: `category:${c.value}` };
  if (c.kind === 'sweetness' && c.polarity === 'avoid') return { field: 'preferences', value: c.value };
  return null;
}

/** Turn a recipient claim into an addition or a question. Strength is judged only after ownership. */
function routeRecipient(c, state, additions, questions) {
  const has = (field, value) => state[field].includes(value);
  if (c.kind === 'sweetness') {
    if (c.polarity === 'avoid') return additions.preferences.push(c.value);
    if (SWEETNESS_VALUES.some(v => has('preferences', v))) return questions.push(confirmReleaseQuestion(c));
    if (c.polarity === 'prefer') questions.push(unsupportedQuestion(c));
    return undefined;
  }
  const field = c.kind === 'ingredient' ? 'excluded_ingredients' : 'excluded_categories';
  if (c.polarity === 'avoid') {
    if (c.strength === 'strong') return additions[field].push(c.value);
    if (!has(field, c.value)) questions.push(confirmExclusionQuestion(c));
    return undefined;
  }
  if (c.polarity === 'allow') {
    if (has(field, c.value)) questions.push(confirmReleaseQuestion(c));
    return undefined;
  }
  // prefer
  if (c.kind === 'category') return additions.preferences.push(`category:${c.value}`);
  return questions.push(unsupportedQuestion(c));
}

/**
 * Route claims. Kind first: gift conditions and `other` never become patches, whoever said them,
 * and their guidance question comes first. Then owner: giver → dropped, recipient → patch or
 * confirmation, unknown → question. mixedPolicy decides what happens when patches and questions meet.
 */
export function routeClaims(state, claims, mixedPolicy) {
  const additions = { preferences: [], excluded_ingredients: [], excluded_categories: [] };
  const guidance = [], questions = [];
  for (const c of claims) {
    if (CONDITION_KINDS.includes(c.kind)) { if (!guidance.includes(QUESTIONS.condition)) guidance.push(QUESTIONS.condition); continue; }
    if (c.kind === 'other') { guidance.push(unsupportedQuestion(c)); continue; }
    if (c.owner === 'giver') continue;
    if (c.owner === 'unknown') questions.push(unknownQuestion(c));
    else if (c.owner === 'recipient') routeRecipient(c, state, additions, questions);
    else throw new TypeError('claim without owner');
  }
  const asked = [...guidance, ...questions];
  const patch = {};
  for (const field of PATCH_FIELDS) {
    const merged = [...new Set([...state[field], ...additions[field]])];
    if (merged.length !== state[field].length) patch[field] = merged;
  }
  if (!asked.length) return { patch, questions: [], unresolved: false };
  if (mixedPolicy === 'apply_confirmed' && Object.keys(patch).length) return { patch, questions: [asked[0]], unresolved: false };
  return { patch: {}, questions: [asked[0]], unresolved: true };
}
