import test from 'node:test';
import assert from 'node:assert/strict';
import { cardReason } from '../src/cardReason.ts';
import { createFeedbackScheduler, decodeFeedback, toggleFeedback, FEEDBACK_LIMIT } from '../src/cardFeedback.ts';
import { createFeedbackRepository } from '../src/services/feedbackRepository.ts';
import { createLocalChatService } from '../src/services/chatService.ts';

const base = () => createLocalChatService([], {}).createSession().state;
const item = (extra = {}) => ({ category: 'coffee_tea', sweetness: 'unsweetened', packaging: 'basic', arrival_date: '2026-09-10', rating_count: 900, popularity: 1, ...extra });
const entry = (extra = {}) => ({ conversationId: 'c1', giftId: 'g1', rank: 1, helpful: true, agentMode: 'a-router', engineMode: 'rules', reason: '이유', at: '2026-11-07T00:00:00.000Z', ...extra });

test('reason uses at most two facts the conditions and item share', () => {
  const state = { ...base(), recipients: ['부모님'], preferences: ['category:coffee_tea', 'unsweetened'], budget: { ...base().budget, amount_krw: 50000 } };
  const reason = cardReason(item(), state);
  assert.equal(reason, '커피·차 선호 반영 · 단맛 없는 상품');
  assert.equal(reason.split(' · ').length, 2);
});
test('reason covers recipient, budget, exclusion, delivery and popularity', () => {
  const state = { ...base(), recipients: ['부모님'], budget: { ...base().budget, amount_krw: 50000 } };
  assert.equal(cardReason(item(), state), '부모님에게 어울리는 커피·차 · 예산 5만 원 이하');
  assert.equal(cardReason(item(), { ...base(), excluded_ingredients: ['견과류'] }), '견과류 제외 조건 반영 · 리뷰 900개의 인기 상품');
  assert.equal(cardReason(item(), { ...base(), delivery_by: '2026-09-21', packaging: 'formal' }), '9월 21일 전 도착 · 리뷰 900개의 인기 상품');
  assert.equal(cardReason(item({ arrival_date: '2026-09-30' }), { ...base(), delivery_by: '2026-09-21' }), '리뷰 900개의 인기 상품');
});
test('reason never claims safety for allergens and degrades on partial data', () => {
  assert.doesNotMatch(cardReason(item(), { ...base(), excluded_ingredients: ['우유'] }), /안전|없는|무첨가/);
  assert.equal(cardReason({}, base()), '현재 조건에 맞는 상품');
  assert.equal(cardReason({ category: 'unknown_cat' }, { ...base(), preferences: ['category:unknown_cat'] }), 'unknown_cat 선호 반영');
});

test('same answer clears, other answer replaces, one record per card', () => {
  let list = toggleFeedback([], entry());
  assert.equal(list.length, 1);
  list = toggleFeedback(list, entry({ helpful: false, agentMode: 'full-chat' }));
  assert.deepEqual(list.map(f => [f.giftId, f.helpful, f.agentMode]), [['g1', false, 'full-chat']]);
  assert.deepEqual(toggleFeedback(list, entry({ helpful: false })), []);
  assert.equal(toggleFeedback(list, entry({ giftId: 'g2' })).length, 2);
  const many = Array.from({ length: FEEDBACK_LIMIT + 5 }, (_, i) => entry({ giftId: `g${i}` }));
  assert.equal(many.reduce((l, e) => toggleFeedback(l, e), []).length, FEEDBACK_LIMIT);
});
test('decode drops malformed records and keeps mode and conversation id', () => {
  const kept = decodeFeedback([entry(), { giftId: 1 }, null, entry({ rank: 1.5 })]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].conversationId, 'c1');
  assert.equal(kept[0].agentMode, 'a-router');
  assert.deepEqual(decodeFeedback('nope'), []);
});

test('a burst of taps schedules one flush, not one per tap', async () => {
  const timers = []; let flushes = 0;
  const fire = () => timers.splice(0).filter(Boolean).forEach(fn => fn());
  const scheduler = createFeedbackScheduler({
    flush: () => { flushes++; }, delayMs: 3000,
    setTimer: fn => { timers.push(fn); return timers.length; }, clearTimer: id => { timers[id - 1] = null; },
  });
  for (let i = 0; i < 10; i++) scheduler.schedule();
  assert.equal(flushes, 0, 'taps alone never save');
  fire();
  assert.equal(flushes, 1);
  scheduler.schedule(); scheduler.flushNow();
  assert.equal(flushes, 2, 'flushNow replaces the pending timer');
  scheduler.schedule(); scheduler.cancel();
  fire();
  assert.equal(flushes, 2);
});

test('guest repository replaces its own session entries and keeps others', async () => {
  const store = new Map(); let sets = 0;
  const repo = createFeedbackRepository({ getItem: async k => store.get(k) ?? null, setItem: async (k, v) => { sets++; store.set(k, v); } });
  await repo.save('s1', [entry({ agentMode: 'local', engineMode: 'local' })]);
  await repo.save('s2', [entry({ giftId: 'g9' })]);
  await repo.save('s1', [entry({ helpful: false, agentMode: 'local', engineMode: 'local' })]);
  const log = await repo.load();
  assert.deepEqual(log.map(f => [f.conversationId, f.giftId, f.helpful, f.agentMode]), [['s2', 'g9', true, 'a-router'], ['s1', 'g1', false, 'local']]);
  assert.equal(sets, 3);
  assert.deepEqual(await createFeedbackRepository({ getItem: async () => '{bad', setItem: async () => {} }).load(), []);
});
