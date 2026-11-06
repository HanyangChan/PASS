import test from 'node:test';
import assert from 'node:assert/strict';
import { createServerChatService, resolveChatUrl } from '../src/services/serverChatService.ts';
import { createApi } from '../../api/worker.mjs';
import { singleInitial } from '../../lib/single-gift.mjs';
import { readFileSync } from 'node:fs';
const session = () => ({ state: singleInitial(), issues: [] });
const auth = () => ({ getSession: async () => ({ data: { session: { access_token: 'test.jwt', user: { id: 'owner' } } }, error: null }) });
const config = { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', APP_ORIGINS: '', IP_LIMITER: { limit: async () => ({ success: true }) }, USER_LIMITER: { limit: async () => ({ success: true }) } };
const products = JSON.parse(readFileSync(new URL('../../tests/fixtures/food-demo.json', import.meta.url)));
const transport = createApi({ catalog: async () => products, fetcher: async () => Response.json({ id: 'owner', role: 'authenticated' }) });
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

test('AI interpretation failures display a specific safe message instead of a connection error',async()=>{
 const service=createServerChatService('https://api.example/api/chat',auth(),'owner',async()=>Response.json({code:'interpretation_unavailable',error:'private upstream details'},{status:503}));
 await assert.rejects(service.send(session(),'향이 강한 제품은 빼줘',[]),error=>/조건 해석을 완료하지 못했어요/.test(error.message)&&!error.message.includes('private'));
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

test('selected response mode is sent for chat, edits and view and verified in the response', async () => {
  const posted=[];
  const service=createServerChatService('https://api.example/api/chat',auth(),'owner',async(url,options)=>{
    posted.push(JSON.parse(options.body));
    return transport.fetch(new Request(url,options),{...config,CHAT_AGENT:'full-chat',LLM_PROVIDER:'openai-compatible',LLM_API_KEY:'synthetic-secret'});
  });
  const turn=await service.send(session(),'어머니 예산 5만원 배송비 포함',[],'typed',undefined,'a-router');
  await service.updateConditions(turn.session,{budget:{amount_krw:70000}},true,undefined,'a-router');
  await service.view(turn.session,undefined,'full-chat-feedback-2');
  assert.deepEqual(posted.map(v=>v.agentMode),['a-router','a-router','full-chat-feedback-2']);
  const mismatch=createServerChatService('https://api.example/api/chat',auth(),'owner',async(url,options)=>{
    const raw=JSON.parse(options.body);delete raw.agentMode;
    return transport.fetch(new Request(url,{...options,body:JSON.stringify(raw)}),{...config,CHAT_AGENT:'a-router'});
  });
  await assert.rejects(mismatch.view(turn.session,undefined,'full-chat'),/선택한 응답 방식/);
});
