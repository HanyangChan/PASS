// Rule-first analysis: split clauses, extract claims, decide owners only when the subject is clear.
// When unsure the rules return "unparsed" (send to the LLM) or owner null (classify or ask). They never guess.
import { mentionedAllergens } from '../../src/vendor/allergens.mjs';
import { CATEGORY_WORDS, OTHER_PEOPLE, RECIPIENT_ALIASES } from './vocabulary.mjs';

// Quotes and reported speech: a first person inside them is not the giver.
const QUOTED = /['"“”‘’]|라고|(?:래|대)(?:요)?(?=[\s.!?,~]|$)|하셨어|하시더라|그러시더라|그러셨/;
// "…라고/다고 하셨어" is reported speech, not a clause boundary.
const SPLIT = /[.!?;\n]+|,\s*|(?<=[가-힣])(?:인데|은데|는데|지만)\s+|(?<=[가-힣])(?<![라다])고\s+|(?:^|\s)(?:그리고|근데|그런데|하지만)\s+/;
// Negation, double negation and tense change the meaning; rules stop and hand over to the LLM.
const NEEDS_LLM = /안\s*싫|싫지\s*않|아니|없|예전|요즘|작년|올해|부터|였는데|었는데|았는데|했는데|나았|나으|괜찮/;
const UNSWEETENED = /단맛\s*(?:이\s*)?없(?:는|이)?|무가당|무설탕|설탕\s*(?:이\s*)?(?:안\s*(?:들어간|든|넣은)|없는|빠진)/g;
const LESS_SWEET = /덜\s*(?:단|달)/;
const SWEET_WORD = /설탕|(?<![가-힣])단\s*(?:것|거|걸|건|게|음식|간식)|단것|단거|달달|달콤/;
const AVOID_STRONG = /알레르기|알러지|못\s*(?:먹|드)|먹으면\s*안|드시면\s*안|빼|제외|피하|피해|안\s*(?:돼|되)|넣지\s*마/;
const AVOID_WEAK = /싫|별로|안\s*좋아|꺼려|줄이|줄여|안\s*드|안\s*먹/;
const PREFER = /좋아|선호|즐겨/;
const INSTRUCTION = /빼\s*(?:줘|주세요|줄래|주라|줘요|고)|제외(?:해)?\s*(?:줘|주세요)|넣지\s*마/;
const FILLER = /추천해\s*(?:줘|주세요)|골라\s*(?:줘|주세요)|추천|선물|부탁(?:해|드려요)?|해\s*줘|[\s.,!?~]/g;
// Gift conditions, recognised before tastes. Kept narrow ("비싼" etc. go to the LLM).
const CONDITION_WORDS = [
  ['budget', /예산|\d+(?:\.\d+)?\s*(?:만\s*원|천\s*원|원)|배송비/],
  ['quantity', /(?<![가-힣])(?:한|두|세|네|다섯|\d+)\s*(?:개|세트)(?![가-힣])|수량/],
  ['delivery', /배송일|도착|날짜|(?:까지|전에)\s*(?:와|받|보내)/],
  ['recipient', /수령인|받는\s*(?:사람|분)\s*(?:을|를)?\s*(?:바꿔|변경)/],
];
const GIVER = /(?<![가-힣])(?:나는|난|나도|저는|저도|내가|제가)(?![가-힣])/;
const PEOPLE = [...Object.keys(RECIPIENT_ALIASES), ...OTHER_PEOPLE].sort((a, b) => b.length - a.length);
const PERSON = new RegExp(`(?<![가-힣])(${PEOPLE.join('|')})(?=(?:께서는|께서|한테는|은|는|이|가|도)(?![가-힣]))`, 'g');

export const isQuoted = text => QUOTED.test(text);
export const splitClauses = text => text.split(SPLIT).map(s => s?.trim()).filter(Boolean);

function polarityOf(clause) {
  if (AVOID_STRONG.test(clause)) return { polarity: 'avoid', strength: 'strong' };
  if (AVOID_WEAK.test(clause)) return { polarity: 'avoid', strength: 'weak' };
  if (PREFER.test(clause)) return { polarity: 'prefer', strength: null };
  return null;
}

/** Claims in one clause: [] for filler, null when the rules cannot read it. */
export function extractClause(clause) {
  // Kind before owner: a gift condition makes the whole clause a condition claim.
  const conditions = CONDITION_WORDS.filter(([, pattern]) => pattern.test(clause))
    .map(([kind]) => ({ span: clause, kind, value: null, polarity: null, strength: null }));
  if (conditions.length) return conditions;
  const claims = [];
  let rest = clause;
  if (UNSWEETENED.test(rest)) {
    claims.push({ span: clause, kind: 'sweetness', value: 'unsweetened', polarity: 'avoid', strength: null });
    rest = rest.replace(UNSWEETENED, ' ');
  }
  UNSWEETENED.lastIndex = 0;
  if (NEEDS_LLM.test(rest)) return null;
  const tone = polarityOf(rest);
  if (!claims.length && LESS_SWEET.test(rest)) claims.push({ span: clause, kind: 'sweetness', value: 'less_sweet', polarity: 'avoid', strength: null });
  else if (!claims.length && SWEET_WORD.test(rest)) {
    if (!tone) return null;
    claims.push(tone.polarity === 'avoid'
      ? { span: clause, kind: 'sweetness', value: 'less_sweet', polarity: 'avoid', strength: null }
      : { span: clause, kind: 'sweetness', value: null, polarity: tone.polarity, strength: null });
  }
  for (const name of mentionedAllergens(rest)) {
    if (!tone) return null;
    claims.push({ span: clause, kind: 'ingredient', value: name, ...tone });
  }
  for (const [category, pattern] of CATEGORY_WORDS) {
    if (!pattern.test(rest)) continue;
    if (!tone) return null;
    // Category exclusions are strong only for a direct instruction; "안 드셔" alone stays a dislike.
    const strength = tone.polarity === 'avoid' ? (INSTRUCTION.test(rest) || /제외/.test(rest) ? 'strong' : 'weak') : null;
    claims.push({ span: clause, kind: 'category', value: category, polarity: tone.polarity, strength });
  }
  if (claims.length) return claims;
  return clause.replace(FILLER, '') === '' ? [] : null;
}

/** Owner by subject words. Returns owner null when rules must not decide. */
export function ruleOwner(clause, state, quoted) {
  if (quoted) return { owner: null, reason: 'quoted' };
  const giver = GIVER.test(clause);
  const named = [...clause.matchAll(PERSON)].map(m => RECIPIENT_ALIASES[m[1]] ?? m[1]);
  const current = named.filter(name => state.recipients.includes(name));
  const others = named.filter(name => !state.recipients.includes(name));
  const kinds = Number(giver) + Number(current.length > 0) + Number(others.length > 0);
  if (kinds > 1) return { owner: null, reason: 'ambiguous_subject' };
  if (giver) return { owner: 'giver', reason: 'first_person' };
  if (current.length) return { owner: 'recipient', reason: 'recipient_subject' };
  if (others.length) return { owner: 'unknown', reason: 'third_party', person: others[0] };
  if (INSTRUCTION.test(clause)) return { owner: 'recipient', reason: 'gift_instruction' };
  return { owner: null, reason: 'no_subject' };
}

/** Whole-message rule pass. complete=false means at least one clause needs the LLM extractor. */
export function analyze(text, state) {
  const quoted = isQuoted(text);
  const clauses = splitClauses(text);
  const claims = [];
  const parsed = [];
  let complete = clauses.length > 0;
  for (const clause of clauses) {
    const found = extractClause(clause);
    parsed.push(found !== null);
    if (found === null) { complete = false; continue; }
    const owner = ruleOwner(clause, state, quoted);
    for (const c of found) claims.push({ ...c, ...owner });
  }
  return { text, quoted, clauses, parsed, claims, complete };
}

const squash = s => s.replace(/\s+/g, '');
/** Length of the longest common substring (spaces ignored). */
function commonLength(a, b) {
  a = squash(a); b = squash(b);
  let best = 0;
  const row = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = a[i - 1] === b[j - 1] ? diagonal + 1 : 0;
      if (row[j] > best) best = row[j];
      diagonal = above;
    }
  }
  return best;
}

/**
 * The clause an LLM span belongs to: the one that contains it, else the one it overlaps most.
 * Returns -1 when nothing overlaps meaningfully (at least 2 characters) or two clauses tie.
 */
export function bestClause(span, analysis) {
  const target = squash(span);
  let best = -1, bestLength = 0, tie = false;
  analysis.clauses.forEach((clause, i) => {
    const length = squash(clause).includes(target) ? target.length : commonLength(clause, span);
    if (length > bestLength) { best = i; bestLength = length; tie = false; }
    else if (length === bestLength && length > 0) tie = true;
  });
  return best < 0 || tie || bestLength < Math.min(2, target.length) ? -1 : best;
}

/** Scope for subject checks: the quoted message as a whole, otherwise only the span's clause. */
function scopeOf(span, analysis) {
  if (analysis.quoted) return analysis.text;
  const i = bestClause(span, analysis);
  return i < 0 ? null : analysis.clauses[i];
}

const PERSON_ONCE = new RegExp(PERSON.source);
/**
 * Subject guard: does the claim's scope name who it is about? Markers are a first-person word,
 * a person/recipient alias with a particle, or (for quoted speech) the quoted speaker anywhere in the message.
 * A direct gift instruction ("견과류는 빼줘") also counts. The scope never widens to other clauses.
 */
export function hasSubjectMarker(span, analysis) {
  const scope = scopeOf(span, analysis);
  return scope !== null && (GIVER.test(scope) || PERSON_ONCE.test(scope) || INSTRUCTION.test(scope));
}

/** Supplementary defense: the scope names another person and not the current recipient. */
export function otherSubjectOnly(span, analysis, state) {
  const scope = scopeOf(span, analysis);
  if (scope === null) return false;
  const named = [...scope.matchAll(PERSON)].map(m => RECIPIENT_ALIASES[m[1]] ?? m[1]);
  return named.some(n => !state.recipients.includes(n)) && !named.some(n => state.recipients.includes(n));
}

/** Owner for an LLM-extracted span, judged by the clause it belongs to (contained or most overlapped). */
export function ownerForSpan(span, analysis, state) {
  const i = bestClause(span, analysis);
  return i < 0 ? { owner: null, reason: 'span_unmapped' } : ruleOwner(analysis.clauses[i], state, analysis.quoted);
}
