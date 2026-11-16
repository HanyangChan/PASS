import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalChatService } from '../src/services/chatService.ts';
import { createServerChatService } from '../src/services/serverChatService.ts';
import { rankingFeedback } from '../src/chatHistory.ts';
import { toggleFeedback, decodeFeedback } from '../src/cardFeedback.ts';
import { record, products, state, scope } from '../../tests/fixtures/context-feedback.mjs';
const session = () => ({ state: state({ preferences: ['category:coffee_tea'] }), issues: [] });
const ids = service => service.view(session()).result.items.map(p => p.id);

test('the first request after a product vote reads the new snapshot without rebuilding the service', () => {
  let votes = [], enabled = true;
  const service = createLocalChatService(products, () => enabled ? rankingFeedback(votes) : [], scope);
  const before = ids(service);
  votes = [record(products[1], session().state)];
  assert.equal(ids(service)[0], 'tea-b');
  enabled = false;
  assert.deepEqual(ids(service), before);
  enabled = true;
  votes = [];
  assert.deepEqual(ids(service), before);
});

test('same-turn edits and chat interpretation use the new conditions to select feedback', async () => {
  const plain = createLocalChatService(products);
  const service = createLocalChatService(products, [record(products[1], session().state)], scope);
  for (const text of ['친구 선물 5만원 배송비 포함', '예산 7만원으로 바꿔줘']) {
    const actual = await service.send(session(), text);
    const expected = await plain.send(session(), text);
    assert.deepEqual(actual, expected);
    assert.deepEqual(service.view(actual.session), plain.view(expected.session));
  }
});

test('explanation and product votes coexist; toggling removes only the same situation and kind', () => {
  const gift = record(products[0], session().state);
  const reason = { ...gift, kind: 'reason_helpfulness' };
  const other = record(products[0], state({ recipients: ['친구'] }));
  const list = [gift, reason, other];
  assert.equal(decodeFeedback(list).length, 3);
  assert.deepEqual(toggleFeedback(list, gift), [reason, other]);
  assert.equal(rankingFeedback(list).length, 2);
  assert.deepEqual(rankingFeedback([reason]), []);
});

test('latest product votes are deduplicated per situation, not globally by product', () => {
  const old = record(products[0], session().state, true);
  const newer = { ...old, helpful: false, at: '2026-11-16T02:00:00Z' };
  const other = record(products[0], state({ recipients: ['친구'] }), true, { at: '2026-11-16T03:00:00Z' });
  const signals = rankingFeedback([other, newer, old]);
  assert.equal(signals.length, 2);
  assert.equal(signals.find(s => s.context.state.recipients[0] === '어머니').helpful, false);
});

test('invalid new records are discarded while legacy explanation records are preserved', () => {
  const good = record(products[0], session().state);
  const legacy = { ...good }; delete legacy.version; delete legacy.kind; delete legacy.context;
  assert.deepEqual(decodeFeedback([legacy, { ...good, context: null }, { ...good, at: 'bad' }]), [legacy]);
  assert.deepEqual(rankingFeedback([legacy]), []);
});

test('serialized signal budget remains bounded even with hundreds of contextual records', () => {
  const records = Array.from({ length: 500 }, (_, i) => record({ id: `p-${i}` }, session().state));
  const signals = rankingFeedback(records);
  assert.ok(signals.length > 0 && signals.length <= 200);
  assert.ok(new TextEncoder().encode(JSON.stringify(signals)).length <= 18000);
  assert.equal(signals.at(-1).giftId, 'p-499');
});

test('server requests snapshot votes before asynchronous authentication', async () => {
  let votes = [record(products[0], session().state)], release;
  const auth = { getSession: () => new Promise(resolve => { release = () => resolve({ data: { session: { access_token: 'synthetic', user: { id: 'owner' } } }, error: null }); }) };
  const bodies = [];
  const service = createServerChatService('https://pass-mock.test/api/chat', auth, 'owner', async (_, init) => {
    bodies.push(JSON.parse(init.body)); return Response.json({}, { status: 503 });
  }, () => rankingFeedback(votes), () => scope);
  const first = service.view(session());
  votes = [];
  release();
  await assert.rejects(first);
  assert.equal(bodies[0].feedback[0].giftId, products[0].id);
  assert.equal(bodies[0].feedbackScope, scope);
});
