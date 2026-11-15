import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../worker.mjs';
import { singleInitial } from '../../lib/single-gift.mjs';
import { products } from '../../baseline/examples/catalog.mjs';

const env = { CHAT_AGENT: 'a-router', SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', IP_LIMITER: { limit: async () => ({ success: true }) }, USER_LIMITER: { limit: async () => ({ success: true }) } };
const session = () => ({ state: { ...singleInitial(), recipients: ['어머니'], budget: { amount_krw: 50000, shipping_included: true } }, issues: [] });
const api = createApi({ catalog: async () => products, fetcher: async url => {
  if (String(url).includes('/auth/v1/user')) return Response.json({ id: 'owner', role: 'authenticated' });
  throw Error('no model calls expected');
} });
const ask = body => api.fetch(new Request('https://test/api/chat', { method: 'POST', headers: { Authorization: 'Bearer synthetic.jwt', 'Content-Type': 'application/json' }, body: JSON.stringify({ operation: 'view', session: session(), history: [], ...body }) }), env);
const top = data => data.view.result.items.map(i => i.id);

for (const agentMode of [undefined, 'a-router', 'langgraph-advisors']) {
  test(`request feedback changes scores and order (${agentMode ?? 'default'})`, async () => {
    const plain = await (await ask({ agentMode })).json();
    const first = top(plain)[0];
    assert.ok(first, 'baseline has a recommendation');
    assert.ok(plain.view.result.items.every(i => !('feedback_score' in i)));
    const response = await ask({ agentMode, feedback: [{ giftId: first, helpful: false }] });
    assert.equal(response.status, 200);
    const after = await response.json();
    assert.notEqual(top(after)[0], first, 'the disliked product is no longer first');
    assert.ok(after.view.result.items.find(i => i.id === first).feedback_score <= -5, 'the score change is visible');
    assert.deepEqual(after.session.state, plain.session.state, 'feedback never changes the conditions');
  });
}

test('malformed feedback is rejected before ranking', async () => {
  for (const feedback of ['x', [{ giftId: 1, helpful: true }], [{ giftId: 'a', helpful: 'yes' }], Array.from({ length: 201 }, (_, i) => ({ giftId: `g${i}`, helpful: true }))]) {
    const response = await ask({ feedback });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'invalid_request');
  }
});
