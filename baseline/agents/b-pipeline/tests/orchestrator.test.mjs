// P3 orchestrator: AC1 (baseline equality), AC2, AC3 (event order), AC4 + R8 (S1 -> purchased -> end -> confirm -> S2),
// AC5, AC6, AC9, R9, stale sessions. Every test runs on the in-memory store and on node:sqlite. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, runTurn } from '../../../src/index.mjs';
import { initial } from '../../../src/vendor/engine.mjs';
import { createPipeline } from '../pipeline/index.mjs';
import { createFakeLlm } from '../llm/index.mjs';
import { FALLBACK_QUESTION } from '../dialogue/agent.mjs';
import { products } from './fixtures/catalog.mjs';
import { stores, seedPeople, seedS1Memories } from './fixtures/people.mjs';

const S1 = '추석 선물이야. 엄마는 단 거 싫어하시고 땅콩 알레르기, 아빠는 등산 좋아하셔. 5만 원';
const S1_REPLY = {
  recipients: ['어머니', '아버지'], occasion: '추석', budget_amount_krw: 50000,
  preferences: ['less_sweet'], excluded_ingredients: ['땅콩'],
  memoryCandidates: [
    { recipient: '엄마', key: 'pref:less_sweet', polarity: 1, evidence: '엄마는 단 거 싫어하시고' },
    { recipient: '엄마', key: 'allergy:땅콩', polarity: -1, evidence: '땅콩 알레르기' },
    { recipient: '아빠', key: 'hobby:등산', polarity: 1, evidence: '아빠는 등산 좋아하셔' },
  ],
};
const REST = '세트당 배송비 포함 한 세트';
const CLEAR = '어머니 한 세트 세트당 예산 5만원 이하 배송비 포함 추천';
const types = r => r.events.map(e => e.type);
const ev = (r, type) => r.events.find(e => e.type === type);
const msg = text => ({ kind: 'message', text });

function setup(make, { llm = null, replies, now = () => '2026-09-20T03:00:00.000Z', ...rest } = {}) {
  const store = make();
  const fake = replies ? createFakeLlm({ json: replies }) : llm;
  const pipe = createPipeline({ store, products, llm: fake, now, ...rest });
  const turn = (sessionId, request, extra = {}) => pipe.runPipelineTurn({ ownerId: 'userA', sessionId, request, ...extra });
  return { store, pipe, turn, llm: fake };
}

for (const [name, make] of Object.entries(stores)) {
  test(`[${name}] AC1: with no memory the pipeline gives exactly the baseline runTurn result, turn after turn`, async () => {
    for (const seeded of [false, true]) {
      const { store, turn } = setup(make);
      if (seeded) await seedPeople(store);
      let base = createSession('s');
      for (const text of [CLEAR, '아버지 한 세트 세트당 예산 3만원 이하 배송비 포함 추천', '친구 한 세트 총예산 3만원 이하 상품값만 추천']) {
        const expected = await runTurn({ session: base, products, request: { kind: 'message', text, expectedVersion: base.version } });
        const out = await turn('s', msg(text));
        assert.deepEqual(types(out), ['cards', 'explanations']);
        assert.deepEqual(ev(out, 'cards').result, expected.result, text);
        assert.equal(ev(out, 'cards').banner, null);
        assert.deepEqual((await store.getSession('userA', 's')).session, expected.session);
        base = expected.session;
      }
    }
  });

  test(`[${name}] AC2: an uninterpretable message returns ONE question and saves nothing`, async () => {
    const { store, turn } = setup(make);
    await turn('s', msg(CLEAR));
    const before = await store.getSession('userA', 's');
    const out = await turn('s', msg('센스 있는 선물'));
    assert.deepEqual(types(out), ['question']);
    assert.equal(ev(out, 'question').question, FALLBACK_QUESTION);
    assert.deepEqual(await store.getSession('userA', 's'), before);
  });

  test(`[${name}] AC3: cards arrive before explanations; a failing explainer still leaves cards and template tags`, async () => {
    for (const explain of [async () => { throw new Error('llm down'); }, async () => null, null]) {
      const { turn } = setup(make, { explain });
      const out = await turn('s', msg(CLEAR));
      assert.deepEqual(types(out), ['cards', 'explanations']);
      const cards = ev(out, 'cards'), ex = ev(out, 'explanations');
      assert.equal(ex.source, 'template');
      for (const a of cards.annotations) {
        assert.ok(a.tags.length >= 2 && a.tags.length <= 3 && a.tags.every(t => t.length <= 12), JSON.stringify(a.tags));
      }
      assert.deepEqual(ex.items.map(i => i.id), cards.result.cards.map(c => c.id));
    }
    const seen = [];
    const { turn } = setup(make, { explain: async ({ cards }) => ({ items: cards.map(c => ({ id: c.id, tags: ['설명 태그', '두번째'] })) }) });
    const out = await turn('s', msg(CLEAR), { emit: e => seen.push(e.type) });
    assert.deepEqual(seen, ['cards', 'explanations']);
    assert.equal(ev(out, 'explanations').source, 'llm');
  });

  test(`[${name}] R9: 어머니·아버지 mentioned separately -> recipients ['부모님'], memories linked to each person`, async () => {
    const { store, turn, llm } = setup(make, { replies: [S1_REPLY] });
    const { mom, dad } = await seedPeople(store);
    const out = await turn('s', msg(S1));
    assert.equal(llm.calls.length, 1, '① one LLM call');
    const row = await store.getSession('userA', 's');
    assert.deepEqual(row.session.state.recipients, ['부모님']);
    assert.deepEqual(row.meta.recipientIds, [mom.id, dad.id]);
    assert.deepEqual(row.meta.pendingCandidates.map(c => [c.recipientId, c.key]), [[mom.id, 'pref:less_sweet'], [mom.id, 'allergy:땅콩'], [dad.id, 'hobby:등산']]);
    assert.deepEqual(row.session.state.excluded_ingredients, ['땅콩']);
    assert.ok(row.session.state.preferences.includes('category:fitness'), 'spoken hobby mapped by ③');
    assert.equal(ev(out, 'question').question, '선물 수량을 알려주세요.', 'baseline asks for what is missing');
    assert.equal((await store.listMemories('userA', mom.id)).length, 0, 'nothing stored before confirmation');
  });

  test(`[${name}] AC4 + R8 + AC5: S1 -> purchased -> end_session -> confirm -> S2 (empty DB at start)`, async () => {
    let clock = '2026-09-20T03:00:00.000Z';
    const { store, turn, llm } = setup(make, { replies: [S1_REPLY, { recipients: ['부모님'], occasion: '설', memoryCandidates: [] }], now: () => clock });
    assert.deepEqual(types(await turn('s1', msg(S1))), ['question']);
    const cards = ev(await turn('s1', msg(REST)), 'cards');
    assert.ok(cards.result.cards.length > 0);
    assert.ok(!cards.result.cards.some(c => c.id === 'peanut-gangjeong'), 'AC7: no peanut card');
    const top = cards.result.cards[0].id; // the engine's choice; the pipeline never picks

    const bought = await turn('s1', { kind: 'feedback', action: 'purchased', productId: top });
    const early = ev(bought, 'memory_prompt');
    assert.equal(early.kind, 'remember', 'R8: asked when a product is selected');
    assert.equal((await store.listRecipients('userA')).length, 0, 'nothing created before the answer');

    const end = await turn('s1', { kind: 'end_session' });
    const prompt = ev(end, 'memory_prompt');
    assert.equal(prompt.text, '다음에도 기억할까요?');
    assert.deepEqual(prompt.candidates.map(c => [c.recipientName, c.label, c.evidence]), [
      ['어머니', '단 음식 X', '엄마는 단 거 싫어하시고'], ['어머니', '땅콩 제외', '땅콩 알레르기'], ['아버지', '등산', '아빠는 등산 좋아하셔'],
    ]);
    assert.equal(prompt.gifts.length, 2);
    const saved = ev(await turn('s1', { kind: 'memory_confirm', accept: true }), 'memory_saved');
    assert.equal(saved.saved.length, 3); assert.equal(saved.gifts, 2);

    const people = await store.listRecipients('userA');
    const mom = people.find(r => r.name === '어머니'), dad = people.find(r => r.name === '아버지');
    assert.equal(mom.groupName, '부모님'); assert.equal(dad.groupName, '부모님');
    assert.deepEqual((await store.listMemories('userA', mom.id)).map(m => [m.key, m.evidence, m.status]), [['pref:less_sweet', '엄마는 단 거 싫어하시고', 'confirmed'], ['allergy:땅콩', '땅콩 알레르기', 'confirmed']]);
    assert.deepEqual((await store.listMemories('userA', dad.id)).map(m => [m.key, m.evidence]), [['hobby:등산', '아빠는 등산 좋아하셔']]);
    assert.equal((await store.listGifts('userA', mom.id))[0].occasion, '추석');

    // S2: next year, a new session, only "부모님 설 선물 추천해줘"
    clock = '2027-01-25T03:00:00.000Z';
    const s2 = await turn('s2', msg('부모님 설 선물 추천해줘'));
    assert.equal(llm.calls.length, 2, 'one ① call per free sentence');
    const q = ev(s2, 'question');
    assert.equal(q.question, '예산 상한을 알려주세요.');
    assert.equal(q.banner.text, '지난 추석 기억을 반영했어요: 단 음식 X · 땅콩 제외 · 등산');
    assert.equal(q.banner.editable, true);
    const state = (await store.getSession('userA', 's2')).session.state;
    assert.deepEqual(state.recipients, ['부모님']);
    assert.deepEqual(state.excluded_ingredients, ['땅콩']);
    assert.ok(state.preferences.includes('less_sweet') && state.preferences.includes('category:fitness'));
    assert.equal(ev(s2, 'memory_prompt').kind, 'satisfaction', 'R8: asked at the next session start');

    const s2cards = ev(await turn('s2', msg('5만원 세트당 배송비 포함 한 세트')), 'cards');
    assert.ok(!s2cards.result.cards.some(c => c.id === 'peanut-gangjeong'));
    assert.equal(s2cards.annotations.find(a => a.id === top).giftHistory.label, '작년 추석에 드린 선물');
    assert.equal(s2cards.result.cards[0].id, top, 'D1: the mark never changes the rank');
    assert.equal(ev(await turn('s2', msg('5만원 세트당 배송비 포함 한 세트')), 'memory_prompt'), undefined, 'satisfaction asked once');
  });

  test(`[${name}] AC4: declining "기억할까요?" stores nothing — no memory, no person, no gift`, async () => {
    const { store, turn } = setup(make, { replies: [S1_REPLY] });
    await turn('s1', msg(S1)); await turn('s1', msg(REST));
    await turn('s1', { kind: 'feedback', action: 'purchased', productId: 'hiking-socks' });
    await turn('s1', { kind: 'end_session' });
    const out = await turn('s1', { kind: 'memory_confirm', accept: false });
    assert.deepEqual(ev(out, 'memory_saved').saved, []);
    assert.deepEqual(await store.listRecipients('userA'), []);
    assert.equal(ev(await turn('s1', { kind: 'memory_confirm', accept: true }), 'error').code, 'invalid_request', 'the question was answered');
  });

  test(`[${name}] AC4: with existing people the confirmed memories attach to each of them`, async () => {
    const { store, turn } = setup(make, { replies: [S1_REPLY] });
    const { mom, dad } = await seedPeople(store);
    await turn('s1', msg(S1));
    await turn('s1', { kind: 'end_session' });
    await turn('s1', { kind: 'memory_confirm', accept: true, indexes: [1, 2] });
    assert.deepEqual((await store.listMemories('userA', mom.id)).map(m => m.key), ['allergy:땅콩']);
    assert.deepEqual((await store.listMemories('userA', dad.id)).map(m => m.key), ['hobby:등산']);
    assert.equal((await store.listRecipients('userA')).length, 3, 'no duplicate person');
  });

  test(`[${name}] AC5: seeded memories fill conditions; banner lists only memories actually applied`, async () => {
    const { store, turn } = setup(make);
    const people = await seedPeople(store);
    await seedS1Memories(store, people);
    const out = await turn('s2', msg('부모님 한 세트 세트당 예산 5만원 이하 배송비 포함 추천'));
    const cards = ev(out, 'cards');
    assert.equal(cards.banner.text, '지난 기억을 반영했어요: 단 음식 X · 땅콩 제외 · 등산');
    assert.ok(!cards.result.cards.some(c => c.id === 'peanut-gangjeong'));
    const state = (await store.getSession('userA', 's2')).session.state;
    // a chip that removes less_sweet: the memory is not re-added and leaves the banner
    const chip = await turn('s2', { kind: 'patch', patch: { preferences: state.preferences.filter(p => p !== 'less_sweet') } });
    assert.equal(ev(chip, 'cards').banner.text, '지난 기억을 반영했어요: 땅콩 제외 · 등산');
  });

  test(`[${name}] AC6 S3: a friend turn uses no parent memory and no other user's memory`, async () => {
    const reply = { recipients: ['친구'], budget_amount_krw: 30000, budget_scope: 'per_set', shipping_included: true, quantity: 1, preferences: ['category:coffee_tea'], memoryCandidates: [{ recipient: '친구', key: 'pref:category:coffee_tea', polarity: 1, evidence: '커피 좋아해' }] };
    const { store, turn } = setup(make, { replies: [reply] });
    const people = await seedPeople(store);
    await seedS1Memories(store, people);
    const other = await store.createRecipient('userB', { name: '친구', aliases: [], groupName: '친구' });
    await store.addMemory('userB', { recipientId: other.id, key: 'allergy:우유', polarity: -1, status: 'confirmed', source: 'explicit', evidence: '우유 알레르기' });
    const text = '친구 생일 선물, 커피 좋아해 3만원 세트당 배송비 포함 한 세트';
    const out = await turn('s3', msg(text));
    const cards = ev(out, 'cards');
    assert.equal(cards.banner, null);
    const row = await store.getSession('userA', 's3');
    assert.deepEqual(row.session.state.excluded_ingredients, []);
    assert.deepEqual(row.session.state.preferences, ['category:coffee_tea']);
    assert.deepEqual(row.meta.recipientIds, [people.friend.id]);
    assert.ok(!JSON.stringify(row.meta.provenance).includes('memory:'));
    const expected = await runTurn({ session: createSession('s3'), products, request: { kind: 'patch', patch: { recipients: ['친구'], budget: { amount_krw: 30000, scope: 'per_set', shipping_included: true }, quantity: 1, preferences: ['category:coffee_tea'] }, expectedVersion: 0 } });
    assert.deepEqual(cards.result, expected.result, 'no memory -> same as baseline for the same conditions');
    assert.deepEqual(row.meta.pendingCandidates.map(c => c.recipientId), [people.friend.id]);
  });

  test(`[${name}] AC9: deleting a memory removes it from the next recommendation and from the DB`, async () => {
    const { store, turn } = setup(make);
    const people = await seedPeople(store);
    const m = await seedS1Memories(store, people);
    await turn('s', msg('부모님 한 세트 세트당 예산 5만원 이하 배송비 포함 추천'));
    const out = await turn('s', { kind: 'memory_edit', op: 'delete', memoryId: m.sweet.id });
    assert.equal(await store.getMemory('userA', m.sweet.id), null);
    const state = (await store.getSession('userA', 's')).session.state;
    assert.ok(!state.preferences.includes('less_sweet'));
    assert.deepEqual(state.excluded_ingredients, ['땅콩'], 'other memories untouched');
    assert.equal(ev(out, 'cards').banner.text, '지난 기억을 반영했어요: 땅콩 제외 · 등산');
    const again = await turn('s', msg('부모님 한 세트 세트당 예산 5만원 이하 배송비 포함 추천'));
    assert.ok(!(await store.getSession('userA', 's')).session.state.preferences.includes('less_sweet'));
    assert.ok(!ev(again, 'cards').banner.text.includes('단 음식'));
    // the user's explicit deletion is the one way an allergy leaves (AC7 / TRD §5.3-2)
    await turn('s', { kind: 'memory_edit', op: 'delete', memoryId: m.peanut.id });
    assert.deepEqual((await store.getSession('userA', 's')).session.state.excluded_ingredients, []);
  });

  test(`[${name}] AC9: a value the user also said this session survives the memory deletion`, async () => {
    const { store, turn } = setup(make);
    const people = await seedPeople(store);
    const m = await seedS1Memories(store, people);
    await turn('s', msg('부모님 한 세트 세트당 예산 5만원 이하 배송비 포함 추천'));
    await turn('s', { kind: 'patch', patch: { excluded_ingredients: ['땅콩'] } });
    await turn('s', { kind: 'memory_edit', op: 'delete', memoryId: m.peanut.id });
    assert.deepEqual((await store.getSession('userA', 's')).session.state.excluded_ingredients, ['땅콩']);
  });

  test(`[${name}] S5 / AC8: a sentence against a confirmed memory asks, and changes nothing until accepted`, async () => {
    const reply = { recipients: ['어머니'], memoryCandidates: [{ recipient: '어머니', key: 'pref:less_sweet', polarity: -1, evidence: '요즘은 단 것도 드셔' }] };
    const { store, turn } = setup(make, { replies: [reply] });
    const people = await seedPeople(store);
    const m = await seedS1Memories(store, people);
    const out = await turn('s', msg('어머니는 요즘은 단 것도 드셔'));
    const p = ev(out, 'memory_prompt');
    assert.deepEqual([p.kind, p.memoryId, p.text], ['memory_conflict', m.sweet.id, '기억을 바꿀까요?']);
    assert.ok(await store.getMemory('userA', m.sweet.id));
    await turn('s', { kind: 'memory_edit', op: 'resolve_conflict', memoryId: m.sweet.id, accept: false });
    assert.ok(await store.getMemory('userA', m.sweet.id), 'declined: unchanged');
  });

  test(`[${name}] review: a recipient choice is for one request only; saying 부모님 again brings both back`, async () => {
    const { store, turn } = setup(make);
    const people = await seedPeople(store);
    await seedS1Memories(store, people);
    const P = '부모님 한 세트 세트당 예산 5만원 이하 배송비 포함 추천';
    await turn('s', msg(P));
    const st = async () => (await store.getSession('userA', 's')).session.state;
    assert.deepEqual((await st()).excluded_ingredients, ['땅콩']);
    await turn('s', { kind: 'patch', patch: {}, recipientChoice: people.dad.id });
    assert.deepEqual([(await st()).recipients, (await st()).excluded_ingredients], [['아버지'], []]);
    await turn('s', msg(P));
    assert.deepEqual([(await st()).recipients, (await st()).excluded_ingredients], [['부모님'], ['땅콩']], 'AC7: the allergy is back with the group');
    assert.deepEqual((await store.getSession('userA', 's')).meta.recipientIds, [people.mom.id, people.dad.id]);
  });

  test(`[${name}] review: the display name and the memories always belong to the same person`, async () => {
    const { store, pipe } = setup(make);
    const people = await seedPeople(store);
    await seedS1Memories(store, people);
    const t = (request, recipientId) => pipe.runPipelineTurn({ ownerId: 'userA', sessionId: 's', recipientId, request });
    await t(msg('어머니 한 세트 세트당 예산 5만원 이하 배송비 포함 추천'), people.friend.id); // the sentence wins over the host id
    let row = await store.getSession('userA', 's');
    assert.deepEqual([row.session.state.recipients, row.session.state.excluded_ingredients, row.meta.recipientIds], [['어머니'], ['땅콩'], [people.mom.id]]);
    await t({ kind: 'patch', patch: {} }, people.friend.id); // a host id for someone else switches the person by name too
    row = await store.getSession('userA', 's');
    assert.deepEqual([row.session.state.recipients, row.session.state.excluded_ingredients, row.meta.recipientIds], [['민지'], [], [people.friend.id]]);
  });

  test(`[${name}] review: clearing every preference by chip clears its provenance and the banner`, async () => {
    const { store, turn } = setup(make);
    const people = await seedPeople(store);
    await seedS1Memories(store, people);
    await turn('s', msg('부모님 한 세트 세트당 예산 5만원 이하 배송비 포함 추천'));
    const out = await turn('s', { kind: 'patch', patch: { preferences: [] } });
    assert.equal(ev(out, 'cards').banner.text, '지난 기억을 반영했어요: 땅콩 제외');
    assert.equal((await store.getSession('userA', 's')).meta.provenance.preferences, undefined);
  });

  test(`[${name}] AC2: an uninterpretable FIRST message creates no session row`, async () => {
    const { store, turn } = setup(make);
    assert.deepEqual(types(await turn('new', msg('센스 있는 선물'))), ['question']);
    assert.equal(await store.getSession('userA', 'new'), null);
  });

  test(`[${name}] stale: a client version or a concurrent save is refused with version_conflict, nothing written`, async () => {
    const { store, turn } = setup(make);
    await turn('s', msg(CLEAR));
    const before = await store.getSession('userA', 's');
    const stale = await turn('s', { ...msg('아버지 한 세트 세트당 예산 3만원 이하 배송비 포함 추천'), expectedVersion: before.session.version - 1 });
    assert.deepEqual(types(stale), ['error']); assert.equal(ev(stale, 'error').code, 'version_conflict');
    assert.deepEqual(await store.getSession('userA', 's'), before);

    // another writer saves between our load and our save
    const racing = Object.create(store);
    racing.getSession = async (owner, id) => {
      const row = await store.getSession(owner, id);
      const bumped = { ...row.session, version: row.session.version + 1 };
      await store.saveSession(owner, bumped, row.meta, row.session.version);
      return row;
    };
    const p2 = createPipeline({ store: racing, products });
    const lost = await p2.runPipelineTurn({ ownerId: 'userA', sessionId: 's', request: msg('아버지 한 세트 세트당 예산 3만원 이하 배송비 포함 추천') });
    assert.equal(ev(lost, 'error').code, 'version_conflict');
    assert.ok(!types(lost).includes('cards'), 'no cards from a turn that was not saved');
  });

  test(`[${name}] sessions are per owner; what_if_budget and view never change the session`, async () => {
    const { store, turn, pipe } = setup(make);
    await turn('s', msg(CLEAR));
    const before = await store.getSession('userA', 's');
    const look = await pipe.runPipelineTurn({ ownerId: 'userB', sessionId: 's', request: { kind: 'view' } });
    assert.equal(ev(look, 'question').question, '받는 사람을 알려주세요.', "userB never sees userA's session");
    const theirs = await pipe.runPipelineTurn({ ownerId: 'userB', sessionId: 's', request: msg(CLEAR) });
    assert.equal(ev(theirs, 'error').code, 'session_exists');
    const cmp = await turn('s', { kind: 'what_if_budget', amount_krw: 70000 });
    assert.deepEqual(types(cmp), ['comparison']);
    assert.deepEqual(types(await turn('s', { kind: 'view' })), ['cards', 'explanations']);
    assert.deepEqual(await store.getSession('userA', 's'), before);
  });
}

test('invalid requests are errors, not crashes; nothing is stored', async () => {
  const { store, turn } = setup(stores.memory);
  for (const request of [null, { kind: 'shout' }, { kind: 'message', text: '' }, { kind: 'patch', patch: { budget: { amount_krw: -1 } } }, { kind: 'feedback', action: 'purchased', productId: 'nope' }, { kind: 'memory_edit', op: 'drop' }]) {
    const out = await turn('x', request);
    assert.deepEqual(types(out), ['error'], JSON.stringify(request));
  }
  assert.equal(ev(await turn('y', msg(CLEAR), { experiment: 'C' }), 'error').code, 'invalid_request');
  assert.equal(await store.getSession('userA', 'x'), null, 'a refused request leaves no row');
});

test('experiment is kept in session meta only; the baseline state never gets pipeline fields', async () => {
  const { store, turn } = setup(stores.sqlite);
  await turn('s', msg(CLEAR), { experiment: 'A' });
  const row = await store.getSession('userA', 's');
  assert.equal(row.meta.experiment, 'A');
  assert.deepEqual(Object.keys(row.session.state).sort(), Object.keys(initial()).sort());
});
