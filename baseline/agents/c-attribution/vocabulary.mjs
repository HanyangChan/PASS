// Fixed vocabulary for the attribution interpreter. Values come from the frozen engine snapshot.
import { ALLERGEN_NAMES } from '../../src/vendor/allergens.mjs';
import { CATEGORIES, CATEGORY_NAMES } from '../../src/vendor/catalog.mjs';

export { ALLERGEN_NAMES, CATEGORIES, CATEGORY_NAMES };

export const OWNERS = Object.freeze(['giver', 'recipient', 'unknown']);
/** Taste/constraint kinds: routed by owner. */
export const PREFERENCE_KINDS = Object.freeze(['ingredient', 'category', 'sweetness']);
/** Gift conditions (budget, quantity, delivery date, recipient): never patched here, whoever said them. */
export const CONDITION_KINDS = Object.freeze(['budget', 'quantity', 'delivery', 'recipient']);
/** Kinds decided before owner: no patch, no classification call, one guidance question. */
export const OWNER_FREE_KINDS = Object.freeze([...CONDITION_KINDS, 'other']);
export const CLAIM_KINDS = Object.freeze([...PREFERENCE_KINDS, ...OWNER_FREE_KINDS]);
export const POLARITIES = Object.freeze(['avoid', 'prefer', 'allow']);
export const STRENGTHS = Object.freeze(['strong', 'weak']);
export const SWEETNESS_VALUES = Object.freeze(['less_sweet', 'unsweetened']);
/** The only state fields this interpreter may put in a patch. */
export const PATCH_FIELDS = Object.freeze(['preferences', 'excluded_ingredients', 'excluded_categories']);
export const MIXED_POLICIES = Object.freeze(['ask_first', 'apply_confirmed']);

/** Spoken forms → recipient labels used by the common parser. */
export const RECIPIENT_ALIASES = Object.freeze({
  엄마: '어머니', 어머니: '어머니', 어머님: '어머니',
  아빠: '아버지', 아버지: '아버지', 아버님: '아버지',
  부모님: '부모님', 친구: '친구', 동료: '동료', 교수님: '교수님',
});
/** People who are never the current recipient label in this baseline. */
export const OTHER_PEOPLE = Object.freeze([
  '동생', '여동생', '남동생', '언니', '오빠', '누나', '형', '할머니', '할아버지', '남편', '아내', '와이프',
  '삼촌', '이모', '고모', '아들', '딸', '사촌', '조카', '상사', '팀장',
]);

/** Category words used by rules. Kept narrow on purpose; anything else goes to the LLM or a question. */
export const CATEGORY_WORDS = Object.freeze([
  ['coffee_tea', /커피|홍차|녹차|전통차|(?<![가-힣])차(?=를|는|가|도|로|\s*(?:좋아|선호|싫|별로|안\s*좋아))/],
  ['snack', /과자|간식|초콜릿|쿠키|한과/],
  ['health', /영양제|홍삼|건강식품/],
  ['beauty', /향수|화장품|스킨케어|로션/],
  ['makeup', /메이크업|립스틱/],
  ['food', /과일|식품/],
  ['audio', /이어폰|헤드폰|스피커/],
  ['jewelry', /주얼리|목걸이|팔찌|귀걸이|반지/],
  ['watch', /시계/],
  ['bag', /가방|백팩/],
  ['accessory', /지갑|선글라스/],
  ['toy', /장난감|인형|레고/],
  ['kitchen', /주방용품/],
  ['decor', /향초|무드등|인테리어/],
  ['fitness', /운동용품|요가|헬스/],
  ['personal_care', /면도기|드라이기/],
]);

const hasFinalConsonant = word => {
  const code = word.charCodeAt(word.length - 1);
  return code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
};
/** Korean particle choice: josa('견과류','은','는') → '견과류는'. */
export const josa = (word, withFinal, withoutFinal) => `${word}${hasFinalConsonant(word) ? withFinal : withoutFinal}`;
export const categoryName = id => CATEGORY_NAMES[id] ?? id;

/**
 * particle(word, base) → word + the right particle by its final consonant.
 * base: '이'(이/가), '을'(을/를), '은'(은/는), '과'(과/와), '으로'(으로/로; ㄹ 받침은 '로').
 * A word not ending in Hangul is treated as having no final consonant.
 */
export function particle(word, base) {
  const code = word.charCodeAt(word.length - 1);
  const final = code >= 0xac00 && code <= 0xd7a3 ? (code - 0xac00) % 28 : 0;
  const has = final !== 0;
  const pairs = { 이: ['이', '가'], 을: ['을', '를'], 은: ['은', '는'], 과: ['과', '와'] };
  if (base === '으로') return `${word}${has && final !== 8 ? '으로' : '로'}`;
  if (!pairs[base]) throw new RangeError(`unknown particle: ${base}`);
  return `${word}${has ? pairs[base][0] : pairs[base][1]}`;
}

/** All user-facing questions are code templates. The LLM never writes them. */
export const QUESTIONS = Object.freeze({
  generic: '받는 분의 취향이나 피해야 할 성분을 짧게 알려주시거나, 조건 편집으로 입력해 주세요.',
  condition: "예산·수량 같은 조건은 '예산 10만원'처럼 말씀하시거나 조건 편집으로 바꿔 주세요.",
});

const clip = text => (text.length > 60 ? `${text.slice(0, 60)}…` : text);

/** Question for a claim whose owner is unknown. */
export function unknownQuestion(claim) {
  if (claim.kind === 'ingredient' && claim.polarity === 'avoid') return `${josa(claim.value, '은', '는')} 받는 분이 피하시는 건가요?`;
  if (claim.kind === 'category' && claim.polarity === 'avoid') return `${josa(categoryName(claim.value), '은', '는')} 받는 분이 피하시는 건가요?`;
  if (claim.kind === 'category' && claim.polarity === 'prefer') return `${josa(categoryName(claim.value), '을', '를')} 좋아하시는 분이 받는 분인가요?`;
  if (claim.kind === 'sweetness' && claim.polarity === 'avoid') return '단 것을 피하시는 분이 받는 분인가요?';
  return `'${clip(claim.span)}'는 받는 분에 대한 말씀인가요?`;
}
/** Recipient dislike (weak avoid): confirm before a hard exclusion. */
export function confirmExclusionQuestion(claim) {
  if (claim.kind === 'ingredient') return `${josa(claim.value, '을', '를')} 추천에서 빼 드릴까요?`;
  return `${categoryName(claim.value)} 상품을 추천에서 빼 드릴까요?`;
}
/** Recipient "is fine with X" while X is currently excluded or avoided. */
export function confirmReleaseQuestion(claim) {
  if (claim.kind === 'ingredient') return `${claim.value} 제외를 해제할까요?`;
  if (claim.kind === 'category') return `${categoryName(claim.value)} 제외를 해제할까요?`;
  return '단맛을 줄이는 조건을 해제할까요?';
}
export const unsupportedQuestion = claim => `'${clip(claim.span)}'는 아직 추천 조건으로 반영할 수 없어요. 조건 편집으로 입력해 주세요.`;
