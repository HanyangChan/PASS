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

test('legacy explanation evaluations remain in history but do not become product preferences', () => {
  const signal = rankingFeedback([fb('a', true, '2026-01-01'), fb('b', false, '2026-01-02')], [fb('a', false, '2026-01-03')]);
  assert.deepEqual(signal, []);
  assert.equal(rankingFeedback(Array.from({ length: 250 }, (_, i) => fb(`g${i}`, true, '2026-01-01'))).length, 0);
});

test('guest history archives newest first and survives bad data', async () => {
  const storage = memory(), repo = createHistoryRepository(storage);
  const chat = id => ({ id, at: '2026-11-01T00:00:00.000Z', title: id, recipients: ['어머니'], messages: [{ role: 'user', text: id }], feedback: [fb('a', true, '2026-11-01', id)] });
  await repo.archive(chat('one')); await repo.archive(chat('two'));
  assert.deepEqual((await repo.load()).map(c => c.id), ['two', 'one']);
  storage.m.set(historyKey, '{broken'); assert.deepEqual(await repo.load(), []);
  assert.deepEqual(decodeHistory([{ id: 1 }, null, 'x']), []);
});

test('legacy feedback does not change guest ranking or claim that it was applied', async () => {
  const plain = createLocalChatService(products);
  const session = (await plain.send(plain.createSession(), '부모님 5만 원 배송비 포함')).session;
  const before = plain.view(session).result.items;
  assert.ok(before.length > 1);
  const service = createLocalChatService(products, [{ giftId: before[0].id, helpful: false }, { giftId: before.at(-1).id, helpful: true }]);
  const after = service.view(session).result.items;
  assert.deepEqual(after, before);
  assert.ok(after.every(i => !i.feedback_score));
  assert.doesNotMatch(cardReason(after[0], session.state), /평가 반영/);
  assert.deepEqual(service.view(session).question, plain.view(session).question);
});

test('the server request carries feedback only when there is some', async () => {
  const bodies = [];
  const auth = { getSession: async () => ({ data: { session: { access_token: 't', user: { id: 'owner' } } }, error: null }) };
  let signal = [];
  const service = createServerChatService('https://api.example/api/chat', auth, 'owner', async (_, options) => { bodies.push(JSON.parse(options.body)); return new Response(null, { status: 503 }); }, () => signal, () => 'test-chat');
  const session = { state: createLocalChatService(products).createSession().state, issues: [] };
  await service.view(session).catch(() => {});
  signal = [{ giftId: 'x', helpful: true }];
  await service.view(session).catch(() => {});
  assert.equal('feedback' in bodies[0], false);
  assert.deepEqual(bodies[1].feedback, [{ giftId: 'x', helpful: true }]);
});

test('guest history preserves conditions and legacy records reconstruct them before continuing', async () => {
  const { restoreHistorySession } = await import('../src/chatHistory.ts');
  const service = createLocalChatService(products);
  const first = await service.send(service.createSession(), '어머니 생신 선물 5만원 배송비 포함');
  const chat = { id: 'resume', at: '2026-11-18', title: '선물', recipients: ['어머니'], session: first.session,
    messages: [{ role: 'user', text: '어머니 생신 선물 5만원 배송비 포함' }, { role: 'assistant', text: first.message }], feedback: [] };
  const repo = createHistoryRepository(memory()); await repo.archive(chat);
  const [loaded] = await repo.load();
  assert.deepEqual(await restoreHistorySession(loaded, service), first.session);
  delete loaded.session;
  const restored = await restoreHistorySession(loaded, service);
  assert.deepEqual(restored, first.session);
  const next = await service.send(restored, '예산 7만원으로 바꿔줘', loaded.messages);
  assert.equal(next.session.state.budget.amount_krw, 70000);
  assert.deepEqual(next.session.state.recipients, ['어머니']);
  await repo.archive({ ...chat, session: next.session, messages: [...chat.messages, { role: 'user', text: '예산 7만원으로 바꿔줘' }] });
  assert.equal((await repo.load()).length, 1);
  assert.equal((await repo.load())[0].session.state.budget.amount_krw, 70000);
});
