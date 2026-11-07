// K44: critique phrases (덜 달게·덜 단·안 단·실용적인·더 저렴한·더 싼) are solved before parseRules, without a key.
// R6 integration: when less_sweet comes from BOTH the sentence and a memory, the memory counterfactual line for it is
// not shown (removing the memory would not remove the condition). Other memories keep their own sources. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { initial } from '../../../src/vendor/engine.mjs';
import { createDialogue, splitCritiques, toPort, LOWER_BUDGET_QUESTION, UNSUPPORTED_TEXT } from '../dialogue/agent.mjs';
import { createPipeline } from '../pipeline/index.mjs';
import { createFakeLlm } from '../llm/index.mjs';
import { products } from './fixtures/catalog.mjs';
import { stores, seedPeople, seedS1Memories } from './fixtures/people.mjs';

const ev = (r, type) => r.events.find(e => e.type === type);
const PLAIN = '부모님 설 선물 한 세트 5만원 세트당 배송비 포함 추천';
const LESS_SWEET = '부모님 설 선물 한 세트 5만원 세트당 배송비 포함 덜 단 걸로 추천';

test('splitCritiques: each phrase on its own, with an optional 걸로·거·것 tail; not inside other words', () => {
  for (const t of ['덜 달게 해줘', '덜 단 걸로', '덜단 거', '안 단 것', '안 단 선물로']) assert.deepEqual(splitCritiques(t).preferences, ['less_sweet'], t);
  for (const t of ['더 저렴한 거', '더 싼 것으로', '더싼거', '싼 걸로', '저렴한 걸로']) assert.deepEqual([splitCritiques(t).cheaper, splitCritiques(t).sensitivity], [true, 'value'], t);
  // K51: "실용적인" is not mapped to anything: it is only reported as unsupported
  const practical = splitCritiques('실용적인 걸로');
  assert.deepEqual([practical.unsupported, practical.cheaper, practical.sensitivity, practical.preferences], [['실용적인'], false, null, []]);
  for (const t of ['단백질 세트', '비싼 거', '덜 단단한 것', '안 단다', '값싼 거', '싼타페 선물']) {
    const r = splitCritiques(t);
    assert.deepEqual([r.preferences, r.sensitivity, r.cheaper, r.unsupported], [[], null, false, []], t);
  }
});

test('"…배송비 포함 덜 단 걸로 추천" is solved by rules: 0 LLM calls, less_sweet added, occasion kept', async () => {
  const llm = createFakeLlm({ json: [] });
  const d = await createDialogue({ llm }).interpret({ text: LESS_SWEET, state: initial() });
  assert.equal(d.unresolved, false);
  assert.equal(llm.calls.length, 0);
  assert.deepEqual(d.patch, { recipients: ['부모님'], budget: { amount_krw: 50000, scope: 'per_set', shipping_included: true }, quantity: 1, same_product: true, occasion: '설', preferences: ['less_sweet'] });
  assert.deepEqual(d.said, [{ field: 'preferences', value: 'less_sweet' }]);
  // a follow-up in the same session adds to the list instead of replacing it
  const next = await createDialogue().interpret({ text: '덜 달게 추천해줘', state: { ...initial(), recipients: ['부모님'], preferences: ['category:fitness'] } });
  assert.deepEqual(next.patch, { preferences: ['category:fitness', 'less_sweet'] });
  // without a critique phrase, unsupported words still ask (parseRules is unchanged)
  assert.equal((await createDialogue().interpret({ text: '부모님 고급스러운 걸로 5만원', state: initial() })).unresolved, true);
});

for (const [name, make] of Object.entries(stores)) {
  test(`[${name}] R6: less_sweet from the sentence AND a memory -> no counterfactual line for that memory`, async () => {
    const run = async text => {
      const store = make();
      const people = await seedPeople(store);
      const m = await seedS1Memories(store, people);
      const llm = createFakeLlm({ json: [] });
      const pipe = createPipeline({ store, products, llm, explain: null });
      const out = await pipe.runPipelineTurn({ ownerId: 'userA', sessionId: 's', request: { kind: 'message', text } });
      return { out, m, llm, row: await store.getSession('userA', 's') };
    };
    const plain = await run(PLAIN);
    assert.match(ev(plain.out, 'explanations').items[0].memoryCfLine ?? '', /^'단 음식 X' 기억이 없었다면/, 'precondition: from memory only, the line is shown');

    const both = await run(LESS_SWEET);
    assert.equal(both.llm.calls.length, 0, 'no key needed');
    assert.deepEqual(both.out.events.map(e => e.type), ['cards', 'explanations']);
    const prov = both.row.meta.provenance.preferences;
    assert.deepEqual(prov.find(e => e.value === 'less_sweet').sources.sort(), ['utterance', `memory:${both.m.sweet.id}`].sort());
    assert.ok(!prov.find(e => e.value === 'category:fitness').sources.includes('utterance'), 'the hiking mapping keeps its memory source');
    const line = ev(both.out, 'explanations').items[0].memoryCfLine;
    assert.ok(!line || !line.includes('단 음식 X'), String(line));
    assert.equal(ev(both.out, 'cards').banner.text, '지난 기억을 반영했어요: 단 음식 X · 땅콩 제외 · 등산', 'the memory is still applied and shown');
  });

  test(`[${name}] a follow-up "덜 달게" keeps the sources of values already in the state (only the said value is utterance)`, async () => {
    const store = make();
    const people = await seedPeople(store);
    await seedS1Memories(store, people);
    const pipe = createPipeline({ store, products, explain: null });
    const turn = text => pipe.runPipelineTurn({ ownerId: 'userA', sessionId: 's', request: { kind: 'message', text } });
    await turn('아버지 한 세트 세트당 예산 5만원 이하 배송비 포함 추천');
    const before = (await store.getSession('userA', 's')).meta.provenance.preferences;
    await turn('덜 달게 추천해줘');
    const after = (await store.getSession('userA', 's')).meta.provenance.preferences;
    assert.deepEqual(after.find(e => e.value === 'category:fitness'), before.find(e => e.value === 'category:fitness'));
    assert.deepEqual(after.find(e => e.value === 'less_sweet').sources, ['utterance']);
  });

  test(`[${name}] "더 저렴한 걸로" sets this session's sensitivity to value in B only; the budget is not changed`, async () => {
    for (const [experiment, expected] of [['B', 'value'], ['A', 'balanced']]) {
      const store = make();
      const pipe = createPipeline({ store, products, explain: null });
      const out = await pipe.runPipelineTurn({ ownerId: 'userA', sessionId: 's', request: { kind: 'message', text: '친구 한 세트 총예산 3만원 이하 상품값만 더 저렴한 걸로 추천' }, experiment });
      assert.ok(ev(out, 'cards'));
      const row = await store.getSession('userA', 's');
      assert.equal(row.meta.sensitivity, expected, experiment);
      assert.equal(row.session.state.budget.amount_krw, 30000);
    }
  });

  test(`[${name}] K51: "더 저렴한·싼" — B highlights the 아끼기 chip first; A asks "예산을 얼마로 낮출까요?" and changes nothing`, async () => {
    const FRIEND = '친구 한 세트 총예산 3만원 이하 상품값만';
    const run = async experiment => {
      const store = make();
      const pipe = createPipeline({ store, products, explain: null });
      const turn = text => pipe.runPipelineTurn({ ownerId: 'userA', sessionId: 's', request: { kind: 'message', text }, experiment });
      return { store, turn };
    };
    // B: with the recommendation in the same sentence, and as a follow-up
    const b = await run('B');
    const first = ev(await b.turn(`${FRIEND} 추천`), 'explanations');
    assert.equal(first.emphasize, undefined, 'plain request: no emphasis');
    const cheaper = await b.turn('싼 걸로 추천');
    const ex = ev(cheaper, 'explanations');
    assert.equal(ex.emphasize, 'down');
    assert.equal(ex.items[0].ladderChips[0].direction, 'down', 'the 아끼기 chip comes first');
    assert.match(ex.items[0].ladderChips[0].label, /^아끼기 -/);
    const rowB = await b.store.getSession('userA', 's');
    assert.equal(rowB.meta.sensitivity, 'value');
    assert.equal(rowB.session.state.budget.amount_krw, 30000, 'the budget is not changed (R3)');
    // A: nothing to ask the engine about -> the one question, nothing saved
    const a = await run('A');
    assert.ok(ev(await a.turn(`${FRIEND} 추천`), 'cards'));
    const before = await a.store.getSession('userA', 's');
    const asked = await a.turn('더 저렴한 걸로');
    assert.deepEqual(asked.events.map(e => [e.type, e.question]), [['question', LOWER_BUDGET_QUESTION]]);
    assert.deepEqual(await a.store.getSession('userA', 's'), before);
    // A with the rest of a request in the same sentence still recommends and shows no price options
    const a2 = await run('A');
    const out = await a2.turn(`${FRIEND} 더 저렴한 걸로 추천`);
    assert.deepEqual(out.events.map(e => e.type), ['cards', 'explanations']);
    assert.equal(ev(out, 'explanations').emphasize, undefined);
    assert.ok(!ev(out, 'explanations').items.some(i => i.ladderChips));
  });

  test(`[${name}] K51: "실용적인" is not mapped — alone it answers with the guidance, inside a request it adds a notice and changes no condition`, async () => {
    for (const experiment of ['A', 'B']) {
      const store = make();
      const pipe = createPipeline({ store, products, explain: null });
      const turn = text => pipe.runPipelineTurn({ ownerId: 'userA', sessionId: 's', request: { kind: 'message', text }, experiment });
      const plain = await turn('친구 한 세트 총예산 3만원 이하 상품값만 추천');
      const before = await store.getSession('userA', 's');
      const alone = await turn('실용적인 걸로');
      assert.deepEqual(alone.events.map(e => [e.type, e.question]), [['question', UNSUPPORTED_TEXT]], experiment);
      assert.equal(UNSUPPORTED_TEXT, '실용적인 기준은 아직 반영하지 못해요');
      assert.deepEqual(await store.getSession('userA', 's'), before, 'nothing saved');
      const inside = await run2(make, experiment, '친구 한 세트 총예산 3만원 이하 상품값만 실용적인 걸로 추천');
      assert.equal(ev(inside.out, 'cards').notice, UNSUPPORTED_TEXT);
      assert.deepEqual(ev(inside.out, 'cards').result.cards.map(c => c.id), ev(plain, 'cards').result.cards.map(c => c.id), 'same cards as without the word');
      assert.equal(inside.row.meta.sensitivity, 'balanced', 'not mapped to 가성비');
      assert.equal(ev(plain, 'cards').notice, undefined);
    }
  });
}

async function run2(make, experiment, text) {
  const store = make();
  const pipe = createPipeline({ store, products, explain: null });
  const out = await pipe.runPipelineTurn({ ownerId: 'userA', sessionId: 's', request: { kind: 'message', text }, experiment });
  return { out, row: await store.getSession('userA', 's') };
}

test('common port (toPort): "더 저렴한" alone asks the budget question, "실용적인" alone says it is not supported', async () => {
  const port = toPort(createDialogue());
  const state = { ...initial(), recipients: ['친구'] };
  assert.deepEqual(await port({ text: '더 저렴한 걸로', state }), { patch: {}, questions: [LOWER_BUDGET_QUESTION], unresolved: true });
  assert.deepEqual(await port({ text: '실용적인 걸로', state }), { patch: {}, questions: [UNSUPPORTED_TEXT], unresolved: true });
});

test('LLM path: values the LLM echoes from the state are not "said"; new values and a spoken sweetness word are', async () => {
  const state = { ...initial(), recipients: ['어머니'], preferences: ['less_sweet', 'category:fitness'] };
  const reply = { recipients: ['어머니'], preferences: ['less_sweet', 'category:fitness', 'category:coffee_tea'], memoryCandidates: [] };
  const d1 = await createDialogue({ llm: createFakeLlm({ json: [reply] }) }).interpret({ text: '엄마 커피도 좋아하셔', state });
  assert.deepEqual(d1.said, [{ field: 'preferences', value: 'category:coffee_tea' }]);
  const d2 = await createDialogue({ llm: createFakeLlm({ json: [reply] }) }).interpret({ text: '엄마 커피도 좋아하시고 덜 단 거', state });
  assert.deepEqual(d2.said.map(x => x.value).sort(), ['category:coffee_tea', 'less_sweet']);
});
