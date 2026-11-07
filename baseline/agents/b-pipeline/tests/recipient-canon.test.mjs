// K73: the LLM may name a person as said ("엄마"). The answer is normalized deterministically right after validation
// (proto L5, main's rule 엄마→어머니 / 아빠→아버지 + 어머님/아버님), and every row, id and lookup uses the canonical name.
// Fake OpenAI-compatible LLM and in-memory/SQLite stores only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { llmTurn, canonicalRecipients, RECIPIENT_ALIASES } from '../proto/lib/llm.mjs';
import { singleInitial } from '../proto/lib/single-gift.mjs';
import { extract, initial } from '../proto/lib/engine.mjs';
import { createPipeline } from '../pipeline/index.mjs';
import { KNOWN_ALIASES, canonicalName, resolveRecipients } from '../pipeline/recipients.mjs';
import { findRecipient } from '../memory/read.mjs';
import { products } from './fixtures/catalog.mjs';
import { stores } from './fixtures/people.mjs';
import { fakeOpenAi, protoState } from './fixtures/proto-llm.mjs';

const input = text => ({ state: singleInitial(), issues: [], text, history: [], source: 'typed' });
const ev = (r, type) => r.events.find(e => e.type === type);

test('alias rule: main\'s engine rule is a subset; the stored aliases agree with it', () => {
  // main (engine.mjs extract) turns 엄마/아빠 into 어머니/아버지 in the sentence
  assert.deepEqual(extract('엄마 선물', initial()).patch.recipients, ['어머니']);
  assert.deepEqual(extract('아빠 선물', initial()).patch.recipients, ['아버지']);
  for (const [alias, name] of RECIPIENT_ALIASES) {
    assert.ok(KNOWN_ALIASES[name].includes(alias), `${alias} -> ${name} is a stored alias`);
    assert.equal(canonicalName(alias), name);
  }
  assert.deepEqual(canonicalRecipients(['엄마', '어머니', ' 아빠 ', '어머님', '친구', '부모님']), ['어머니', '아버지', '친구', '부모님']);
});

test('llmTurn: an answer with "엄마"/"아빠" becomes 어머니/아버지 right after validation; others unchanged', async () => {
  const cases = [[['엄마'], ['어머니']], [['엄마', '아빠'], ['어머니', '아버지']], [['어머님'], ['어머니']], [['엄마', '어머니'], ['어머니']], [['친구'], ['친구']], [['부모님'], ['부모님']]];
  for (const [said, want] of cases) {
    const f = fakeOpenAi([{ state: protoState({ recipients: said, budget: { amount_krw: 50000 } }) }]);
    const out = await llmTurn(input('엄마 추석 선물 5만원'), products, f.llm);
    assert.deepEqual(out.session.state.recipients, want, said.join(','));
    assert.ok(!out.message.includes('엄마'), 'the summary uses the canonical name too');
  }
});

test('resolveRecipients: 엄마 + 아빠 is shown as 부모님 and gets the canonical placeholder ids', async () => {
  const store = stores.memory();
  const r = await resolveRecipients(store, 'userA', ['엄마', '아빠']);
  assert.deepEqual(r.display, ['부모님']);
  assert.deepEqual(r.ids, ['new:어머니', 'new:아버지']);
});

for (const [name, make] of Object.entries(stores)) {
  const pipe = (store, replies) => {
    const f = fakeOpenAi(replies);
    let clock = '2026-09-20T03:00:00.000Z';
    const p = createPipeline({ store, products, dialogueLlm: f.llm, explain: null, now: () => clock });
    const turn = (sessionId, request) => p.runPipelineTurn({ ownerId: 'userA', sessionId, request });
    return { turn, f, setClock: c => { clock = c; } };
  };

  test(`[${name}] "엄마" from the LLM: memory and gift are saved under 어머니, and a later "어머니" request finds the memory`, async () => {
    const store = make();
    const { turn, setClock } = pipe(store, [
      { state: protoState({ recipients: ['엄마'], occasion: '추석', budget: { amount_krw: 50000, shipping_included: true }, excluded_ingredients: ['땅콩'] }),
        memory: [{ recipient: '엄마', key: 'allergy:땅콩', polarity: -1, evidence: '땅콩 알레르기' }] },
      { state: protoState({ recipients: ['어머니'], budget: { amount_krw: 50000, shipping_included: true } }) },
    ]);
    const s1 = await turn('s1', { kind: 'message', text: '엄마 추석 선물 5만원 배송비 포함, 땅콩 알레르기 있어' });
    const cards = ev(s1, 'cards');
    assert.ok(cards, 'cards shown');
    assert.deepEqual((await store.getSession('userA', 's1')).session.state.recipients, ['어머니']);
    await turn('s1', { kind: 'feedback', action: 'purchased', productId: cards.result.cards[0].id });
    await turn('s1', { kind: 'end_session' });
    await turn('s1', { kind: 'memory_confirm', accept: true });

    const people = await store.listRecipients('userA');
    assert.deepEqual(people.map(r => r.name), ['어머니'], 'one person, canonical name (no row named 엄마)');
    assert.ok(people[0].aliases.includes('엄마'));
    assert.deepEqual((await store.listMemories('userA', people[0].id)).map(m => m.key), ['allergy:땅콩']);
    assert.equal((await store.listGifts('userA', people[0].id)).length, 1, 'the gift is linked to the same person');

    setClock('2027-01-25T03:00:00.000Z');
    const s2 = await turn('s2', { kind: 'message', text: '어머니 선물 5만원 배송비 포함' });
    const state = (await store.getSession('userA', 's2')).session.state;
    assert.deepEqual(state.recipients, ['어머니']);
    assert.ok(state.excluded_ingredients.includes('땅콩'), 'the remembered allergy applies');
    assert.ok(!ev(s2, 'cards').result.cards.some(c => c.id === 'peanut-gangjeong'), 'AC7');
  });

  test(`[${name}] a row saved as "엄마" (before K73) is found by an "어머니" request`, async () => {
    const store = make();
    const legacy = await store.createRecipient('userA', { name: '엄마', aliases: [], groupName: null });
    await store.addMemory('userA', { recipientId: legacy.id, key: 'allergy:땅콩', polarity: -1, status: 'confirmed', source: 'explicit', evidence: '땅콩 알레르기' });
    assert.equal((await findRecipient(store, 'userA', '어머니')).recipients[0].id, legacy.id);
    const { turn } = pipe(store, [{ state: protoState({ recipients: ['어머니'], budget: { amount_krw: 50000, shipping_included: true } }) }]);
    await turn('s', { kind: 'message', text: '어머니 선물 5만원 배송비 포함' });
    assert.ok((await store.getSession('userA', 's')).session.state.excluded_ingredients.includes('땅콩'));
  });
}
