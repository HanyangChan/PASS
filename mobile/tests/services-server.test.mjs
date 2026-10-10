import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerChatService, resolveChatUrl } from '../src/services/serverChatService.ts';
import { createApi } from '../../api/worker.mjs';
import { singleInitial } from '../../lib/single-gift.mjs';
const session = () => ({ state: singleInitial(), issues: [] });
const auth = () => ({ getSession: async () => ({ data: { session: { access_token: 'test.jwt', user: { id: 'owner' } } }, error: null }) });
const config = { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', APP_ORIGINS: '', IP_LIMITER: { limit: async () => ({ success: true }) }, USER_LIMITER: { limit: async () => ({ success: true }) } };
const transport = createApi({ fetcher: async () => Response.json({ id: 'owner', role: 'authenticated' }) });
test('client sends token and bounded history to the Worker and receives the server ranking', async () => {
  let posted;
  const service = createServerChatService('https://api.example/api/chat', auth(), 'owner', async (url, options) => {
    posted = JSON.parse(options.body); assert.equal(options.headers.Authorization, 'Bearer test.jwt');
    return transport.fetch(new Request(url, options), config);
  });
  const history = Array.from({ length: 10 }, () => ({ role: 'user', text: 'a'.repeat(2000) }));
  const result = await service.send(session(), '부모님 예산 5만원', history);
  assert.equal(posted.history.length, 6); assert.equal(posted.history[0].text.length, 1200);
  assert.equal(result.session.state.budget.amount_krw, 50000); assert.ok(result.view.result.items.length);
  const changed = await service.updateConditions(result.session, { budget: { shipping_included: true } });
  assert.equal(changed.session.state.budget.amount_krw, 50000); assert.equal(changed.session.state.budget.shipping_included, true);
});
test('network and API failures reject instead of applying a local fallback', async () => {
  for (const status of [401, 429, 503]) {
    const service = createServerChatService('https://api.example/api/chat', auth(), 'owner', async () => new Response(null, { status }));
    await assert.rejects(service.send(session(), '부모님', []));
  }
});
test('account changes while response is in flight reject the old response', async () => {
  let current = 'owner';
  const identity = { getSession: async () => ({ data: { session: { access_token: 'test.jwt', user: { id: current } } }, error: null }) };
  const service = createServerChatService('https://api.example/api/chat', identity, 'owner', async (url, options) => { const response = await transport.fetch(new Request(url, options), config); current = 'other'; return response; });
  await assert.rejects(service.send(session(), '부모님', []), /계정이 변경/);
});
test('malformed responses and credential-bearing or insecure endpoints are rejected', async () => {
  const service = createServerChatService('https://api.example/api/chat', auth(), 'owner', async () => Response.json({ session: session(), message: 'malformed' }));
  await assert.rejects(service.send(session(), '부모님', []));
  assert.equal(resolveChatUrl('http://127.0.0.1:8788'), 'http://127.0.0.1:8788/api/chat');
  assert.throws(() => resolveChatUrl('http://api.example')); assert.throws(() => resolveChatUrl('https://user:password@api.example')); assert.throws(() => resolveChatUrl('https://api.example?key=secret'));
});
test('cancelling a request prevents delivering an otherwise valid response', async () => {
  const controller = new AbortController();
  const service = createServerChatService('https://api.example/api/chat', auth(), 'owner', async (url, options) => { const response = await transport.fetch(new Request(url, options), config); controller.abort(); return response; });
  await assert.rejects(service.send(session(), '부모님', [], 'typed', controller.signal), /취소/);
});
