import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalChatService } from '../src/services/chatService.ts';
import { createServerChatService } from '../src/services/serverChatService.ts';
import { createHistoryRepository, decodeHistory, rankingFeedback, historyKey } from '../src/chatHistory.ts';
import { cardReason } from '../src/cardReason.ts';
const products = JSON.parse(readFileSync(new URL('../../tests/fixtures/food-demo.json', import.meta.url)));
const memory = () => { const m = new Map(); return { getItem: async k => m.get(k) ?? null, setItem: async (k, v) => { m.set(k, v); }, m }; };
const fb = (giftId, helpful, at, conversationId = 'c') => ({ conversationId, giftId, rank: 1, helpful, agentMode: 'local', engineMode: 'local', reason: 'r', at });

test('ranking feedback keeps the latest answer per product and caps the list', () => {
  const signal = rankingFeedback([fb('a', true, '2026-01-01'), fb('b', false, '2026-01-02')], [fb('a', false, '2026-01-03')]);
  assert.deepEqual(signal, [{ giftId: 'b', helpful: false }, { giftId: 'a', helpful: false }]);
  assert.equal(rankingFeedback(Array.from({ length: 250 }, (_, i) => fb(`g${i}`, true, `2026-01-01T00:00:${String(i).padStart(3, '0')}`))).length, 200);
});

test('guest history archives newest first and survives bad data', async () => {
  const storage = memory(), repo = createHistoryRepository(storage);
  const chat = id => ({ id, at: '2026-11-01T00:00:00.000Z', title: id, recipients: ['어머니'], messages: [{ role: 'user', text: id }], feedback: [fb('a', true, '2026-11-01', id)] });
  await repo.archive(chat('one')); await repo.archive(chat('two'));
  assert.deepEqual((await repo.load()).map(c => c.id), ['two', 'one']);
  storage.m.set(historyKey, '{broken'); assert.deepEqual(await repo.load(), []);
  assert.deepEqual(decodeHistory([{ id: 1 }, null, 'x']), []);
});

test('feedback changes the guest ranking and the card says so; conditions stay', async () => {
  const plain = createLocalChatService(products);
  const session = (await plain.send(plain.createSession(), '부모님 5만 원 배송비 포함')).session;
  const before = plain.view(session).result.items;
  assert.ok(before.length > 1);
  const service = createLocalChatService(products, [{ giftId: before[0].id, helpful: false }, { giftId: before.at(-1).id, helpful: true }]);
  const after = service.view(session).result.items;
  assert.notEqual(after[0].id, before[0].id, 'the disliked top item is no longer first');
  const liked = after.find(i => i.feedback_score > 0);
  assert.ok(liked, 'a liked item (or its category) is boosted');
  assert.match(cardReason(liked, session.state), /지난 피드백 반영 \(\+\d+점\)/);
  assert.deepEqual(service.view(session).question, plain.view(session).question);
});

test('the server request carries feedback only when there is some', async () => {
  const bodies = [];
  const auth = { getSession: async () => ({ data: { session: { access_token: 't', user: { id: 'owner' } } }, error: null }) };
  let signal = [];
  const service = createServerChatService('https://api.example/api/chat', auth, 'owner', async (_, options) => { bodies.push(JSON.parse(options.body)); return new Response(null, { status: 503 }); }, () => signal);
  const session = { state: createLocalChatService(products).createSession().state, issues: [] };
  await service.view(session).catch(() => {});
  signal = [{ giftId: 'x', helpful: true }];
  await service.view(session).catch(() => {});
  assert.equal('feedback' in bodies[0], false);
  assert.deepEqual(bodies[1].feedback, [{ giftId: 'x', helpful: true }]);
});
