// Korean labelled food allergens (+견과류 convenience tag), matched on product names.
// A match proves presence; no match proves nothing, so the app always shows a check notice.
export const ALLERGENS=[
 ['알류',/\beggs?\b|mayonnaise|계란|달걀/i],
 ['우유',/\bmilk|whey|cheese|butter|\bghee\b|paneer|\bcream|yogh?urt|우유|치즈|버터|크림|요거트/i],
 ['메밀',/buckwheat|메밀/i],
 ['땅콩',/peanut|groundnut|땅콩/i],
 ['대두',/\bsoy|soya|tofu|대두|두부|간장|된장/i],
 ['밀',/wheat|\batta\b|maida|flour|biscuit|cookie|bread|pasta|noodle|semolina|밀가루|비스킷|쿠키|빵|파스타|국수/i],
 ['고등어',/mackerel|고등어/i],
 ['게',/\bcrab|게살|꽃게|대게/i],
 ['새우',/prawn|shrimp|새우/i],
 ['돼지고기',/\bpork|bacon|\bham\b|돼지|베이컨/i],
 ['복숭아',/peach|복숭아/i],
 ['토마토',/tomato|ketchup|토마토|케첩/i],
 ['아황산류',/sulphite|sulfite|아황산/i],
 ['호두',/walnut|호두/i],
 ['닭고기',/chicken|닭/i],
 ['쇠고기',/\bbeef|소고기|쇠고기|한우/i],
 ['오징어',/squid|오징어/i],
 ['조개류',/oyster|\bclams?\b|mussel|abalone|scallop|조개|전복|홍합|가리비/i],
 ['잣',/pine ?nut|잣/i],
 ['견과류',/almond|cashew|pistachio|hazelnut|walnut|pecan|macadamia|\bnuts?\b|dry ?fruits?|아몬드|캐슈|피스타치오|헤이즐넛|견과|마카다미아/i],
];
export const ALLERGEN_NAMES=ALLERGENS.map(([name])=>name);
export const tagAllergens=text=>ALLERGENS.filter(([,re])=>re.test(text)).map(([name])=>name);
// "하게" must not become 게: only names not glued to a preceding Hangul syllable count.
export const mentionedAllergens=text=>ALLERGEN_NAMES.filter(name=>new RegExp(`(?<![가-힣])${name}`).test(text));
