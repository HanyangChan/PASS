// P5 ⑤ verifier: structure, numbers (R7 "천 원"), product names, memories, condition A leak (AC12), banned words with
// product names excluded (R7), allergy notice, price chips (AC11 AC13 AC14). Template output always passes. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipeline } from '../pipeline/index.mjs';
import { verifyExplanations, numbersIn } from '../verifier/agent.mjs';
import { findBanned, BANNED_WORDS } from '../verifier/banned-words.mjs';
import { products } from './fixtures/catalog.mjs';
import { stores, seedPeople, seedS1Memories } from './fixtures/people.mjs';

const PARENTS = '부모님 한 세트 세트당 예산 5만원 이하 배송비 포함 추천';
const FRIEND = '친구 한 세트 총예산 3만원 이하 상품값만 추천';
const PROF = '교수님 한 세트 세트당 예산 3만원 이하 배송비 포함 추천';
const MOM = '어머니 설 선물 한 세트 3만원 세트당 배송비 포함 추천';
const codes = r => r.reasons.map(x => x.code);

/** Run one turn and capture the factsheet and the template draft the explainer received. */
async function capture(text, { owner = 'userA', experiment = 'B', make = stores.memory } = {}) {
  const store = make();
  const people = await seedPeople(store);
  await seedS1Memories(store, people);
  let got = null;
  const pipe = createPipeline({ store, products, explain: async ({ factsheet, draft }) => { got = { factsheet, draft }; return structuredClone(draft); } });
  const out = await pipe.runPipelineTurn({ ownerId: owner, sessionId: 's', request: { kind: 'message', text }, experiment });
  return { ...got, out };
}
const verify = (factsheet, items) => verifyExplanations({ output: { items }, factsheet, products });

test('numbersIn: 만원 / 천 원 / 쉼표 / 1만 5천원 are normalized (R7)', () => {
  assert.deepEqual(numbersIn('2위보다 1.5만원 저렴해요'), [15000, 2]);
  assert.deepEqual(numbersIn('8천 원 여유'), [8000]);
  assert.deepEqual(numbersIn('리뷰 1,200개'), [1200]);
  assert.deepEqual(numbersIn('1만 5천원'), [15000]);
  assert.deepEqual(numbersIn('9,000원 · 3만 원'), [30000, 9000]);
});

test('the template passes the verifier 100%: every scenario, A and B, both stores', async () => {
  for (const [name, make] of Object.entries(stores)) {
    for (const [text, owner] of [[PARENTS, 'userA'], [FRIEND, 'userA'], [PROF, 'userB'], [MOM, 'userA']]) {
      for (const experiment of ['A', 'B']) {
        const { factsheet, draft, out } = await capture(text, { owner, experiment, make });
        const r = verify(factsheet, draft.items);
        assert.deepEqual(r.reasons, [], `${name} ${experiment} ${text}`);
        assert.equal(out.events.find(e => e.type === 'explanations').source, 'llm', 'the echoed draft is accepted as is');
      }
    }
  }
});

test('AC11: a number that is not a factsheet value or difference fails; the right ones pass', async () => {
  const { factsheet, draft } = await capture(PARENTS);
  const top = draft.items[0];
  const diff = factsheet.contrast.diff;
  assert.ok(verify(factsheet, [{ ...top, contrastChip: `2위보다 리뷰 ${diff.toLocaleString('ko-KR')}개 많아요` }, ...draft.items.slice(1)]).ok);
  const r = verify(factsheet, [{ ...top, contrastChip: `2위보다 리뷰 ${diff + 1}개 많아요` }, ...draft.items.slice(1)]);
  assert.deepEqual(r.reasons, [{ id: top.id, code: 'contrast_unbacked' }]);
  // the number must belong to the fact it is attached to (review): the budget is not a review count
  assert.ok(codes(verify(factsheet, [{ ...top, contrastChip: '2위보다 리뷰 50,000개 많아요' }, ...draft.items.slice(1)])).includes('contrast_unbacked'));
  assert.ok(codes(verify(factsheet, [{ ...top, contrastChip: `2위보다 리뷰 ${diff}개 적어요` }, ...draft.items.slice(1)])).includes('contrast_unbacked'), 'direction');
  assert.ok(codes(verify(factsheet, [{ ...top, tags: ['리뷰 50000개', '단맛 없음'] }, ...draft.items.slice(1)])).includes('number_unbacked'));
  assert.ok(codes(verify(factsheet, [{ ...top, tags: ['오천원 여유', '단맛 없음'] }, ...draft.items.slice(1)])).includes('number_unbacked'), 'Hangul numerals');
  assert.ok(r.valid.has(draft.items[1].id) && !r.valid.has(top.id), 'only the failing item is invalid');
  assert.ok(codes(verify(factsheet, [{ ...top, tags: ['단맛 없음', '3.3만원 여유'] }, ...draft.items.slice(1)])).includes('number_unbacked'));
});

test('AC10/AC11: a counterfactual line must name the recomputed rank 1; product names outside the factsheet fail', async () => {
  const { factsheet, draft } = await capture(PARENTS);
  const top = draft.items[0];
  assert.ok(factsheet.memoryCf);
  const wrong = verify(factsheet, [{ ...top, memoryCfLine: `'${factsheet.memoryCf.label}' 기억이 없었다면 1위는 전통 약과 세트` }, ...draft.items.slice(1)]);
  assert.ok(codes(wrong).includes('memory_cf_unbacked'));
  assert.ok(codes(verify(factsheet, [{ ...top, tags: ['홍삼 스틱보다 싸요', '단맛 없음'] }, ...draft.items.slice(1)])).includes('product_name'));
  const { factsheet: noCf, draft: d2 } = await capture(MOM);
  assert.equal(noCf.memoryCf, null);
  assert.ok(codes(verify(noCf, [{ ...d2.items[0], memoryCfLine: "'단 음식 X' 기억이 없었다면 1위는 대추차 세트" }, ...d2.items.slice(1)])).includes('memory_cf_unbacked'));
});

test('AC12: no tag compares cards, in A or B (only the B contrast chip may); internal tokens never reach the screen', async () => {
  for (const experiment of ['A', 'B']) {
    const { factsheet, draft } = await capture(PARENTS, { experiment });
    const [top, ...rest] = draft.items;
    const other = factsheet.items[1].budgetCost - factsheet.items[0].budgetCost;
    for (const t of [`타 상품보다 ${other / 1000}천원↓`, '1위보다 리뷰 적음', '다른 상품보다 쌈']) {
      assert.ok(codes(verify(factsheet, [{ ...top, tags: [t, '단맛 없음'] }, ...rest])).some(c => c === 'condition_a_leak' || c === 'tag_compares'), `${experiment} ${t}`);
    }
    for (const t of ['less_sweet', 'pref:x 맞춤', 'category 맞춤']) assert.ok(codes(verify(factsheet, [{ ...top, tags: [t, '단맛 없음'] }, ...rest])).includes('internal_token'), t);
  }
});

test('AC12: condition A rejects any B field or B wording', async () => {
  const { factsheet, draft } = await capture(PARENTS, { experiment: 'A' });
  for (const k of ['contrast', 'memoryCf', 'valueLadder']) assert.ok(!Object.hasOwn(factsheet, k));
  const [top, ...rest] = draft.items;
  for (const extra of [{ contrastChip: '2위보다 덜 달아요' }, { memoryCfLine: 'x' }, { ladderChips: [] }, { tags: ['2위보다 덜 달아요', '단맛 없음'] }]) {
    assert.ok(codes(verify(factsheet, [{ ...top, ...extra }, ...rest])).includes('condition_a_leak'), JSON.stringify(extra));
  }
});

test('AC13/AC14: price chips must be the planner options; no 올리기 for a capped recipient', async () => {
  const { factsheet, draft } = await capture(PROF, { owner: 'userB' });
  assert.deepEqual(factsheet.valueLadder.up, [], 'precondition: capped, no up options');
  const [top, ...rest] = draft.items;
  assert.ok(verify(factsheet, draft.items).ok);
  const up = { direction: 'up', label: '올리기 +9천원 · 리뷰 더 많음', amount_krw: 39000 };
  assert.ok(codes(verify(factsheet, [{ ...top, ladderChips: [...top.ladderChips, up] }, ...rest])).includes('ladder_unbacked'));
  const d = top.ladderChips[0];
  assert.ok(codes(verify(factsheet, [{ ...top, ladderChips: [{ ...d, label: '아끼기 -7천원 · 같은 적합도' }] }, ...rest])).includes('ladder_unbacked'));
  assert.ok(codes(verify(factsheet, [{ ...top, ladderChips: [{ ...d, amount_krw: d.amount_krw - 1 }] }, ...rest])).includes('ladder_unbacked'));
});

test('memories: a person or memory label not used by the card fails; the engine category name for a remembered hobby fails', async () => {
  const { factsheet, draft } = await capture(PARENTS);
  const [top, socks, poles] = draft.items;
  assert.deepEqual(socks.tags[0], '등산 좋아하심(아버지)');
  assert.ok(codes(verify(factsheet, [{ ...top, tags: ['등산 좋아하심(아버지)', '단맛 없음'] }, socks, poles])).includes('memory_unbacked'), 'coffee does not use the hiking memory');
  assert.ok(codes(verify(factsheet, [top, { ...socks, tags: ['등산 좋아하심(이모)', '2.8만원 여유'] }, poles])).includes('memory_unbacked'));
  assert.ok(codes(verify(factsheet, [top, { ...socks, tags: ['운동용품 선호', '2.8만원 여유'] }, poles])).includes('memory_tag_form'));
});

test('R7: banned words fail, but not inside a product name; allergy safety claims fail', async () => {
  assert.ok(BANNED_WORDS.includes('고급') && BANNED_WORDS.includes('보장'));
  assert.deepEqual(findBanned('프리미엄 녹차 세트보다 저렴', ['프리미엄 녹차 세트']), []);
  assert.deepEqual(findBanned('프리미엄 구성', ['프리미엄 녹차 세트']), ['프리미엄']);
  const { factsheet, draft } = await capture(PARENTS);
  const [top, ...rest] = draft.items;
  for (const t of ['고급 구성', '만족 보장', '효과 좋음']) assert.ok(codes(verify(factsheet, [{ ...top, tags: [t, '단맛 없음'] }, ...rest])).includes('banned_word'), t);
  assert.ok(factsheet.items[0].allergyNotice);
  assert.ok(codes(verify(factsheet, [{ ...top, tags: ['알레르기 걱정 없음', '단맛 없음'] }, ...rest])).includes('allergy_notice'));
});

test('structure: missing / duplicate / unknown items, bad tag counts and lengths, unknown fields', async () => {
  const { factsheet, draft } = await capture(PARENTS);
  const [a, b, c] = draft.items;
  assert.ok(codes(verifyExplanations({ output: null, factsheet, products })).includes('structure'));
  assert.ok(codes(verify(factsheet, [a, b])).includes('missing_item'));
  assert.ok(codes(verify(factsheet, [a, b, c, a])).includes('structure'));
  assert.ok(codes(verify(factsheet, [a, b, { ...c, id: 'nope' }])).includes('structure'));
  assert.ok(codes(verify(factsheet, [a, b, { ...c, tags: ['하나'] }])).includes('tag_shape'));
  assert.ok(codes(verify(factsheet, [a, b, { ...c, tags: ['열세 글자를 넘는 아주 긴 태그', '둘'] }])).includes('tag_shape'));
  assert.ok(codes(verify(factsheet, [a, b, { ...c, note: 'x' }])).includes('structure'));
  assert.ok(codes(verify(factsheet, [a, { ...b, contrastChip: '2위와 달라요' }, c])).includes('b_field_not_top'));
});
