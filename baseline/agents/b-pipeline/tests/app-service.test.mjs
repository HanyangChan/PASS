// P6 app service layer (pure parts of app/src/services/pipelineEvents.mjs): SSE parsing, event folding, the view the
// screens read, quick replies, patch mapping, URL/participant rules. No React, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRules } from '../../../src/parser.mjs';
import { createSseParser, emptyTurn, reduceEvent, viewOf, quickRepliesFor, toBaselinePatch, resolvePipelineUrl, validParticipantId, errorText } from '../app/src/services/pipelineEvents.mjs';
import { createHandlers } from '../server/index.mjs';
import { createPipeline } from '../pipeline/index.mjs';
import { products } from './fixtures/catalog.mjs';
import { stores, seedPeople, seedS1Memories } from './fixtures/people.mjs';

const frame = (type, data) => `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;

test('SSE parser: frames split anywhere in the byte stream come out whole and in order; broken frames are dropped', () => {
  const text = frame('cards', { a: 1 }) + frame('explanations', { items: [] }) + 'event: x\ndata: {oops\n\n' + frame('conditions', { ok: true });
  for (const size of [1, 3, 7, 50, text.length]) {
    const p = createSseParser(), got = [];
    for (let i = 0; i < text.length; i += size) got.push(...p.feed(text.slice(i, i + size)));
    assert.deepEqual(got.map(f => f.type), ['cards', 'explanations', 'conditions'], `chunk ${size}`);
  }
  assert.deepEqual(createSseParser().feed('event: a\r\ndata: {"n":1}\r\n\r\n'), [{ type: 'a', data: { n: 1 } }], 'CRLF');
});

test('the same turn, read from a real /chat stream, folds into one view: cards before explanations, conditions, products', async () => {
  const store = stores.memory();
  const people = await seedPeople(store);
  await seedS1Memories(store, people);
  const h = createHandlers({ store, products, pipeline: createPipeline({ store, products, explain: null, now: () => '2027-01-25T03:00:00.000Z' }) });
  const wire = [];
  await h.chat({ ownerId: 'userA', sessionId: 's', experiment: 'B', request: { kind: 'message', text: '부모님 설 선물 한 세트 세트당 예산 5만원 이하 배송비 포함 추천' } }, e => wire.push(frame(e.type, e)));
  const parser = createSseParser();
  const steps = [];
  let turn = emptyTurn();
  for (const { type, data } of parser.feed(wire.join(''))) { turn = reduceEvent(turn, { ...data, type }); steps.push([type, turn.cards.length, turn.explanations === null]); }
  assert.deepEqual(steps.map(s => s[0]), ['cards', 'conditions', 'explanations']);
  assert.equal(steps[0][1], 3, 'cards are on screen before the explanations exist');
  assert.equal(steps[1][2] && steps[0][2], true, 'explanations are still null at that point');
  assert.equal(turn.banner.text, '지난 기억을 반영했어요: 단 음식 X · 땅콩 제외 · 등산');
  assert.deepEqual(turn.conditions.recipients, ['부모님']);
  assert.equal(turn.products.length, 3);
  assert.deepEqual(turn.products.map(p => p.id), turn.cards.map(c => c.id));
  assert.ok(turn.explanations[0].tags.length >= 2);
  const v = viewOf(turn);
  assert.equal(v.question.key, null);
  assert.deepEqual(v.result.items.map(i => [i.id, i.total]), turn.cards.map(c => [c.id, c.total_krw]), 'items = engine products + total, same order');
  assert.deepEqual(v.comparison, { message: '', alternatives: [] }, 'no budget-raising alternatives in this mode');
  // "이 상품만" hides a card in the view but never reorders the rest
  const hidden = viewOf({ ...turn, hiddenProductIds: [turn.cards[0].id] });
  assert.deepEqual(hidden.result.items.map(i => i.id), turn.cards.slice(1).map(c => c.id));
});

test('a question resets the view and keeps the compare tray; compare_add fills the tray once per product', () => {
  let t = emptyTurn();
  const product = { id: 'p1', name: '차 세트' };
  t = reduceEvent(t, { type: 'compare_add', productId: 'p1', product, costDelta: 6000, rating: { from: 4, to: 4.6 }, againstId: 'top' });
  t = reduceEvent(t, { type: 'compare_add', productId: 'p1', product, costDelta: 6000, rating: { from: 4, to: 4.6 }, againstId: 'top' });
  assert.equal(t.compare.length, 1);
  t = reduceEvent(t, { type: 'question', question: '예산 상한을 알려주세요.', version: 3, budgetChips: [{ label: '3만원', amount_krw: 30000 }] });
  assert.equal(t.compare.length, 1, 'tray survives a new question');
  assert.deepEqual([t.cards, t.explanations, t.question], [[], null, '예산 상한을 알려주세요.']);
  const v = viewOf(t);
  assert.deepEqual([v.question.key, v.question.choices], ['pipeline', ['3만원']]);
  assert.equal(errorText('version_conflict').includes('다시'), true);
  assert.equal(reduceEvent(emptyTurn(), { type: 'error', code: 'invalid_request' }).error, 'invalid_request');
});

test('quick replies for the baseline questions are sentences the common parser really understands', () => {
  const cases = [
    ['예산 상한을 알려주세요.', ['3만원', '5만원', '10만원'], p => p.budget?.amount_krw],
    ['예산에 배송비를 포함할까요?', ['배송비 포함', '상품값만'], p => p.budget?.shipping_included],
    ['선물 수량을 알려주세요.', ['한 세트'], p => p.quantity],
    ['총예산인지 세트당 예산인지 알려주세요.', ['세트당'], p => p.budget?.scope],
  ];
  for (const [q, replies, pick] of cases) {
    assert.deepEqual(quickRepliesFor(q), replies, q);
    for (const r of replies) { const parsed = parseRules(r); assert.equal(parsed.unresolved, false, `${q} -> ${r}`); assert.notEqual(pick(parsed.patch), undefined, r); }
  }
  assert.deepEqual(quickRepliesFor('받는 사람을 알려주세요.'), []);
  assert.deepEqual(quickRepliesFor('예산 상한을 알려주세요.', [{ label: '3만원', amount_krw: 30000 }]), ['3만원'], 'the cap chip replaces the generic ones');
});

test('toBaselinePatch keeps only condition fields and drops empty budget parts', () => {
  assert.deepEqual(toBaselinePatch({ recipients: ['친구'], budget: { amount_krw: 30000, shipping_included: null }, quantity: 5, evil: 1 }), { recipients: ['친구'], budget: { amount_krw: 30000 } });
  assert.deepEqual(toBaselinePatch({ budget: { amount_krw: null, shipping_included: null }, preferences: ['less_sweet'] }), { preferences: ['less_sweet'] });
  assert.deepEqual(toBaselinePatch(undefined), {});
});

test('server address and participant id rules (K7: local experiment only)', () => {
  assert.equal(resolvePipelineUrl(''), null);
  for (const ok of ['http://127.0.0.1:8787', 'http://localhost:8787/', 'http://192.168.0.12:8787', 'http://10.0.0.5:8787', 'http://172.20.1.1:8787', 'https://pipeline.example.com']) assert.ok(resolvePipelineUrl(ok), ok);
  for (const bad of ['http://example.com', 'http://172.32.0.1:8787', 'https://u:p@example.com', 'https://example.com/chat', 'https://example.com/?k=1', 'ftp://127.0.0.1']) assert.throws(() => resolvePipelineUrl(bad), Error, bad);
  assert.deepEqual(['p01', 'user.A-1', 'a:b'].map(validParticipantId), [true, true, true]);
  assert.deepEqual(['', 'a b', '한글', 'x'.repeat(65), null].map(validParticipantId), [false, false, false, false, false]);
});
