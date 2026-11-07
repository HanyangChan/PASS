import { extract, initial } from '../../src/vendor/engine.mjs';
import { mentionedAllergens } from '../../src/vendor/allergens.mjs';

// Person-level facts belong to whoever the clause is about; gift-level facts (budget, date,
// recipient, packaging) describe the gift no matter who says them.
export const PERSON_FIELDS = ['preferences', 'excluded_categories', 'excluded_ingredients'];
const ALIASES = { 엄마: '어머니', 아빠: '아버지', 상사: '직장 상사' };
const PEOPLE = /(직장 상사|어머니|아버지|엄마|아빠|부모님|처가|교수님|상사|동료|친구|동창)/g;
const GIVER = /(?:^|[\s,])(?:나는|난|저는|전|내가|제가|나도|저도|(?:내|제)\s*취향(?:은|이|으로)?)(?=[\s,]|$)/;
const VAGUE = /중에|한\s*분|누군가|둘\s*중|누구/;
const NEGATION = /못\s*(?:하|드|먹|쓰)|안\s*(?:좋|드|먹|하|쓰)|싫|별로|부담/;
const SPLIT = /[.,!?;\n]+|\s+(?:그리고|하지만|근데|그런데)\s+|(?<=데|지만|[가-힣]고|으며|면서)\s+/;
// Words that carry no condition, so a clause made only of them needs no interpretation.
const FILLER = /선물|추천|해줘|싶어\s*하|하고|하는|하셔|하세요|갖고|해 줘|해주세요|골라|줘|좀|요|싶어|싶은데|하려고|부탁|드려|드릴|할게|뭐가|좋을까|좋을지|에게|한테|으로|로|이번|그냥|우리|요즘|하나|정도|있어|있는|이야|거야|같아|해|게|걸|것|데|은|는|이|가|을|를|도|의/g;

// Parts the rules or other agents already cover: names, money, occasions (the occasion agent's job).
const COVERED = /(?:직장 상사|어머니|아버지|엄마|아빠|부모님|처가|교수님|상사|동료|친구들?|동창)(?:은|는|이|가|께서|께|도|의|에게|한테)?|\d+(?:\.\d+)?\s*(?:만\s*원|천\s*원|원)|이하|이내|예산|배송비\s*(?:포함|별도)|상품값|세트당|생일|생신|기념일|명절|추석|한가위|설날|어버이날|스승의\s*날|어린이날|발렌타인데이|화이트데이|빼빼로데이|크리스마스|성탄절?|드리려고|드리고|드릴까/g;

export const canonicalPerson = name => Object.hasOwn(ALIASES, name) ? ALIASES[name] : name;
const people = text => [...new Set([...text.matchAll(PEOPLE)].map(m => canonicalPerson(m[1])))];
const clauses = text => text.split(SPLIT).map(c => c?.trim()).filter(Boolean);
const meaningful = clause => clause.replace(COVERED, '').replace(FILLER, '').replace(/[^가-힣a-zA-Z]/g, '').length >= 2;

/**
 * Rule attribution: split into clauses, decide whose clause it is, reuse the common `extract`
 * per clause and keep person-level facts only when they belong to the gift's recipient.
 * Returns `needsLlm` when a meaningful clause was not understood.
 */
export function attributeRules(text, state) {
  const named = people(text);
  const target = state.recipients[0] ?? (named.length === 1 ? named[0] : null);
  if (!target && named.length > 1) return { patch: {}, questions: ['이번에 선물할 분 한 명을 알려주세요.'], unresolved: true, items: [], needsLlm: false, target };
  let acc = structuredClone(state), holder = 'recipient', person = target, needsLlm = false;
  const touched = new Set(), items = [], questions = [];
  for (const clause of clauses(text)) {
    const here = people(clause);
    if (here.length) [holder, person] = here.includes(target) || !target ? ['recipient', here.includes(target) ? target : here[0]] : ['other', here[0]];
    else if (GIVER.test(clause)) [holder, person] = ['giver', null];
    const allergy = /알레르기|알러지|못\s*드|못\s*먹/.test(clause);
    if (allergy && (here.length > 1 || VAGUE.test(clause))) {
      for (const value of mentionedAllergens(clause)) items.push({ holder: 'unclear', person: null, field: 'excluded_ingredients', value, clause, applied: false });
      questions.push(`${mentionedAllergens(clause).join('·') || '그'} 알레르기는 누구에게 해당하나요?`);
      continue;
    }
    const own = holder === 'recipient';
    // The common extractor reads "건강식품" as food too and misses negations such as "안 좋으셔서".
    const { patch, questions: asked } = extract(clause.replaceAll('건강식품', '건강'), own ? acc : { ...initial(), recipients: acc.recipients });
    if (NEGATION.test(clause)) {
      delete patch.preferences;
      if (!PERSON_FIELDS.some(k => patch[k])) needsLlm = true;
    }
    const keys = Object.keys(patch);
    // Understanding only the name or the budget is not understanding the clause.
    if (!PERSON_FIELDS.some(k => patch[k]) && meaningful(clause)) needsLlm = true;
    if (!keys.length) continue;
    for (const key of keys) {
      if (key === 'recipients' && !own) continue;
      const before = own ? acc[key] : [];
      const values = PERSON_FIELDS.includes(key) ? patch[key].filter(v => !before.includes(v)) : [patch[key]];
      const applied = own || !PERSON_FIELDS.includes(key);
      for (const value of values) items.push({ holder: PERSON_FIELDS.includes(key) ? holder : 'gift', person: PERSON_FIELDS.includes(key) ? person : null, field: key, value, clause, applied });
      if (applied) { acc = { ...acc, [key]: key === 'budget' ? { ...acc.budget, ...patch.budget } : patch[key] }; touched.add(key); }
    }
    if (own) questions.push(...asked);
  }
  const patch = Object.fromEntries([...touched].map(k => [k, acc[k]]));
  return { patch, questions: [...new Set(questions)], unresolved: questions.length > 0, items, needsLlm, target };
}

/**
 * Full C step: rules first, then at most one LLM call for clauses the rules did not understand.
 * `llm({text,state})` returns the same shape as attributeRules (see output.mjs).
 */
export async function attribute({ text, state, llm }) {
  const rules = attributeRules(text, state);
  if (!rules.needsLlm) return { ...rules, provider: 'rules', llmCalls: 0 };
  if (!llm) {
    if (Object.keys(rules.patch).length || rules.unresolved) return { ...rules, provider: 'rules', llmCalls: 0 };
    return { ...rules, unresolved: true, questions: ['받는 사람의 취향이나 피해야 할 것을 조금 더 구체적으로 알려주세요.'], provider: 'rules', llmCalls: 0 };
  }
  try {
    return { ...(await llm({ text, state })), provider: 'llm', llmCalls: 1 };
  } catch {
    // A failed or slow LLM never fails the turn: keep the conditions and ask instead.
    return { ...rules, patch: {}, unresolved: true, questions: ['지금은 그 말씀을 정확히 이해하지 못했어요. 받는 사람의 취향이나 피해야 할 것을 조금 더 구체적으로 알려주세요.'], provider: 'llm_failed', llmCalls: 1 };
  }
}
