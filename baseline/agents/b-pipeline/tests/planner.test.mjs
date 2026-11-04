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

  test(`[${name}] AC13: "올리기" appears only past the threshold; otherwise the notice is shown`, async () => {
    const { store, turn } = setup(make);
    await seedPeople(store);
    // health preference with 4만원: 홍삼 (4.7만원) would be rank 1 and scores higher -> an "up" option
    const out = await turn('h', { kind: 'patch', patch: { recipients: ['부모님'], budget: budget(40000), quantity: 1, preferences: ['category:health'] } });
    const top = ev(out, 'explanations').items[0];
    const alt = budgetAlternatives(products, (await store.getSession('userA', 'h')).session.state).alternatives.find(a => a.effect === 'top_changed');
    const cards = ev(out, 'cards').result.cards;
    assert.deepEqual(top.ladderChips.filter(c => c.direction === 'up'), [{ direction: 'up', label: `올리기 +${(alt.target.total - cards[0].budget_cost_krw) / 10000}만원 · 선호에 더 맞음`, amount_krw: alt.amount }]);
    assert.equal(top.ladderNotice, undefined);
    // the same people with no preference: no alternative changes rank 1 -> no up chip, the notice instead
    const plain = await turn('p', { kind: 'patch', patch: { recipients: ['부모님'], budget: budget(30000), quantity: 1 } });
    const ptop = ev(plain, 'explanations').items[0];
    assert.ok(!(ptop.ladderChips ?? []).some(c => c.direction === 'up'));
    assert.equal(ptop.ladderNotice, NO_BETTER_UP);
  });

  test(`[${name}] AC13: the threshold follows the session sensitivity (config/value-ladder.v1.json)`, async () => {
    const cfg = loadLadderConfig();
    // parents, coffee/decor excluded, 3만원: rank 1 scores 0; at 3.1만원 a food set scores 1 (gain 1)
    const state = checkedPatch(createSession('x').state, { recipients: ['부모님'], budget: budget(30000), quantity: 1, excluded_categories: ['coffee_tea', 'decor'] });
    const session = { id: 'x', version: 0, state };
    const cards = (await runTurn({ session, products, request: { kind: 'view', expectedVersion: 0 } })).result.cards;
    const ranked = rankProducts(products, state).items;
    const balanced = await planValueLadder({ session, state, products, cards, sensitivity: 'balanced' });
    const value = await planValueLadder({ session, state, products, cards, sensitivity: 'value' });
    const gain = balanced.up[0].scoreGain;
    assert.ok(gain >= cfg.minScoreGain.balanced && gain < cfg.minScoreGain.value, `gain ${gain} sits between the two thresholds`);
    assert.equal(balanced.up[0].reason, 'score');
    assert.deepEqual([value.up, value.upNotice], [[], NO_BETTER_UP]);
    assert.equal(ranked[0].id, cards[0].id);
  });

  test(`[${name}] AC13: popularity path — same score, more reviews per 10,000 KRW past the threshold`, async () => {
    const state = checkedPatch(createSession('x').state, { recipients: ['친구'], budget: budget(10000, false), quantity: 1 });
    const session = { id: 'x', version: 0, state };
    const cards = (await runTurn({ session, products: teas, request: { kind: 'view', expectedVersion: 0 } })).result.cards;
    const l = await planValueLadder({ session, state, products: teas, cards, sensitivity: 'balanced' });
    assert.deepEqual(l.up.map(o => [o.newTopId, o.reason, o.scoreGain, o.costDelta, o.amount_krw]), [['tea-b', 'popularity', 0, 10000, 20000]]);
  });

  test(`[${name}] AC14 S4: a capped recipient never sees "올리기", and nothing above the cap appears anywhere`, async () => {
    const store = make();
    const people = await seedPeople(store);
    const pipe = createPipeline({ store, products, now: NOW });
    const t = request => pipe.runPipelineTurn({ ownerId: 'userB', sessionId: 'p', request });
    const cap = people.prof.budgetCapKrw;
    const above = products.filter(p => budgetCost(p, { budget: budget(cap), quantity: 1 }) > cap).map(p => p.name);
    // no budget yet: the baseline question plus a cap chip (R3: never filled in)
    const ask = ev(await t({ kind: 'message', text: '교수님 스승의 날 선물 추천해줘' }), 'question');
    assert.equal(ask.question, '예산 상한을 알려주세요.');
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

  test(`[${name}] AC15: a price option re-recommends at its budget and recomputes the options; nothing changes before`, async () => {
    const { store, turn } = setup(make);
    await seedPeople(store);
    const first = await turn('h', { kind: 'patch', patch: { recipients: ['부모님'], budget: budget(40000), quantity: 1, preferences: ['category:health'] } });
    const chip = ev(first, 'explanations').items[0].ladderChips.find(c => c.direction === 'up');
    const before = await store.getSession('userA', 'h');
    assert.equal(before.session.state.budget.amount_krw, 40000, 'showing options does not change the budget');
    assert.deepEqual(await store.getSession('userA', 'h'), before);
    const picked = await turn('h', { kind: 'ladder_pick', direction: 'up' });
    const row = await store.getSession('userA', 'h');
    assert.equal(row.session.state.budget.amount_krw, chip.amount_krw);
    const expected = await runTurn({ session: before.session, products, request: { kind: 'what_if_budget', amount_krw: chip.amount_krw, expectedVersion: before.session.version } });
    assert.deepEqual(ev(picked, 'cards').result.cards.map(c => c.id), expected.result.cards.map(c => c.id));
    const again = ev(picked, 'explanations').items[0];
    const recomputed = await planValueLadder({ session: row.session, state: row.session.state, products, cards: ev(picked, 'cards').result.cards, sensitivity: row.meta.sensitivity });
    assert.deepEqual((again.ladderChips ?? []).map(c => c.amount_krw), [...recomputed.down, ...recomputed.up].map(o => o.amount_krw), 'options recomputed from the new budget');
    assert.equal(row.meta.sensitivity, 'quality', 'up moves the session sensitivity one step');
    // a direction with no option is refused, nothing written
    const none = await turn('h', { kind: 'ladder_pick', direction: 'up' });
    assert.equal(ev(none, 'error').code, 'invalid_request');
    assert.deepEqual(await store.getSession('userA', 'h'), row);
  });

  test(`[${name}] F4: two picks the same way for the same person ask once; the answer is stored on the person`, async () => {
    const { store, turn } = setup(make, { catalog: teas });
    const { friend } = await seedPeople(store);
    await turn('f', { kind: 'patch', patch: { recipients: ['친구'], budget: budget(10000, false), quantity: 1 } });
    const one = await turn('f', { kind: 'ladder_pick', direction: 'up' });
    assert.equal(ev(one, 'memory_prompt'), undefined);
    const two = await turn('f', { kind: 'ladder_pick', direction: 'up' });
    const p = ev(two, 'memory_prompt');
    assert.deepEqual([p.kind, p.sensitivity, p.text], ['sensitivity', 'quality', '품질 우선으로 기억할까요?']);
    assert.equal((await store.getRecipient('userA', friend.id)).priceSensitivity, 'balanced', 'nothing stored before the answer');
    await turn('f', { kind: 'memory_edit', op: 'sensitivity', accept: true });
    assert.equal((await store.getRecipient('userA', friend.id)).priceSensitivity, 'quality');
    // the next session for this person starts from it
    await turn('f2', { kind: 'patch', patch: { recipients: ['친구'], budget: budget(10000, false), quantity: 1 } });
    assert.equal((await store.getSession('userA', 'f2')).meta.sensitivity, 'quality');
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
  assert.throws(() => loadLadderConfig({ minScoreGain: { value: 1 } }), { code: 'invalid_value_ladder' });
});

test('review: a pending sensitivity / dismissal answer is never written to people who replaced the asked ones', async () => {
  const { store, turn } = setup(stores.memory, { catalog: teas });
  const { friend, mom } = await seedPeople(store);
  await turn('f', { kind: 'patch', patch: { recipients: ['친구'], budget: budget(10000, false), quantity: 1 } });
  await turn('f', { kind: 'ladder_pick', direction: 'up' });
  assert.equal(ev(await turn('f', { kind: 'ladder_pick', direction: 'up' }), 'memory_prompt').kind, 'sensitivity');
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
