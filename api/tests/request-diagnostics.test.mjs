import test from 'node:test';
import assert from 'node:assert/strict';
import {createApi} from '../worker.mjs';
import {singleInitial} from '../../lib/single-gift.mjs';
import {products} from '../../baseline/examples/catalog.mjs';
import {makeFetcher,text} from '../../baseline/agents/a-router/tests/subagent-fixtures.mjs';
const env=()=>({CHAT_AGENT:'a-router',A_ROUTER_LLM_MODE:'subagents',LLM_PROVIDER:'openai-compatible',LLM_API_KEY:'private-test-key',SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',IP_LIMITER:{limit:async()=>({success:true})},USER_LIMITER:{limit:async()=>({success:true})}});
const request=()=>new Request('http://api.test/api/chat',{method:'POST',headers:{Authorization:'Bearer private-user-token','Content-Type':'application/json'},body:JSON.stringify({operation:'turn',text,session:{state:singleInitial(),issues:[]},history:[]})});

test('authentication failures are diagnosed without raw credentials, body or upstream message',async()=>{
 const events=[];
 const api=createApi({catalog:async()=>products,onDiagnostic:e=>events.push(e),fetcher:async()=>{throw Error('private-test-key private-user-token raw input');}});
 const response=await api.fetch(request(),env());assert.equal(response.status,503);assert.equal((await response.json()).code,'auth_unavailable');
 assert.equal(events.length,1);assert.equal(events[0].code,'auth_unavailable');assert.equal(events[0].requestId,response.headers.get('X-Request-ID'));
 const json=JSON.stringify(events);for(const value of ['private-test-key','private-user-token','raw input',text])assert.ok(!json.includes(value));
});

test('provider stage failures include safe stage diagnostics and callback failures do not affect responses',async()=>{
 const mock=makeFetcher({override:stage=>stage==='taste'?new Response('private-test-key',{status:401}):undefined});
 const events=[];
 const api=createApi({catalog:async()=>products,onDiagnostic:e=>{events.push(e);throw Error('diagnostic failure');},fetcher:async(url,options)=>String(url).includes('/auth/v1/user')?Response.json({id:'owner',role:'authenticated'}):mock.fetcher(url,options)});
 const response=await api.fetch(request(),env());assert.equal(response.status,503);assert.equal(events.length,1);assert.equal(events[0].code,'interpretation_unavailable');assert.equal(events[0].routing.subagents.stages.at(-1).errorCode,'auth_failed');assert.ok(!JSON.stringify(events).includes('private-test-key'));assert.ok(!JSON.stringify(events).includes(text));
 assert.equal((await response.json()).code,'interpretation_unavailable');
});
