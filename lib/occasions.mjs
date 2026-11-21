// Gift occasions in one table: the catalog tag (`occasions` on products in supabase/seed/products-kr.json), the words
// people use for it, and the words the parsers may pick up from a sentence.
//
// - `id` is the catalog tag. The 4 original tags (holiday, birthday, exam, flower) and the 32 from
//   occasion-seeds.v2-extra.json are all here; tests check that every tag in products-kr.json is in this table.
// - `words` are what `state.occasion` can hold for the tag. Lookups ignore spaces ("첫 출근" = "첫출근"). A word may
//   belong to several tags (합격 → exam and cert_exam); an occasion fits a product that carries any of them.
// - `ambiguous` words stay in `words` (a chip or the model can still set them) but the parsers never pull them out of
//   free text: "사과" is also a fruit, "백일" is also a baby's 100 days.
// Not mapped on purpose: 기념일 / 결혼기념일 (which of 100일·프러포즈·약혼 is meant is unknown) and 크리스마스, 졸업, 승진,
// 개업 (no catalog tag yet). They stay plain words with no occasion boost, as before.
export const OCCASIONS = Object.freeze([
  { id: 'holiday', words: ['명절', '설', '추석', '설날', '한가위'] },
  { id: 'birthday', words: ['생일', '생신'] },
  { id: 'exam', words: ['수험', '합격'] },
  { id: 'flower', words: [] },

  { id: 'thanks', words: ['감사'] },
  { id: 'invitation', words: ['집들이', '초대', '홈파티'] },
  { id: 'hospital_visit', words: ['병문안'] },
  { id: 'discharge', words: ['퇴원'] },
  { id: 'recovery', words: ['회복', '쾌유'] },
  { id: 'parenting', words: ['출산', '육아', '산후조리'] },

  { id: 'first_job', words: ['첫 출근', '입사', '취업'] },
  { id: 'project_done', words: ['프로젝트 완료', '프로젝트 종료'] },
  { id: 'farewell', words: ['송별', '송별회', '환송회', '퇴사', '퇴직', '이직', '은퇴'] },
  { id: 'internship_end', words: ['수료', '수료식', '인턴 수료'] },
  { id: 'cert_exam', words: ['합격', '자격시험', '시험'] },
  { id: 'study_abroad', words: ['유학'] },

  { id: 'exhibition', words: ['전시회', '전시'] },
  { id: 'performance', words: ['공연'] },
  { id: 'recital', words: ['연주회'] },
  { id: 'publication', words: ['출간'] },
  { id: 'competition', words: ['대회'] },
  { id: 'award', words: ['수상'] },

  { id: 'manitto', words: ['마니또'] },
  { id: 'prize', words: ['경품'] },
  { id: 'travel', words: ['여행'] },
  { id: 'return_gift', words: ['답례'] },
  { id: 'pet_adoption', words: ['반려동물 입양', '입양'] },

  { id: 'mood_boost', words: ['기분 전환'] },
  { id: 'surprise', words: ['깜짝', '서프라이즈'] },
  { id: 'apology', words: ['미안', '사과'], ambiguous: ['사과'] },
  { id: 'reconciliation', words: ['화해'] },

  { id: 'couple_100days', words: ['100일', '백일'], ambiguous: ['백일'] },
  { id: 'first_meeting', words: ['첫만남', '소개팅'] },
  { id: 'proposal', words: ['프러포즈', '프로포즈', '청혼'] },
  { id: 'engagement', words: ['약혼', '상견례'] },
  { id: 'reunion', words: ['재회'] },
]);

const squash = text => String(text).replace(/\s+/g, '');
const TAGS = new Map();
for (const { id, words } of OCCASIONS) {
  for (const word of words) {
    const key = squash(word);
    TAGS.set(key, [...(TAGS.get(key) ?? []), id]);
  }
}

export const OCCASION_IDS = Object.freeze(OCCASIONS.map(({ id }) => id));

/** Catalog tags for an occasion word as `state.occasion` holds it; [] for words without a tag. */
export const tagsForOccasion = occasion => (occasion ? TAGS.get(squash(occasion)) ?? [] : []);

// Words the parsers may take from free text: not the 4 originals (they have their own patterns), not ambiguous ones.
// Longest first so "송별회" wins over "송별", written with `\s*` where the table has a space.
const ORIGINAL = new Set(['holiday', 'birthday', 'exam', 'flower']);
export const EXTRACTABLE_OCCASION_WORDS = Object.freeze([...new Set(OCCASIONS
  .filter(({ id }) => !ORIGINAL.has(id))
  .flatMap(({ words, ambiguous = [] }) => words.filter(word => !ambiguous.includes(word))))]
  .sort((a, b) => b.length - a.length));

/** The same words as a regex alternation source, spaces as `\s*`. */
export const extractableOccasionSource = () => EXTRACTABLE_OCCASION_WORDS.map(word => word.replace(/\s+/g, '\\s*')).join('|');
