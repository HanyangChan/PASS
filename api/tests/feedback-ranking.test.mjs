import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../worker.mjs';
import { singleInitial } from '../../lib/single-gift.mjs';
import { products } from '../../baseline/examples/catalog.mjs';
import { record, scope } from '../../tests/fixtures/context-feedback.mjs';
const peers = [...products, { ...products[0], id: 'tea-peer', name: '다른 차 선물 세트', rating_count: 5 }];

const env = { CHAT_AGENT: 'a-router', LLM_PROVIDER: 'openai-compatible', LLM_API_KEY: 'synthetic', SUPABASE_URL: 'https://pass-mock.test', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', IP_LIMITER: { limit: async () => ({ success: true }) }, USER_LIMITER: { limit: async () => ({ success: true }) } };
const session = () => ({ state: { ...singleInitial(), recipients: ['어머니'], budget: { amount_krw: 50000, shipping_included: true } }, issues: [] });
const api = createApi({ catalog: async () => peers, fetcher: async url => {
  if (String(url).includes('/auth/v1/user')) return Response.json({ id: 'owner', role: 'authenticated' });
  throw Error('no model calls expected');
} });
const ask = body => api.fetch(new Request('https://test/api/chat', { method: 'POST', headers: { Authorization: 'Bearer synthetic.jwt', 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'view', session: session(), history: [], ...body }) }), env);
const top = data => data.view.result.items.map(i => i.id);

for (const agentMode of [undefined, 'a-router', 'langgraph-advisors', 'full-chat', 'full-chat-feedback-2']) {
  test(`contextual product feedback changes only equal candidates (${agentMode ?? 'default'})`, async () => {
    const plain = await (await ask({ agentMode })).json();
    const first = top(plain)[0];
    assert.ok(first, 'baseline has a recommendation');
    assert.ok(plain.view.result.items.every(i => !('feedback_score' in i)));
    const response = await ask({ agentMode, feedbackScope: scope, feedback: [record(peers.find(p => p.id === first), session().state, false)] });
    assert.equal(response.status, 200);
    const after = await response.json();
    assert.notEqual(top(after)[0], first, 'the disliked product is no longer first');
    assert.equal(after.view.result.items.find(i => i.id === first).feedback_score, -1);
    assert.deepEqual(after.session.state, plain.session.state, 'feedback never changes the conditions');
  });
}

test('unscoped legacy and explanation feedback never influence the API ranking', async () => {
  const plain = await (await ask({})).json();
  for (const feedback of [[{ giftId: 'tea', helpful: false }], [record(peers[0], session().state, false, { kind: 'reason_helpfulness' })]]) {
    const after = await (await ask({ feedback, feedbackScope: scope })).json();
    assert.deepEqual(after.view.result, plain.view.result);
  }
});

test('same-turn recipient and budget edits reselect feedback against the updated state', async () => {
  const feedback = [record(peers[0], session().state, false)];
  for (const patch of [{ recipients: ['친구'] }, { budget: { amount_krw: 70000 } }]) {
    const body = { operation: 'conditions', patch, agentMode: 'a-router' };
    const plain = await (await ask(body)).json();
    const after = await (await ask({ ...body, feedback, feedbackScope: scope })).json();
    assert.deepEqual(after.view.result, plain.view.result);
  }
});

test('every app mode reports missing requested bouquets instead of returning tea or a success claim', async () => {
  for(const agentMode of ['a-router','langgraph-advisors','full-chat','full-chat-feedback-2']) {
    const response=await ask({agentMode,operation:'conditions',patch:{preferences:['category:flower','type:bouquet']}});
    const data=await response.json();
    assert.equal(response.status,200,agentMode);
    assert.equal(data.view.result.status,'no_match',agentMode);
    assert.deepEqual(data.view.result.items,[],agentMode);
    assert.match(data.message,/요청한 상품 종류/,agentMode);
    assert.doesNotMatch(data.message,/상품을 골랐어요/,agentMode);
  }
});

test('malformed feedback is rejected before ranking', async () => {
  for (const feedback of ['x', [{ giftId: 1, helpful: true }], [{ giftId: 'a', helpful: 'yes' }], Array.from({ length: 201 }, (_, i) => ({ giftId: `g${i}`, helpful: true }))]) {
    const response = await ask({ feedback });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'invalid_request');
  }
});
