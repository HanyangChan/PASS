// Shared item vocabulary rules: used by the catalog pipeline's relevance check
// (scripts/catalog/web/select.mjs) and by the item filter (lib/item-filter.mjs).

// Words that describe the gift form or occasion, not the item.
export const GENERIC_WORDS = ['선물세트', '선물박스', '선물', '세트', '혼합', '소포장', '생일', '수능', '응원', '기원', '꽃다발', '화분', '다발'];

// Alternate spellings sellers and users write for the same item.
export const TERM_ALIASES = {
  프리지아: ['후리지아'], 칼라: ['카라'], 소국: ['국화'], 동양란: ['동양난'], 다알리아: ['달리아'],
  리시안셔스: ['리시안사스', '리시안서스'], 히아신스: ['히야신스'], 포인세티아: ['포인세치아'],
  호접란: ['호접난'], 캐모마일: ['카모마일'], 라넌큘러스: ['라넌큐러스'], 프리저브드: ['프리저브'],
};

// Occasion words that open the v2-extra seed keywords ("병문안 과일바구니", "경품 텀블러"): they say why a gift is
// given, not what it is. Shared by the catalog pipeline (relevance, scripts/catalog/web/config.mjs) and the item
// filter (kept out of the item vocabulary below).
export const OCCASION_WORDS = ['감사', '초대', '집들이', '홈파티', '병문안', '퇴원', '회복', '출산', '육아맘', '첫', '출근', '첫출근', '송별',
  '수료', '축하', '시험', '합격', '유학', '대회', '수상', '출간', '공연', '연주회', '전시회', '전시', '마니또', '경품', '답례', '답례품',
  '입양', '서프라이즈', '깜짝', '미안해', '화해', '재회', '프러포즈', '약혼', '첫만남', '100일', '기분', '한국', '팀', '단체'];

// Modifiers and occasions inside seed keywords that must not narrow a recommendation by themselves
// ("가을 꽃다발" → 가을, "충전식 손난로" → 충전식).
export const ITEM_STOPWORDS = ['생활용품', '온열', '기초', '무선', '미니', '가죽', '실크', '보온', '일회용', '충전식', '컴퓨터용',
  '스터디', '공부', '수면', '후드', '겨울', '실내', '허리', '블루라이트', '차단', '단어', 'LED', '합격', '과일', '가을',
  '크리스마스', '용돈', '캠핑', '노트북', '플라워', '정기구독', '간식세트', '블루투스', '스마트워치', '전통', '수험표',
  // Occasion words from the v2-extra seeds, and 배송 (from "축하 화분 배송"), are not items.
  ...OCCASION_WORDS, '배송'];

// One-letter items are recognized only from this list, and only as a separate word (배송·김치·떡볶이 do not count).
export const SINGLE_CHAR_ITEMS = ['배', '김', '꿀', '떡', '쌀'];

export function coreTerms(keyword, overrides = {}) {
  if (overrides[keyword]) return overrides[keyword];
  const words = keyword.split(/\s+/).filter(word => !GENERIC_WORDS.includes(word));
  return words.length ? words : [keyword];
}
