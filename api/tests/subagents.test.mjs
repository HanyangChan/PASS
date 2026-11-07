import test from 'node:test';
import assert from 'node:assert/strict';
import {createApi} from '../worker.mjs';
import {singleInitial} from '../../lib/single-gift.mjs';
import {products} from '../../baseline/examples/catalog.mjs';
import {makeFetcher,text} from '../../baseline/agents/a-router/tests/subagent-fixtures.mjs';
const env=()=>({CHAT_AGENT:'a-router',A_ROUTER_LLM_MODE:'subagents',LLM_PROVIDER:'openai-compatible',LLM_API_KEY:'test-key',LLM_MODEL:'deepseek-v4-flash',SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',IP_LIMITER:{limit:async()=>({success:true})},USER_LIMITER:{limit:async()=>({success:true})}});
const session=()=>({state:{...singleInitial(),recipients:['어머니'],budget:{amount_krw:50000,shipping_included:true}},issues:[]});
const request=(text,values={})=>new Request('http://api.test/api/chat',{method:'POST',headers:{Authorization:'Bearer test-token','Content-Type':'application/json'},body:JSON.stringify({operation:'turn',text,session:session(),history:[],...values})});
function setup(mock) {return createApi({catalog:async()=>products,fetcher:async(url,options)=>String(url).includes('/auth/v1/user')?Response.json({id:'owner',role:'authenticated'}):mock.fetcher(url,options)});}

test('subagents mode is server-selected, bypassed on rules, and preserves the app response schema',async()=>{
 const mock=makeFetcher(),api=setup(mock);
 const clear=await (await api.fetch(request('예산 7만원으로 바꿔줘'),env())).json();assert.equal(mock.calls.length,0);assert.equal(clear.routing.llmCalls,0);assert.equal(clear.session.state.budget.amount_krw,70000);
 const response=await api.fetch(request(text),env());assert.equal(response.status,200);
 const out=await response.json();assert.equal(out.mode,'llm');assert.equal(out.routing.llmCalls,3);assert.deepEqual(out.routing.subagents.selectedAgents,['taste']);assert.equal(out.routing.subagents.httpAttempts,3);assert.deepEqual(out.session.state.excluded_ingredients,['우유']);assert.equal(out.session.state.budget.amount_krw,50000);assert.ok(Array.isArray(out.view.result.items));assert.ok(!('quantity' in out.session.state));assert.ok(!JSON.stringify(out).includes('test-key'));
 const health=await (await api.fetch(new Request('http://api.test/health'),env())).json();assert.equal(health.llmMode,'subagents');
});

test('failed expert yields sanitized trace and no partially changed state',async()=>{
 const mock=makeFetcher({override:stage=>stage==='taste'?new Response('test-key raw output',{status:401}):undefined});
 const response=await setup(mock).fetch(request(text),env());assert.equal(response.status,503);const out=await response.json();assert.ok(!('session' in out));assert.equal(out.routing.llmCalls,2);assert.equal(out.routing.subagents.stages.at(-1).status,'failed');assert.ok(!JSON.stringify(out).includes('test-key'));assert.ok(!mock.calls.includes('synthesizer'));
});

test('misconfigured mode/provider cannot silently switch LLM paths',async()=>{
 const mock=makeFetcher(),api=setup(mock);
 for(const config of [{...env(),A_ROUTER_LLM_MODE:'invented'},{...env(),LLM_PROVIDER:'gemini',GEMINI_API_KEY:'test-gemini'}])assert.equal((await api.fetch(request(text),config)).status,503);
 assert.equal(mock.calls.length,0);
});
