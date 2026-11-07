// ⑤ banned expressions (PRD F4 "숫자로만 표현", TRD §7). Quality / efficacy / satisfaction claims that no engine fact
// backs. R7: product names are removed before the check, so "프리미엄 녹차 세트" as a name is not a violation.
export const BANNED_WORDS = [
  '고급', '프리미엄', '최고', '최상', '최고급', '명품', '더 좋은', '더좋은', '좋은 상품', '훌륭', '완벽', '최적',
  '보장', '확실', '무조건', '틀림없', '강력 추천', '강추', '꼭 사', '놓치지',
  '효능', '효과', '건강에 좋', '몸에 좋', '면역', '치료', '예방', '다이어트',
  '만족', '좋아하실', '기뻐하실', '감동', '센스', '정성',
];
// The allergy notice (engine ALLERGY_NOTICE) must stay: no text may claim safety from allergens.
const ALLERGY_CLAIM = /알레르기\s*(?:걱정|염려|안심|없|안전|무관|프리)|무\s*알레르기|안전(?:해|한|합)|안심/;

const escape = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Text with every given product name taken out (R7). */
export function withoutNames(text, names) {
  let t = String(text ?? '');
  for (const n of [...names].filter(Boolean).sort((a, b) => b.length - a.length)) t = t.replace(new RegExp(escape(n), 'g'), ' ');
  return t;
}

/** Banned words found in the text after removing product names. */
export function findBanned(text, names = []) {
  const t = withoutNames(text, names);
  return BANNED_WORDS.filter(w => t.includes(w));
}

export const claimsAllergySafety = (text, names = []) => ALLERGY_CLAIM.test(withoutNames(text, names));
