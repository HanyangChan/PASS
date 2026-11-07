// P4 planner: contrast, memory counterfactual (R6), value ladder (R3, sensitivity), factsheet (condition A has no keys).
// AC7 10 12 13 14 15. Expected values are recomputed independently with the common runTurn / engine, never hard-coded
// from the planner's own output. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { runTurn, createSession, budgetAlternatives } from '../../../src/index.mjs';
import { checkedPatch } from '../../../src/contracts.mjs';
import { budgetCost, rankProducts } from '../../../src/vendor/engine.mjs';
import { createPipeline } from '../pipeline/index.mjs';
import { buildFactsheet, planContrast, planMemoryCf, planValueLadder, shiftSensitivity, loadLadderConfig, NO_BETTER_UP } from '../planner/index.mjs';
import { products } from './fixtures/catalog.mjs';
import { loadCatalog } from '../data/load.mjs';
import { stores, seedPeople, seedS1Memories } from './fixtures/people.mjs';

const NOW = () => '2027-01-25T03:00:00.000Z';
const PARENTS = '부모님 한 세트 세트당 예산 5만원 이하 배송비 포함 추천';
const ev = (r, type) => r.events.find(e => e.type === type);
const evs = (r, type) => r.events.filter(e => e.type === type);
const B_KEYS = ['contrastChip', 'memoryCfLine', 'ladderChips', 'ladderNotice'];
const budget = (amount_krw, shipping_included = true) => ({ amount_krw, scope: 'per_set', shipping_included });

function setup(make, { catalog = products } = {}) {
  const store = make();
  const pipe = createPipeline({ store, products: catalog, now: NOW });
  const turn = (sessionId, request, extra = {}) => pipe.runPipelineTurn({ ownerId: 'userA', sessionId, request, ...extra });
  return { store, pipe, turn };
}

// Test-local catalog (the shared fixture stays fixed, K13): three teas with the same engine score, so only popularity
// and price separate them — the popularity path of "올리기" and two picks in the same direction.
const base = { stock_sets: 20, arrival_date: '2026-12-01', brand: '데모', packaging: 'basic', allergens_declared: [], shipping_fee_per_set_krw: 0, sweetness: 'unknown', category: 'coffee_tea' };
const teas = [
  { ...base, id: 'tea-a', name: '찻잎 A 세트', price_krw: 30000, rating_count: 1000 },
  { ...base, id: 'tea-b', name: '찻잎 B 세트', price_krw: 20000, rating_count: 500 },
  { ...base, id: 'tea-c', name: '찻잎 C 세트', price_krw: 10000, rating_count: 100 },
];

// Test-local catalog with ratings (the shared fixture has none): same engine score, so only popularity, price and rating differ.
const rated = [
  { ...base, id: 'r-top', name: '기본 차 세트', price_krw: 20000, rating_count: 1000, rating: 4.0 },
  { ...base, id: 'r-up', name: '평점 높은 차 세트', price_krw: 26000, rating_count: 500, rating: 4.6 },
  { ...base, id: 'r-same', name: '같은 평점 차 세트', price_krw: 22000, rating_count: 400, rating: 4.0 },
  { ...base, id: 'r-far', name: '많이 비싼 차 세트', price_krw: 60000, rating_count: 300, rating: 4.9 },
  { ...base, id: 'r-low', name: '저렴한 차 세트', price_krw: 15000, rating_count: 200, rating: 3.8 },
];

/** The rank-1 product after removing exactly the given state values, by the common runTurn (independent of the planner). */
async function topWithout(state, patch) {
  const s = { ...createSession('x'), state: checkedPatch(state, patch) };
  return (await runTurn({ session: s, products, request: { kind: 'view', expectedVersion: 0 } })).result.cards[0].id;
}

for (const [name, make] of Object.entries(stores)) {
  test(`[${name}] AC10: the memory counterfactual names exactly the rank 1 recomputed without that memory`, async () => {
    const { store, turn } = setup(make);
    const people = await seedPeople(store);
    const m = await seedS1Memories(store, people);
    const out = await turn('s', { kind: 'message', text: PARENTS });
    const cards = ev(out, 'cards').result.cards;
    const top = ev(out, 'explanations').items[0];
    const { session, meta } = await store.getSession('userA', 's');
    const state = session.state;
    // 'less_sweet' came only from the 단 음식 X memory; recompute rank 1 without it (and nothing else)
    const expected = await topWithout(state, { preferences: state.preferences.filter(p => p !== 'less_sweet') });
    assert.notEqual(expected, cards[0].id, 'precondition: this memory changes rank 1');
    const expectedName = products.find(p => p.id === expected).name;
    assert.equal(top.memoryCfLine, `'단 음식 X' 기억이 없었다면 1위는 ${expectedName}`);
    const memory = { items: [{ memoryId: m.sweet.id, key: 'pref:less_sweet', field: 'preferences', value: 'less_sweet', label: '단 음식 X', evidence: m.sweet.evidence }] };
    const cf = await planMemoryCf({ session, state, provenance: meta.provenance, memory, products, cards });
    assert.deepEqual([cf.memoryId, cf.newTopId], [m.sweet.id, expected]);
    assert.deepEqual(state, (await store.getSession('userA', 's')).session.state, 'the real session is untouched');
  });

  test(`[${name}] AC10: when no memory changes rank 1 there is no counterfactual line`, async () => {
    const { store, turn } = setup(make);
    const people = await seedPeople(store);
    await seedS1Memories(store, people);
    const out = await turn('s', { kind: 'message', text: '어머니 한 세트 세트당 예산 5만원 이하 배송비 포함 추천' });
    const { session } = await store.getSession('userA', 's');
    assert.equal(await topWithout(session.state, { preferences: [] }), ev(out, 'cards').result.cards[0].id, 'precondition: rank 1 is unchanged');
    assert.equal(ev(out, 'explanations').items[0].memoryCfLine, undefined);
  });

  test(`[${name}] AC12: condition A shows no contrast / counterfactual / price options; cards are identical to B`, async () => {
    const runs = {};
    for (const experiment of ['A', 'B']) {
      const { store, turn } = setup(make);
      const people = await seedPeople(store);
      await seedS1Memories(store, people);
      runs[experiment] = await turn('s', { kind: 'message', text: PARENTS }, { experiment });
    }
    for (const k of ['result', 'annotations']) assert.deepEqual(ev(runs.A, 'cards')[k], ev(runs.B, 'cards')[k], k); // ids differ only by store uuid
    for (const item of ev(runs.A, 'explanations').items) for (const k of B_KEYS) assert.ok(!Object.hasOwn(item, k), k);
    const bTop = ev(runs.B, 'explanations').items[0];
    assert.ok(bTop.contrastChip && bTop.memoryCfLine, 'B has them for the same cards');
    assert.deepEqual(ev(runs.A, 'explanations').items.map(i => i.tags), ev(runs.B, 'explanations').items.map(i => i.tags), 'tags are the same in A and B (F5)');
  });

  test(`[${name}] AC13 (K50): "올리기" is an alternative with the SAME engine score, a HIGHER rating and a cost rise within the config limit; otherwise the notice`, async () => {
    const { store, turn } = setup(make, { catalog: rated });
    await seedPeople(store);
    const out = await turn('r', { kind: 'patch', patch: { recipients: ['친구'], budget: budget(70000, false), quantity: 1 } });
    const state = (await store.getSession('userA', 'r')).session.state;
    const ranked = rankProducts(rated, state).items;
    assert.equal(ranked[0].id, 'r-top', 'precondition: rank 1 by the engine');
    const top = ev(out, 'explanations').items[0];
    // r-up: same score, rating 4.0 -> 4.6, +6,000원 (limit for balanced = 10,000). r-same (same rating), r-far (+40,000), r-low (cheaper) are not offered.
    assert.deepEqual(top.ladderChips.filter(c => c.direction === 'up'), [{ direction: 'up', label: '올리기 +6,000원 · 평점 4.0 → 4.6', productId: 'r-up' }]);
    assert.equal(top.ladderNotice, undefined);
    assert.deepEqual(top.ladderChips.find(c => c.direction === 'down'), { direction: 'down', label: '아끼기 -5,000원 · 같은 적합도', amount_krw: 15000 });
    // the fixture catalog has no ratings at all -> no option, the notice instead
    const plain = await setup(make).turn('p', { kind: 'patch', patch: { recipients: ['부모님'], budget: budget(30000), quantity: 1 } });
    const ptop = ev(plain, 'explanations').items[0];
    assert.ok(!(ptop.ladderChips ?? []).some(c => c.direction === 'up'));
    assert.equal(ptop.ladderNotice, NO_BETTER_UP);
  });

  test(`[${name}] AC13: the cost limit follows the session sensitivity (config/value-ladder.v1.json)`, async () => {
    const cfg = loadLadderConfig();
    const state = checkedPatch(createSession('x').state, { recipients: ['친구'], budget: budget(70000, false), quantity: 1 });
    const session = { id: 'x', version: 0, state };
    const cards = (await runTurn({ session, products: rated, request: { kind: 'view', expectedVersion: 0 } })).result.cards;
    const plan = sensitivity => planValueLadder({ session, state, products: rated, cards, sensitivity });
    assert.ok(cfg.maxUpCostDeltaKrw.value < 6000 && 6000 <= cfg.maxUpCostDeltaKrw.balanced, 'precondition: 6,000원 sits between the limits');
    const value = await plan('value'), balanced = await plan('balanced'), quality = await plan('quality');
    assert.deepEqual([value.up, value.upNotice], [[], NO_BETTER_UP]);
    assert.deepEqual(balanced.up.map(o => [o.productId, o.costDelta, o.rating]), [['r-up', 6000, { from: 4.0, to: 4.6 }]]);
    assert.deepEqual(quality.up.map(o => o.productId), ['r-up'], 'r-far (+40,000원) is past every limit');
  });

  test(`[${name}] AC13: a lower or equal rating, another score, or no rating is never offered`, async () => {
    const mk = extra => [{ ...base, id: 't1', name: '기준', price_krw: 20000, rating_count: 900, rating: 4.2 }, { ...base, ...extra }];
    const run = async (list, preferences = []) => {
      const state = checkedPatch(createSession('x').state, { recipients: ['친구'], budget: budget(70000, false), quantity: 1, preferences });
      const session = { id: 'x', version: 0, state };
      const cards = (await runTurn({ session, products: list, request: { kind: 'view', expectedVersion: 0 } })).result.cards;
      return (await planValueLadder({ session, state, products: list, cards })).up;
    };
    assert.equal((await run(mk({ id: 't2', name: '높음', price_krw: 23000, rating_count: 800, rating: 4.5 }))).length, 1, 'control');
    assert.deepEqual(await run(mk({ id: 't2', name: '같음', price_krw: 23000, rating_count: 800, rating: 4.2 })), []);
    assert.deepEqual(await run(mk({ id: 't2', name: '낮음', price_krw: 23000, rating_count: 800, rating: 3.9 })), []);
    assert.deepEqual(await run(mk({ id: 't2', name: '평점 없음', price_krw: 23000, rating_count: 800 })), []);
    assert.deepEqual(await run(mk({ id: 't2', name: '다른 점수', category: 'decor', price_krw: 23000, rating_count: 800, rating: 4.9 }), ['category:coffee_tea']), [], 'rank 1 scores 3, the decor set 0');
  });

  test(`[${name}] K50: the engine ranking does not change — options are read from rankProducts and nothing is sorted or scored`, async () => {
    const { store, turn } = setup(make, { catalog: rated });
    await seedPeople(store);
    const out = await turn('r', { kind: 'patch', patch: { recipients: ['친구'], budget: budget(70000, false), quantity: 1 } });
    const row = await store.getSession('userA', 'r');
    const engine = rankProducts(rated, row.session.state).items.map(p => [p.id, p.score]);
    const baseline = await runTurn({ session: { id: 'r', version: row.session.version, state: row.session.state }, products: rated, request: { kind: 'view', expectedVersion: row.session.version } });
    assert.deepEqual(ev(out, 'cards').result.cards.map(c => c.id), baseline.result.cards.map(c => c.id), 'cards are the baseline cards');
    assert.deepEqual(ev(out, 'cards').result.cards.map(c => c.id), engine.slice(0, 3).map(x => x[0]));
    assert.equal(ev(out, 'cards').result.cards[0].id, 'r-top', 'the higher-rated r-up does not displace rank 1');
    const state = structuredClone(row.session.state);
    await planValueLadder({ session: row.session, state, products: rated, cards: ev(out, 'cards').result.cards });
    assert.deepEqual(state, row.session.state, 'planning leaves the state untouched');
    assert.deepEqual(rankProducts(rated, state).items.map(p => [p.id, p.score]), engine, 'and the engine order is the same afterwards');
  });

  test(`[${name}] AC14 S4: a capped recipient never sees "올리기", and nothing above the cap appears anywhere`, async () => {
    const store = make();
    const people = await seedPeople(store);
    const pipe = createPipeline({ store, products, now: NOW });
    const t = request => pipe.runPipelineTurn({ ownerId: 'userB', sessionId: 'p', request });
    const cap = people.prof.budgetCapKrw;
    const above = products.filter(p => budgetCost(p, { budget: budget(cap), quantity: 1 }) > cap).map(p => p.name);
    // no budget yet: main's question plus a cap chip (R3: never filled in)
    const ask = ev(await t({ kind: 'message', text: '교수님 스승의 날 선물 추천해줘' }), 'question');
    assert.equal(ask.question, '얼마까지 쓰고 싶으세요?');
    assert.deepEqual(ask.budgetChips, [{ label: '3만원', amount_krw: cap }]);
    assert.equal((await store.getSession('userB', 'p')).session.state.budget.amount_krw, null, 'not filled from the cap');
    const out = await t({ kind: 'patch', patch: { budget: budget(cap), quantity: 1, packaging: 'formal' } });
    const ex = ev(out, 'explanations');
    assert.ok(ev(out, 'cards').result.cards.length > 0);
    assert.ok(!ex.items.some(i => (i.ladderChips ?? []).some(c => c.direction === 'up')), 'no up chip');
    assert.ok(!ex.items.some(i => i.ladderNotice), 'no "raise" wording either');
    const text = JSON.stringify(out.events);
    for (const n of above) assert.ok(!text.includes(n), `above cap: ${n}`);
    // a budget above the cap is asked, never clamped and never shown; what-if above the cap is refused the same way
    const over = await t({ kind: 'patch', patch: { budget: { amount_krw: 50000 } } });
    assert.deepEqual(over.events.map(e => e.type), ['question']);
    assert.deepEqual(ev(over, 'question').budgetChips, [{ label: '3만원', amount_krw: cap }]);
    assert.equal((await store.getSession('userB', 'p')).session.state.budget.amount_krw, 50000, 'the user value is kept, not clamped');
    await t({ kind: 'patch', patch: { budget: { amount_krw: cap } } });
    const whatIf = await t({ kind: 'what_if_budget', amount_krw: 50000 });
    assert.deepEqual(whatIf.events.map(e => e.type), ['question']);
    for (const n of above) assert.ok(!JSON.stringify(whatIf.events).includes(n));
  });

  test(`[${name}] AC15: "아끼기" re-recommends at its budget and recomputes the options; nothing changes before`, async () => {
    const { store, turn } = setup(make, { catalog: rated });
    await seedPeople(store);
    const first = await turn('h', { kind: 'patch', patch: { recipients: ['친구'], budget: budget(70000, false), quantity: 1 } });
    const chip = ev(first, 'explanations').items[0].ladderChips.find(c => c.direction === 'down');
    const before = await store.getSession('userA', 'h');
    assert.equal(before.session.state.budget.amount_krw, 70000, 'showing options does not change the budget');
    assert.deepEqual(await store.getSession('userA', 'h'), before);
    const picked = await turn('h', { kind: 'ladder_pick', direction: 'down' });
    const row = await store.getSession('userA', 'h');
    assert.equal(row.session.state.budget.amount_krw, chip.amount_krw);
    const expected = await runTurn({ session: before.session, products: rated, request: { kind: 'what_if_budget', amount_krw: chip.amount_krw, expectedVersion: before.session.version } });
    assert.deepEqual(ev(picked, 'cards').result.cards.map(c => c.id), expected.result.cards.map(c => c.id));
    const again = ev(picked, 'explanations').items[0];
    const recomputed = await planValueLadder({ session: row.session, state: row.session.state, products: rated, cards: ev(picked, 'cards').result.cards, sensitivity: row.meta.sensitivity });
    assert.deepEqual((again.ladderChips ?? []).length, recomputed.down.length + recomputed.up.length, 'options recomputed from the new budget');
    assert.equal(row.meta.sensitivity, 'value', 'down moves the session sensitivity one step');
    // a direction with no option is refused, nothing written; "올리기" is not a ladder_pick any more (K50)
    const none = await turn('h', { kind: 'ladder_pick', direction: 'down' });
    assert.equal(ev(none, 'error').code, 'invalid_request');
    assert.equal(ev(await turn('h', { kind: 'ladder_pick', direction: 'up' }), 'error').code, 'invalid_request');
    assert.deepEqual(await store.getSession('userA', 'h'), row);
  });

  test(`[${name}] K50: ladder_compare puts the alternative in the tray; budget, cards, version and sensitivity stay`, async () => {
    const { store, turn } = setup(make, { catalog: rated });
    await seedPeople(store);
    const first = await turn('c', { kind: 'patch', patch: { recipients: ['친구'], budget: budget(70000, false), quantity: 1 } });
    const chip = ev(first, 'explanations').items[0].ladderChips.find(c => c.direction === 'up');
    const before = await store.getSession('userA', 'c');
    const out = await turn('c', { kind: 'ladder_compare', productId: chip.productId });
    assert.deepEqual(out.events, [{ type: 'compare_add', version: before.session.version, productId: 'r-up', productName: '평점 높은 차 세트', againstId: 'r-top', costDelta: 6000, rating: { from: 4.0, to: 4.6 } }]);
    assert.deepEqual(await store.getSession('userA', 'c'), before, 'nothing saved: budget, card order, sensitivity unchanged');
    // only an offered option can be added: another product, or none, is refused
    for (const productId of ['r-far', 'r-low', 'nope', undefined]) assert.equal(ev(await turn('c', { kind: 'ladder_compare', productId }), 'error').code, 'invalid_request', String(productId));
    // condition A has no price options
    await turn('ca', { kind: 'patch', patch: { recipients: ['친구'], budget: budget(70000, false), quantity: 1 } }, { experiment: 'A' });
    assert.equal(ev(await turn('ca', { kind: 'ladder_compare', productId: 'r-up' }), 'error').code, 'invalid_request');
  });

  test(`[${name}] F4: two picks the same way for the same person ask once; the answer is stored on the person`, async () => {
    const { store, turn } = setup(make, { catalog: teas });
    const { friend } = await seedPeople(store);
    await turn('f', { kind: 'patch', patch: { recipients: ['친구'], budget: budget(30000, false), quantity: 1 } });
    const one = await turn('f', { kind: 'ladder_pick', direction: 'down' });
    assert.equal(ev(one, 'memory_prompt'), undefined);
    await turn('f', { kind: 'patch', patch: { budget: budget(30000, false) } });
    const two = await turn('f', { kind: 'ladder_pick', direction: 'down' });
    const p = ev(two, 'memory_prompt');
    assert.deepEqual([p.kind, p.sensitivity, p.text], ['sensitivity', 'value', '가성비 위주로 기억할까요?']);
    assert.equal((await store.getRecipient('userA', friend.id)).priceSensitivity, 'balanced', 'nothing stored before the answer');
    await turn('f', { kind: 'memory_edit', op: 'sensitivity', accept: true });
    assert.equal((await store.getRecipient('userA', friend.id)).priceSensitivity, 'value');
    // the next session for this person starts from it
    await turn('f2', { kind: 'patch', patch: { recipients: ['친구'], budget: budget(10000, false), quantity: 1 } });
    assert.equal((await store.getSession('userA', 'f2')).meta.sensitivity, 'value');
    assert.equal(ev(await turn('f', { kind: 'memory_edit', op: 'sensitivity', accept: true }), 'error').code, 'invalid_request', 'answered once');
  });

  test(`[${name}] AC7: no planner path removes an allergy; the allergen product appears in no fact`, async () => {
    const { store, turn } = setup(make);
    const people = await seedPeople(store);
    const m = await seedS1Memories(store, people);
    // coffee excluded by the user: removing the 땅콩 memory WOULD make the peanut set rank 1, so the guard matters
    await turn('s', { kind: 'message', text: PARENTS });
    const out = await turn('s', { kind: 'patch', patch: { excluded_categories: ['coffee_tea'], preferences: [] } });
    const { session, meta } = await store.getSession('userA', 's');
    assert.equal(await topWithout(session.state, { excluded_ingredients: [] }), 'peanut-gangjeong', 'precondition');
    const memory = { items: [{ memoryId: m.peanut.id, key: 'allergy:땅콩', field: 'excluded_ingredients', value: '땅콩', label: '땅콩 제외', evidence: m.peanut.evidence }], giftHistory: [] };
    const sheet = await buildFactsheet({ session, cards: ev(out, 'cards').result.cards, products, state: session.state, provenance: meta.provenance, memory, experiment: 'B' });
    assert.equal(sheet.memoryCf, null);
    assert.ok(!JSON.stringify(sheet).includes('peanut-gangjeong'));
    assert.ok(!JSON.stringify(out.events).includes('땅콩 강정'));
    assert.ok(sheet.items.every(i => i.allergyNotice), 'the allergy notice stays on every item');
    assert.deepEqual(session.state.excluded_ingredients, ['땅콩']);
  });
}

test('factsheet: condition A has no contrast / memoryCf / valueLadder keys at all; B has all three', async () => {
  const session = { ...createSession('x'), state: checkedPatch(createSession('x').state, { recipients: ['친구'], budget: budget(30000), quantity: 1 }) };
  const cards = (await runTurn({ session, products, request: { kind: 'view', expectedVersion: 0 } })).result.cards;
  const a = await buildFactsheet({ session, cards, products, state: session.state, experiment: 'A' });
  for (const k of ['contrast', 'memoryCf', 'valueLadder']) assert.ok(!Object.hasOwn(a, k), k);
  const b = await buildFactsheet({ session, cards, products, state: session.state, experiment: 'B' });
  for (const k of ['contrast', 'memoryCf', 'valueLadder']) assert.ok(Object.hasOwn(b, k), k);
  assert.deepEqual(a.items, b.items);
  const i = a.items[0], p = products.find(x => x.id === cards[0].id);
  assert.deepEqual([i.rank, i.budgetCost, i.budget, i.headroom, i.ratingCount], [1, cards[0].budget_cost_krw, 30000, 30000 - cards[0].budget_cost_krw, p.rating_count]);
});

test('contrast: one engine fact, by fixed priority, between rank 1 and rank 2', () => {
  const st = over => checkedPatch(createSession('x').state, { recipients: ['부모님'], budget: budget(50000), quantity: 1, ...over });
  const view = state => rankProducts(products, state).items.slice(0, 3).map(p => ({ id: p.id }));
  const pref = st({ preferences: ['category:health'] });
  assert.equal(planContrast({ products, state: pref, cards: view(pref) }).kind, 'preference');
  const plain = st({});
  const c = planContrast({ products, state: plain, cards: view(plain) });
  const [r1, r2] = rankProducts(products, plain).items;
  assert.deepEqual([c.kind, c.diff], ['rating_count', r1.rating_count - r2.rating_count]);
  assert.equal(planContrast({ products, state: plain, cards: view(plain).slice(0, 1) }), null, 'one card: nothing to contrast');
  assert.throws(() => planContrast({ products, state: plain, cards: [{ id: 'hand-cream' }, { id: 'drip-coffee' }] }), { code: 'cards_not_engine_order' });
});

test('value ladder: "아끼기" is the cheapest same-score product, re-run as a budget', async () => {
  const state = checkedPatch(createSession('x').state, { recipients: ['친구'], budget: budget(30000), quantity: 1 });
  const session = { id: 'x', version: 0, state };
  const cards = (await runTurn({ session, products, request: { kind: 'view', expectedVersion: 0 } })).result.cards;
  const l = await planValueLadder({ session, state, products, cards });
  const ranked = rankProducts(products, state).items;
  const same = ranked.filter(p => p.score === ranked[0].score && budgetCost(p, state) < budgetCost(ranked[0], state));
  const amount = Math.min(...same.map(p => budgetCost(p, state)));
  const expected = await runTurn({ session, products, request: { kind: 'what_if_budget', amount_krw: amount, expectedVersion: 0 } });
  assert.deepEqual(l.down.map(o => [o.amount_krw, o.newTopId, o.costDelta]), [[amount, expected.result.cards[0].id, expected.result.cards[0].budget_cost_krw - cards[0].budget_cost_krw]]);
  assert.ok(l.down[0].costDelta < 0);
  assert.deepEqual((await planValueLadder({ session, state, products, cards, budgetCap: 30000 })).up, [], 'cap: never up');
});

test('sensitivity moves one step per pick and stops at the ends', () => {
  assert.deepEqual(['value', 'balanced', 'quality'].map(s => [shiftSensitivity(s, 'down'), shiftSensitivity(s, 'up')]),
    [['value', 'balanced'], ['value', 'quality'], ['balanced', 'quality']]);
  assert.throws(() => loadLadderConfig({ maxUpOptions: 1, maxDownOptions: 1 }), { code: 'invalid_value_ladder' });
  assert.throws(() => loadLadderConfig({ maxUpCostDeltaKrw: { value: 1, balanced: 1 }, maxUpOptions: 1, maxDownOptions: 1 }), { code: 'invalid_value_ladder' });
});

test('review: a pending sensitivity / dismissal answer is never written to people who replaced the asked ones', async () => {
  const { store, turn } = setup(stores.memory, { catalog: teas });
  const { friend, mom } = await seedPeople(store);
  await turn('f', { kind: 'patch', patch: { recipients: ['친구'], budget: budget(30000, false), quantity: 1 } });
  await turn('f', { kind: 'ladder_pick', direction: 'down' });
  await turn('f', { kind: 'patch', patch: { budget: budget(30000, false) } });
  assert.equal(ev(await turn('f', { kind: 'ladder_pick', direction: 'down' }), 'memory_prompt').kind, 'sensitivity');
  await turn('f', { kind: 'feedback', action: 'dismissed', productId: 'tea-a' });
  await turn('f', { kind: 'patch', patch: { recipients: ['어머니'] } });
  assert.equal(ev(await turn('f', { kind: 'memory_edit', op: 'sensitivity', accept: true }), 'error').code, 'invalid_request');
  assert.equal(ev(await turn('f', { kind: 'feedback', action: 'dismissed', productId: 'tea-a', scope: 'category' }), 'error').code, 'invalid_request');
  assert.equal((await store.getRecipient('userA', mom.id)).priceSensitivity, 'balanced');
  assert.equal((await store.getRecipient('userA', friend.id)).priceSensitivity, 'balanced');
  assert.deepEqual(await store.listMemories('userA', mom.id), []);
});

test('review: a sensitivity chip sent with the first turn is kept; condition A refuses price options and the chip', async () => {
  const { store, turn } = setup(stores.memory);
  await seedPeople(store);
  await turn('s', { kind: 'patch', patch: { recipients: ['친구'], budget: budget(30000), quantity: 1 }, sensitivity: 'value' });
  assert.equal((await store.getSession('userA', 's')).meta.sensitivity, 'value');
  await turn('a', { kind: 'patch', patch: { recipients: ['친구'], budget: budget(30000), quantity: 1 } }, { experiment: 'A' });
  assert.equal(ev(await turn('a', { kind: 'ladder_pick', direction: 'down' }), 'error').code, 'invalid_request');
  assert.equal(ev(await turn('a', { kind: 'patch', patch: {}, sensitivity: 'value' }), 'error').code, 'invalid_request');
});

test('review K37: the cap is per set with shipping — 상품값만 or 총예산 cannot slip a product above it', async () => {
  const store = stores.memory();
  const { prof } = await seedPeople(store);
  // test-local edge product: 2.9만원 + 배송비 3천원 = 3.2만원, the most reviewed tea, so it is rank 1 when shipping is excluded
  const catalog = [...products, { ...base, id: 'cap-edge', name: '경계 가격 차 세트', price_krw: 29000, shipping_fee_per_set_krw: 3000, rating_count: 5000 }];
  const pipe = createPipeline({ store, products: catalog, now: NOW });
  const t = (sessionId, request) => pipe.runPipelineTurn({ ownerId: 'userB', sessionId, request });
  const cap = prof.budgetCapKrw;
  const above = catalog.filter(p => p.price_krw + p.shipping_fee_per_set_krw > cap).map(p => p.name);
  // 상품값만 3만원: 2.9만원 + 배송비 3천원 products would be cards -> asked instead
  const noShip = await t('a', { kind: 'patch', patch: { recipients: ['교수님'], budget: budget(cap, false), quantity: 1 } });
  assert.deepEqual(noShip.events.map(e => e.type), ['question']);
  assert.deepEqual(ev(noShip, 'question').budgetChips, [{ label: '3만원', amount_krw: cap }]);
  // 총예산 6만원 for 2 sets = 3만원 per set: allowed, and nothing above the cap anywhere
  const total = await t('b', { kind: 'patch', patch: { recipients: ['교수님'], budget: { amount_krw: 2 * cap, scope: 'total', shipping_included: true }, quantity: 2, same_product: true } });
  assert.ok(ev(total, 'cards').result.cards.length > 0);
  for (const n of above) assert.ok(!JSON.stringify(total.events).includes(n), n);
  // a non-budget question carries no cap chip
  const q = await t('c', { kind: 'patch', patch: { recipients: ['교수님'], budget: budget(cap) } });
  assert.equal(ev(q, 'question').budgetChips, null);
});

// K50 on the real snapshot (data/): the "올리기" alternative must exist in the 5만원 parents scenario, with and without memories,
// and it must be a product the engine itself lists with the same score as rank 1 and a higher rating.
for (const [name, make] of Object.entries(stores)) {
  test(`[${name}] K50: real catalog, 부모님 5만원 — "올리기" is offered (S1 without memory, S2 with memory)`, async () => {
    const real = loadCatalog();
    for (const seed of [false, true]) {
      const store = make();
      const people = await seedPeople(store);
      if (seed) await seedS1Memories(store, people);
      const pipe = createPipeline({ store, products: real, explain: null, now: NOW });
      const out = await pipe.runPipelineTurn({ ownerId: 'userA', sessionId: 's', request: { kind: 'message', text: PARENTS } });
      const up = ev(out, 'explanations').items[0].ladderChips.find(c => c.direction === 'up');
      assert.ok(up, `seed=${seed}: an up chip`);
      const state = (await store.getSession('userA', 's')).session.state;
      const [top] = rankProducts(real, state).items;
      const alt = rankProducts(real, state).items.find(p => p.id === up.productId);
      assert.equal(alt.score, top.score);
      assert.ok(alt.rating > top.rating);
      const delta = budgetCost(alt, state) - budgetCost(top, state);
      assert.ok(delta > 0 && delta <= loadLadderConfig().maxUpCostDeltaKrw.balanced);
      assert.match(up.label, /^올리기 \+(?:\d+(?:\.\d)?만원|\d{1,3}(?:,\d{3})*원) · 평점 \d\.\d → \d\.\d$/);
      assert.equal(ev(out, 'cards').result.cards[0].id, top.id, 'rank 1 is still the engine rank 1');
    }
  });
}
