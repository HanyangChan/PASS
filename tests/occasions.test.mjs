import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OCCASIONS, OCCASION_IDS, extractableOccasionSource, tagsForOccasion } from '../lib/occasions.mjs';
import { occasionFit } from '../lib/ranking.mjs';
import { extract, initial } from '../lib/engine.mjs';
import { occasionReply } from '../lib/single-gift.mjs';

const read = file => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8'));

test('the occasion table covers every tag in the catalog and every seed occasion', () => {
  const tags = new Set(read('../supabase/seed/products-kr.json').flatMap(product => product.occasions));
  assert.deepEqual([...tags].filter(tag => !OCCASION_IDS.includes(tag)), []);
  const seedIds = [...Object.keys(read('../occasion-seeds.v1.2.json').occasions), ...Object.keys(read('../occasion-seeds.v2-extra.json').occasions)];
  assert.deepEqual(seedIds.filter(id => !OCCASION_IDS.includes(id)), []);
  assert.deepEqual(OCCASION_IDS.filter(id => !seedIds.includes(id)), []);
  assert.equal(new Set(OCCASION_IDS).size, OCCASIONS.length);
});

test('occasion words map to catalog tags, ignoring spaces, with several tags where needed', () => {
  assert.deepEqual(['명절', '설', '추석', '설날'].map(tagsForOccasion), Array(4).fill(['holiday']));
  assert.deepEqual(tagsForOccasion('생일'), ['birthday']);
  assert.deepEqual(tagsForOccasion('수험'), ['exam']);
  assert.deepEqual(tagsForOccasion('합격'), ['exam', 'cert_exam']);
  assert.deepEqual(tagsForOccasion('첫 출근'), tagsForOccasion('첫출근'));
  assert.deepEqual(tagsForOccasion('첫출근'), ['first_job']);
  assert.deepEqual(tagsForOccasion('병문안'), ['hospital_visit']);
  assert.deepEqual(tagsForOccasion('송별회'), ['farewell']);
  assert.deepEqual(tagsForOccasion('퇴직'), ['farewell']);
  for (const word of ['기념일', '결혼기념일', '크리스마스', '졸업', '승진', '개업', '', null, undefined]) assert.deepEqual(tagsForOccasion(word), [], String(word));
});

test('occasionFit follows the table: any carried tag fits', () => {
  assert.equal(occasionFit({ occasions: ['holiday'] }, '추석'), true);
  assert.equal(occasionFit({ occasions: ['birthday'] }, '추석'), false);
  assert.equal(occasionFit({ occasions: ['hospital_visit', 'thanks'] }, '병문안'), true);
  assert.equal(occasionFit({ occasions: ['cert_exam'] }, '합격'), true);
  assert.equal(occasionFit({ occasions: ['exam'] }, '합격'), true);
  assert.equal(occasionFit({ occasions: ['exam'] }, '병문안'), false);
  assert.equal(occasionFit({ occasions: ['birthday'] }, '크리스마스'), false);
  assert.equal(occasionFit({}, '병문안'), false);
  assert.equal(occasionFit({ occasions: ['hospital_visit'] }, null), false);
});

const occasionOf = text => extract(text, initial()).patch.occasion;

test('extract reads the new occasion words as whole words before 선물, never ambiguous ones', () => {
  assert.equal(occasionOf('병문안 선물 추천해줘'), '병문안');
  assert.equal(occasionOf('친구 송별회 선물'), '송별회');
  assert.equal(occasionOf('프러포즈 선물'), '프러포즈');
  assert.equal(occasionOf('첫 출근 선물'), '첫출근');
  assert.equal(occasionOf('자격시험 선물'), '자격시험');
  assert.equal(occasionOf('추석 선물'), '추석');            // originals unchanged
  assert.equal(occasionOf('사과 선물'), undefined);         // fruit or apology: not guessed
  assert.equal(occasionOf('백일 선물'), undefined);         // baby's 100 days or a couple's
  assert.equal(occasionOf('해외여행 선물'), undefined);     // 여행 inside a longer word
  assert.equal(occasionOf('감사합니다 선물'), undefined);   // 감사 inside a longer word
});

test('a reply to "선물하는 날은?" accepts the new words', () => {
  assert.equal(occasionReply('병문안'), '병문안');
  assert.equal(occasionReply('선물하는 날은 송별회'), '송별회');
  assert.equal(occasionReply('병문안이에요'), '병문안');
  assert.equal(occasionReply('추석'), '명절');
  assert.equal(occasionReply('사과'), null);
});

test('the a-router parser keeps its own copy of the word list in sync with lib/occasions.mjs', () => {
  const source = readFileSync(new URL('../baseline/agents/a-router/parser.mjs', import.meta.url), 'utf8');
  const copy = /const EXTRA_OCCASIONS = '([^']*)';/.exec(source)?.[1].replaceAll('\\\\', '\\');
  assert.equal(copy, extractableOccasionSource());
});
