// ③ preference mapping: hobby:* -> category:<c> candidates. Keyword table first; embeddings only for what the table misses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES } from '../../../src/vendor/catalog.mjs';
import { createFakeLlm } from '../llm/index.mjs';
import { createHobbyMapper, loadHobbyMap } from '../rag/agent.mjs';
import { createRagIndex } from '../rag/index.mjs';

const item = (word, memoryId = 'm1') => ({ memoryId, recipientId: 'r1', word });

test('keyword table: 등산 -> category:fitness with the memory as source, no LLM needed', async () => {
  const m = createHobbyMapper({ llm: null });
  assert.deepEqual(await m.map([item('등산')]), [{ field: 'preferences', value: 'category:fitness', from: 'memory:m1' }]);
});

test('unknown hobby without embeddings maps to nothing (no guessing)', async () => {
  assert.deepEqual(await createHobbyMapper({ llm: null }).map([item('우표수집')]), []);
});

test('table hits never trigger an embedding call', async () => {
  const llm = createFakeLlm({ embed: () => { throw new Error('should not embed'); } });
  assert.equal((await createHobbyMapper({ llm }).map([item('등산'), item('커피', 'm2')])).length, 2);
  assert.equal(llm.calls.length, 0);
});

test('K43: embedding mapping is off by default: an embedding-capable LLM is never called and unknown words map to nothing', async () => {
  const llm = createFakeLlm({ embed: texts => texts.map(() => [1, 0, 0]) });
  const m = createHobbyMapper({ llm, minCosine: 0 });
  assert.deepEqual(await m.map([item('클라이밍'), item('등산', 'm2')]), [{ field: 'preferences', value: 'category:fitness', from: 'memory:m2' }]);
  assert.equal(llm.calls.length, 0);
  assert.throws(() => createHobbyMapper({ llm, embedding: 'yes' }), TypeError);
});

test('K43: the pipeline does not embed by default, and passes ragEmbedding through when turned on', async () => {
  const { createPipeline } = await import('../pipeline/index.mjs');
  const { createMemoryStore } = await import('../db/memory-store.mjs');
  const { products } = await import('./fixtures/catalog.mjs');
  for (const [flag, expected] of [[undefined, 0], [true, 1]]) {
    const store = createMemoryStore();
    const r = await store.createRecipient('userA', { name: '어머니', aliases: ['엄마'] });
    await store.addMemory('userA', { recipientId: r.id, key: 'hobby:클라이밍', polarity: 1, status: 'confirmed', source: 'explicit', evidence: '클라이밍 좋아해' });
    const llm = createFakeLlm({ embed: texts => texts.map(() => [1, 0, 0]) });
    const pipe = createPipeline({ store, products, llm, explain: null, ...(flag === undefined ? {} : { ragEmbedding: flag }) });
    await pipe.runPipelineTurn({ ownerId: 'userA', sessionId: 's', request: { kind: 'message', text: '어머니 한 세트 세트당 예산 5만원 이하 배송비 포함 추천' } });
    assert.equal(llm.calls.filter(c => c.method === 'embed').length > 0 ? 1 : 0, expected, `ragEmbedding=${flag}`);
  }
});

test('embeddings (flag on): words the table misses are matched by cosine against category docs, in ONE embed call', async () => {
  const vec = text => (/클라이밍|운동|fitness/.test(text) ? [1, 0, 0] : /우표/.test(text) ? [0, 0, 1] : [0, 1, 0]);
  const llm = createFakeLlm({ embed: texts => texts.map(vec) });
  const m = createHobbyMapper({ llm, minCosine: 0.8, embedding: true });
  const out = await m.map([item('클라이밍'), item('우표수집', 'm2')]);
  assert.deepEqual(out, [{ field: 'preferences', value: 'category:fitness', from: 'memory:m1' }]);
  const embeds = llm.calls.filter(c => c.method === 'embed');
  assert.equal(embeds.length >= 1 && embeds.length <= 2, true, 'one for the category index (cached), one for the hobbies');
  await m.map([item('클라이밍')]);
  assert.equal(llm.calls.filter(c => c.method === 'embed').length, embeds.length + 1, 'the category index is built once');
});

test('embedding failure or no embedding support falls back to the table without throwing', async () => {
  for (const llm of [createFakeLlm({ embed: () => { throw new Error('boom'); } }), createFakeLlm({ embed: null })]) {
    const m = createHobbyMapper({ llm, embedding: true });
    assert.deepEqual(await m.map([item('우표수집'), item('등산', 'm2')]), [{ field: 'preferences', value: 'category:fitness', from: 'memory:m2' }]);
  }
});

test('the map file is a draft, only maps to engine categories, and a bad map is refused at load', () => {
  const map = loadHobbyMap();
  assert.match(map.note, /초안/);
  for (const cats of Object.values(map.table)) for (const c of cats) assert.ok(CATEGORIES.includes(c), c);
  for (const w of ['녹차', '홍차', '캠핑', '낚시']) assert.ok(map.table[w]?.length, `draft entry ${w}`);
  for (const w of ['와인', '독서']) assert.equal(map.table[w], undefined, `K32: no engine category fits ${w}, so it is not mapped`);
  assert.deepEqual([map.table['녹차'], map.table['홍차']], [['coffee_tea'], ['coffee_tea']]);
  assert.throws(() => loadHobbyMap({ note: '초안', table: { 등산: ['not_a_category'] } }), { code: 'invalid_hobby_map' });
});

test('createRagIndex: cosine ranking with a threshold; dimension mismatch is ignored, not thrown', () => {
  const idx = createRagIndex([{ id: 'fitness', vector: [1, 0] }, { id: 'beauty', vector: [0, 1] }]);
  assert.deepEqual(idx.search([0.9, 0.1], { minCosine: 0.8 }).map(r => r.id), ['fitness']);
  assert.deepEqual(idx.search([1, 0, 0], { minCosine: 0 }), []);
});
