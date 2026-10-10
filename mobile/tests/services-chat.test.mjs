import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalChatService } from '../src/services/chatService.ts';
const products = JSON.parse(readFileSync(new URL('../../lib/products.json', import.meta.url)));
const service = createLocalChatService(products, { fruit: '과일', tea: '차' });

test('guest dialogue produces recommendations without exposing engine-only state', () => {
  const initial = service.createSession();
  assert.equal(service.view(initial).question.key, 'recipient');
  const turn = service.send(initial, '부모님 5만 원 배송비 포함');
  assert.equal(turn.session.state.budget.amount_krw, 50000);
  const { question, result } = service.view(turn.session);
  assert.equal(question.key, null);
  assert.ok(result.items.length > 0);
  for (const product of result.items) {
    const gift = service.toGift(product, turn.session.state);
    assert.ok(gift.price <= 50000);
    assert.equal(gift.shippingIncluded, true);
    assert.equal(gift.source, 'engine');
  }
  assert.ok(!('quantity' in turn.session.state));
  assert.ok(!('scope' in turn.session.state.budget));
  assert.equal(initial.state.budget.amount_krw, null);
});

test('partial budget updates keep shipping and ingredient exclusions intact', () => {
  const turn = service.send(service.createSession(), '친구 5만 원 배송비 포함 땅콩 알레르기');
  const before = structuredClone(turn.session);
  const updated = service.updateConditions(turn.session, { budget: { amount_krw: 60000 } });
  assert.equal(updated.session.state.budget.amount_krw, 60000);
  assert.equal(updated.session.state.budget.shipping_included, true);
  assert.deepEqual(updated.session.state.excluded_ingredients, ['땅콩']);
  assert.equal(service.view(updated.session).result.status, 'insufficient_product_info');
  assert.deepEqual(turn.session, before);
});

test('budget comparison preserves unresolved issues while explicit edits clear them', () => {
  const session = { ...service.createSession(), issues: ['피해야 할 성분을 알려주세요.'] };
  assert.deepEqual(service.updateConditions(session, { budget: { amount_krw: 50000 } }, false).session.issues, session.issues);
  assert.deepEqual(service.updateConditions(session, { recipients: ['친구'] }).session.issues, []);
  assert.throws(() => service.send(session, '  '), /입력/);
});
