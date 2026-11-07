// P5 ④ explainer through the orchestrator: ONE call for the top 3, one retry with the verifier's reasons, then the
// template per failing item (AC3, AC11). Condition A never gets B fields (AC12). Memory tags use the memory's own
// words and person (template and LLM). Hidden products ("이 상품만") are never named by a B chip. Fake LLM only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipeline } from '../pipeline/index.mjs';
import { createFakeLlm, LlmError } from '../llm/index.mjs';
import { createExplainer, EXPLAIN_SCHEMA } from '../explainer/agent.mjs';
import { memoryTag } from '../explainer/template.mjs';
import { products } from './fixtures/catalog.mjs';
import { loadCatalog } from '../data/load.mjs';
import { stores, seedPeople, seedS1Memories } from './fixtures/people.mjs';

const PARENTS = '부모님 한 세트 세트당 예산 5만원 이하 배송비 포함 추천';
const ev = (r, type) => r.events.find(e => e.type === type);
const B_KEYS = ['contrastChip', 'memoryCfLine', 'ladderChips', 'ladderNotice'];

/** The LLM echoes the draft it was given, optionally changed by `edit(items, call)`. */
const echo = (edit = x => x) => call => ({ items: edit(structuredClone(call.input.draft), call) });

async function setup({ json = [], experiment = 'B', make = stores.memory, seed = true, explain } = {}) {
  const store = make();
  const people = await seedPeople(store);
  if (seed) await seedS1Memories(store, people);
  const llm = createFakeLlm({ json });
  // the dialogue never calls the LLM here: every sentence is solved by rules
  const pipe = createPipeline({ store, products, llm, ...(explain !== undefined ? { explain } : {}) });
  const turn = (request, extra = {}) => pipe.runPipelineTurn({ ownerId: 'userA', sessionId: 's', request, experiment, ...extra });
  return { store, llm, turn, people };
}
const explainCalls = llm => llm.calls.filter(c => c.method === 'json' && c.role === 'explainer');

for (const [name, make] of Object.entries(stores)) {
  test(`[${name}] a valid LLM answer is used after ONE call; cards still come first and are the baseline's`, async () => {
    const { llm, turn } = await setup({ make, json: [echo(items => { items[1].tags = ['등산 좋아하심(아버지)', '양말 구성']; return items; })] });
    const out = await turn({ kind: 'message', text: PARENTS });
    assert.deepEqual(out.events.map(e => e.type), ['cards', 'explanations']);
    const ex = ev(out, 'explanations');
    assert.equal(ex.source, 'llm');
    assert.equal(explainCalls(llm).length, 1);
    assert.deepEqual(ex.items.map(i => i.id), ev(out, 'cards').result.cards.map(c => c.id));
    const call = explainCalls(llm)[0];
    assert.equal(call.timeoutMs, 8000);
    assert.equal(call.input.factsheet.items.length, 3, 'top 3 in one call');
    assert.ok(!JSON.stringify(call.input).includes('memoryId'), 'memory ids are not sent');
  });

  test(`[${name}] AC11: a wrong number is caught, the LLM is asked once more with the reasons, then the template replaces only that item`, async () => {
    const bad = items => { items[0].contrastChip = '2위보다 리뷰 9,999개 많아요'; items[2].tags = ['자연스러운 선택', items[2].tags[1]]; return items; };
    const { llm, turn } = await setup({ make, json: [echo(bad), echo(bad)] });
    const tpl = await (await setup({ make, explain: null })).turn({ kind: 'message', text: PARENTS });
    const out = await turn({ kind: 'message', text: PARENTS });
    const calls = explainCalls(llm);
    assert.equal(calls.length, 2, 'one retry only');
    assert.deepEqual(calls[1].input.retryReasons.map(r => r.code), ['contrast_unbacked']);
    const ex = ev(out, 'explanations');
    assert.equal(ex.source, 'mixed');
    assert.deepEqual(ex.items[0], ev(tpl, 'explanations').items[0], 'rank 1 fell back to the template');
    assert.deepEqual(ex.items[2].tags[0], '자연스러운 선택', 'the passing item keeps the LLM wording');
  });

  test(`[${name}] a retry that fixes the answer is accepted; an LLM error goes straight to the template (AC3)`, async () => {
    const bad = items => { items[0].tags = ['최고급 구성', items[0].tags[1]]; return items; };
    const fixed = await setup({ make, json: [echo(bad), echo()] });
    const ex = ev(await fixed.turn({ kind: 'message', text: PARENTS }), 'explanations');
    assert.equal(ex.source, 'llm');
    assert.equal(explainCalls(fixed.llm).length, 2);
    assert.deepEqual(explainCalls(fixed.llm)[1].input.retryReasons, [{ id: ex.items[0].id, code: 'banned_word' }]);
    for (const err of [new LlmError('llm_timeout'), new Error('boom')]) {
      const down = await setup({ make, json: [err] });
      const out = await down.turn({ kind: 'message', text: PARENTS });
      assert.deepEqual(out.events.map(e => e.type), ['cards', 'explanations']);
      assert.equal(ev(out, 'explanations').source, 'template');
      assert.equal(explainCalls(down.llm).length, 1);
    }
  });

  test(`[${name}] AC12: in condition A an LLM that adds B chips is rejected; A and B cards are identical`, async () => {
    const sneaky = items => { items[0].contrastChip = '2위보다 리뷰 1,400개 많아요'; return items; };
    const a = await setup({ make, experiment: 'A', json: [echo(sneaky), echo(sneaky)] });
    const outA = await a.turn({ kind: 'message', text: PARENTS });
    assert.ok(!explainCalls(a.llm)[0].input.factsheet.contrast, 'A factsheet has no contrast');
    for (const item of ev(outA, 'explanations').items) for (const k of B_KEYS) assert.ok(!Object.hasOwn(item, k), k);
    const b = await setup({ make, json: [echo()] });
    const outB = await b.turn({ kind: 'message', text: PARENTS });
    assert.deepEqual(ev(outA, 'cards').result, ev(outB, 'cards').result);
    assert.ok(ev(outB, 'explanations').items[0].memoryCfLine, 'B keeps its chips');
  });

  test(`[${name}] B chips the LLM left out are filled from the template, so B always shows its facts`, async () => {
    const { turn } = await setup({ make, json: [echo(items => items.map(({ id, tags }) => ({ id, tags })))] });
    const top = ev(await turn({ kind: 'message', text: PARENTS }), 'explanations').items[0];
    assert.ok(top.contrastChip && top.memoryCfLine && top.ladderNotice);
  });

  test(`[${name}] memory tags: a remembered hobby shows the memory's words and person, in cards and explanations; a spoken preference keeps the engine wording`, async () => {
    const { turn } = await setup({ make, explain: null });
    const out = await turn({ kind: 'message', text: PARENTS });
    const socks = ev(out, 'cards').annotations.find(a => a.id === 'hiking-socks');
    assert.equal(socks.tags[0], '등산 좋아하심(아버지)');
    assert.equal(ev(out, 'explanations').items.find(i => i.id === 'hiking-socks').tags[0], '등산 좋아하심(아버지)');
    const said = await (await setup({ make, seed: false, explain: null })).turn({ kind: 'patch', patch: { recipients: ['아버지'], budget: { amount_krw: 50000, scope: 'per_set', shipping_included: true }, quantity: 1, preferences: ['category:fitness'] } });
    assert.equal(ev(said, 'cards').annotations.find(a => a.id === 'hiking-socks').tags[0], '운동용품 선호');
    // the LLM must use the memory wording too
    const llmWrong = await setup({ make, json: [echo(items => { items[1].tags[0] = '운동용품 선호'; return items; }), echo(items => { items[1].tags[0] = '운동용품 선호'; return items; })] });
    const ex = ev(await llmWrong.turn({ kind: 'message', text: PARENTS }), 'explanations');
    assert.equal(ex.items[1].tags[0], '등산 좋아하심(아버지)');
    assert.deepEqual(explainCalls(llmWrong.llm)[1].input.retryReasons.map(r => r.code), ['memory_tag_form']);
    assert.equal(explainCalls(llmWrong.llm)[0].input.factsheet.memoryTags['category:fitness'], '등산 좋아하심(아버지)', 'the LLM is given the memory wording');
  });

  test(`[${name}] "이 상품만": a hidden rank 1 or hidden counterfactual product is never named by a B chip; ranking unchanged`, async () => {
    const { turn } = await setup({ make, explain: null });
    const first = await turn({ kind: 'message', text: PARENTS });
    const cf = ev(first, 'explanations').items[0].memoryCfLine;
    assert.match(cf, /등산 양말 세트/);
    await turn({ kind: 'feedback', action: 'dismissed', productId: 'hiking-socks' });
    const out = await turn({ kind: 'feedback', action: 'dismissed', productId: 'hiking-socks', scope: 'product' });
    assert.deepEqual(ev(out, 'cards').result, ev(first, 'cards').result);
    assert.deepEqual(ev(out, 'cards').hiddenProductIds, ['hiking-socks']);
    const top = ev(out, 'explanations').items[0];
    assert.equal(top.memoryCfLine, undefined, 'the counterfactual named the hidden product');
    await turn({ kind: 'feedback', action: 'dismissed', productId: 'drip-coffee' });
    const hiddenTop = ev(await turn({ kind: 'feedback', action: 'dismissed', productId: 'drip-coffee', scope: 'product' }), 'explanations').items[0];
    for (const k of B_KEYS) assert.ok(!Object.hasOwn(hiddenTop, k), k);
  });
}

test('createPipeline: the explainer is created from the llm unless explain is given; none without an llm', async () => {
  assert.equal(createExplainer({ llm: null }), null);
  const store = stores.memory();
  const llm = createFakeLlm({ json: [] });
  const pipe = createPipeline({ store, products, llm, explain: null });
  await pipe.runPipelineTurn({ ownerId: 'userA', sessionId: 's', request: { kind: 'message', text: '어머니 한 세트 세트당 예산 5만원 이하 배송비 포함 추천' } });
  assert.equal(llm.calls.length, 0);
  const noLlm = createPipeline({ store: stores.memory(), products });
  const out = await noLlm.runPipelineTurn({ ownerId: 'userA', sessionId: 's', request: { kind: 'message', text: '어머니 한 세트 세트당 예산 5만원 이하 배송비 포함 추천' } });
  assert.equal(ev(out, 'explanations').source, 'template');
  assert.equal(EXPLAIN_SCHEMA.properties.items.maxItems, 3);
});

test('memoryTag: memory words + person, shortened to 12 characters', () => {
  assert.equal(memoryTag({ key: 'hobby:등산', label: '등산', recipientName: '아버지' }), '등산 좋아하심(아버지)');
  assert.equal(memoryTag({ key: 'pref:less_sweet', label: '단 음식 X', recipientName: '어머니' }), '단 음식 X(어머니)');
  assert.equal(memoryTag({ key: 'hobby:캠핑', label: '캠핑', recipientName: '큰외삼촌어른' }), '캠핑 좋아하심');
  assert.equal(memoryTag({ key: 'hobby:산악자전거여행하기', label: '산악자전거여행하기', recipientName: null }), '산악자전거여행하기');
  assert.equal(memoryTag({ key: 'nope', label: 'x' }), null);
});

test('review fixes: kept first-pass items, cache for unchanged facts, sensitivity-only sentence asks in A and on the port', async () => {
  // item 2 passes on the first answer, the retry breaks it: the first-pass LLM item is kept
  const first = echo(items => { items[0].tags = ['최고급', items[0].tags[1]]; items[1].tags = ['등산 좋아하심(아버지)', '양말 구성']; return items; });
  const second = echo(items => { items[1].tags = ['프리미엄', items[1].tags[1]]; items[0].tags = ['최고급', items[0].tags[1]]; return items; });
  const { llm, turn } = await setup({ json: [first, second] });
  const out = await turn({ kind: 'message', text: PARENTS });
  const ex = ev(out, 'explanations');
  assert.equal(explainCalls(llm).length, 2);
  assert.deepEqual(ex.items[1].tags, ['등산 좋아하심(아버지)', '양말 구성']);
  assert.equal(ex.source, 'mixed');
  // same facts again (view): no new LLM call, same explanation
  const again = ev(await turn({ kind: 'view' }), 'explanations');
  assert.equal(explainCalls(llm).length, 2);
  assert.deepEqual(again, ex);

  const { index } = { index: await import('../index.mjs') };
  const { initial } = await import('../../../src/vendor/engine.mjs');
  const port = await index.interpretMessage({ text: '더 저렴한 걸로 추천', state: { ...initial(), recipients: ['친구'] } });
  assert.equal(port.unresolved, true, 'the common port cannot carry sensitivity, so it asks');
  const a = await setup({ experiment: 'A', explain: null });
  await a.turn({ kind: 'message', text: '친구 한 세트 총예산 3만원 이하 상품값만 추천' });
  const asked = await a.turn({ kind: 'message', text: '더 저렴한 걸로 추천' });
  assert.deepEqual(asked.events.map(e => e.type), ['question']);
});

test('the turn log uses the condition stored in the session, even when later requests omit it', async () => {
  const store = stores.memory();
  const pipe = createPipeline({ store, products });
  const turn = (request, extra) => pipe.runPipelineTurn({ ownerId: 'userA', sessionId: 's', request, ...extra });
  await turn({ kind: 'message', text: '어머니 한 세트 세트당 예산 5만원 이하 배송비 포함 추천' }, { experiment: 'A' });
  await turn({ kind: 'view' });
  const rows = await store.listEvents('s');
  assert.deepEqual(rows.filter(r => r.type === 'turn').map(r => r.payload.experiment), ['A', 'A']);
  assert.ok(rows.filter(r => r.type === 'explanations').every(r => r.payload.experiment === 'A'));
});

// K52: tags are condition-neutral facts of the card. Judged on condition A (no contrast information may reach A), with the
// real catalog snapshot; B shows the same tags. One money format everywhere: "N.N만원" or "N,NNN원" (no "N천원").
test('K52: condition A tags carry no comparison; the review tag is "리뷰 N개"; amounts use one format; B tags are the same', async () => {
  const real = loadCatalog();
  const COMPARE = /보다|가장|제일|최다|[1-9]\s*위|더 (?:많|적|싸|저렴|비싸)|다른 상품/;
  const MONEY = /^\d+(?:\.\d)?만원$|^\d{1,3}(?:,\d{3})*원$/;
  const tagsOf = {};
  for (const experiment of ['A', 'B']) for (const seed of [false, true]) {
    const store = stores.memory();
    const people = await seedPeople(store);
    if (seed) await seedS1Memories(store, people);
    const pipe = createPipeline({ store, products: real, explain: null });
    const out = await pipe.runPipelineTurn({ ownerId: 'userA', sessionId: 's', experiment, request: { kind: 'message', text: PARENTS } });
    const cards = ev(out, 'cards'), ex = ev(out, 'explanations');
    const tags = ex.items.flatMap(i => i.tags);
    assert.deepEqual(cards.annotations.flatMap(a => a.tags), tags, 'the card event carries the same tags');
    tagsOf[`${experiment}${seed}`] = ex.items.map(i => i.tags);
    for (const t of tags) {
      assert.ok(!COMPARE.test(t), `${experiment}: comparison in tag "${t}"`);
      for (const m of t.match(/[\d.,]+(?:만|천)?원/g) ?? []) assert.match(m, MONEY, `money format in "${t}"`);
      assert.ok(!/천원/.test(t), t);
      if (t.startsWith('리뷰')) assert.match(t, /^리뷰 \d{1,3}(?:,\d{3})*개$/, t);
    }
    assert.ok(tags.some(t => t.startsWith('리뷰')), 'the review count shows as a plain number');
    if (experiment === 'B') {
      const chips = ex.items[0].ladderChips ?? [];
      assert.ok(chips.length > 0);
      for (const c of chips) for (const m of c.label.match(/[\d.,]+(?:만|천)?원/g) ?? []) assert.match(m, MONEY, c.label);
    }
  }
  assert.deepEqual(tagsOf.Afalse, tagsOf.Bfalse);
  assert.deepEqual(tagsOf.Atrue, tagsOf.Btrue);
});
