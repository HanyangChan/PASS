// P5 events logging: one 'turn' row per request and one 'explanations' row per explanation, codes and ids only.
// No raw utterance, evidence or LLM text ever reaches the events table (AGENTS.md). Logging never breaks a turn.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPipeline } from '../pipeline/index.mjs';
import { createFakeLlm } from '../llm/index.mjs';
import { products } from './fixtures/catalog.mjs';
import { fakeGemini, protoState } from './fixtures/proto-llm.mjs';
import { stores, seedPeople } from './fixtures/people.mjs';

const S1 = '추석 선물이야. 엄마는 단 거 싫어하시고 땅콩 알레르기, 아빠는 등산 좋아하셔. 5만 원';
const S1_REPLY = { // P8: ① is proto llmTurn (main schema + L1 memory)
  state: protoState({ recipients: ['어머니', '아버지'], occasion: '추석', budget: { amount_krw: 50000 }, preferences: ['less_sweet'], excluded_ingredients: ['땅콩'] }),
  memory: [
    { recipient: '엄마', key: 'pref:less_sweet', polarity: 1, evidence: '엄마는 단 거 싫어하시고' },
    { recipient: '아빠', key: 'hobby:등산', polarity: 1, evidence: '아빠는 등산 좋아하셔' },
  ],
};

for (const [name, make] of Object.entries(stores)) {
  test(`[${name}] events hold request kinds, event types and verifier codes, never the user's words`, async () => {
    const store = make();
    await seedPeople(store);
    const llm = createFakeLlm({ json: [call => ({ items: call.input.draft.map(i => ({ ...i, tags: ['최고급 구성', i.tags[1]] })) }), call => ({ items: call.input.draft })] });
    const dialogue = fakeGemini([S1_REPLY, input => ({ state: input.state, question: '어떤 선물을 찾으세요?' })]);
    const pipe = createPipeline({ store, products, llm, dialogueLlm: dialogue.llm });
    const turn = request => pipe.runPipelineTurn({ ownerId: 'userA', sessionId: 's', request, experiment: 'B' });
    await turn({ kind: 'message', text: S1 });
    await turn({ kind: 'patch', patch: { budget: { amount_krw: 50000, scope: 'per_set', shipping_included: true }, quantity: 1 } });
    await turn({ kind: 'message', text: '센스 있는 선물' });
    await turn({ kind: 'end_session' });
    const rows = await store.listEvents('s');
    const kinds = rows.filter(r => r.type === 'turn').map(r => r.payload.requestKind);
    assert.deepEqual(kinds, ['message', 'patch', 'message', 'end_session']);
    const ex = rows.filter(r => r.type === 'explanations');
    assert.ok(ex.length >= 1);
    const last = ex.at(-1).payload;
    assert.equal(last.source, 'llm');
    assert.deepEqual([last.attempts, last.failures], [2, ['banned_word']]);
    const dump = JSON.stringify(rows);
    for (const words of ['엄마는 단 거 싫어하시고', '등산 좋아하셔', '센스', '추석 선물이야', '최고급', '땅콩 알레르기']) assert.ok(!dump.includes(words), words);
  });
}

test('a failing logEvent never breaks the turn', async () => {
  const store = stores.memory();
  store.logEvent = async () => { throw new Error('disk full'); };
  const pipe = createPipeline({ store, products });
  const out = await pipe.runPipelineTurn({ ownerId: 'userA', sessionId: 's', request: { kind: 'message', text: '어머니 한 세트 세트당 예산 5만원 이하 배송비 포함 추천' } });
  assert.deepEqual(out.events.map(e => e.type), ['cards', 'explanations']);
});
