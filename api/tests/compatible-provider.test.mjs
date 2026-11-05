import test from 'node:test';
import assert from 'node:assert/strict';
import {createApi} from '../worker.mjs';
import {singleInitial} from '../../lib/single-gift.mjs';
import {products} from '../../baseline/examples/catalog.mjs';
const env=()=>({CHAT_AGENT:'a-router',LLM_PROVIDER:'openai-compatible',LLM_MODEL:'deepseek-v4-flash',LLM_BASE_URL:'https://llm.ai.hy.miwork.ai',LLM_API_KEY:'platform-test-key',GEMINI_API_KEY:'gemini-test-key',SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',IP_LIMITER:{limit:async()=>({success:true})},USER_LIMITER:{limit:async()=>({success:true})}});
const state=()=>({...singleInitial(),recipients:['어머니'],budget:{amount_krw:50000,shipping_included:true}});
const request=text=>new Request('https://api.example/api/chat',{method:'POST',headers:{Authorization:'Bearer app-token','Content-Type':'application/json'},body:JSON.stringify({operation:'turn',session:{state:state(),issues:[]},history:[],text})});

test('a-router calls the selected platform only for unresolved messages',async()=>{
 let calls=0;
 const api=createApi({catalog:async()=>products,fetcher:async(url,options)=>{
  if(String(url).includes('/auth/v1/user')) return Response.json({id:'owner',role:'authenticated'});
  calls++;assert.equal(url,'https://llm.ai.hy.miwork.ai/chat/completions');assert.equal(options.headers.Authorization,'Bearer platform-test-key');
  const payload=JSON.parse(options.body);assert.equal(payload.model,'deepseek-v4-flash');assert.match(payload.messages[0].content,/recipient-attributed/);
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({state:{...state(),preferences:['category:coffee_tea']},question:null})}}]});
 }});
 const clear=await api.fetch(request('예산 7만원으로 바꿔줘'),env());assert.equal(clear.status,200);assert.equal(calls,0);
 const response=await api.fetch(request('센스 있는 선물'),env());assert.equal(response.status,200);
 const data=await response.json();assert.equal(calls,1);assert.equal(data.mode,'llm');assert.equal(data.llmProvider,'openai-compatible');assert.equal(data.llmModel,'deepseek-v4-flash');assert.deepEqual(data.session.state.preferences,['category:coffee_tea']);
 assert.ok(!JSON.stringify(data).includes('platform-test-key'));assert.ok(!JSON.stringify(data).includes('gemini-test-key'));
 const health=await (await api.fetch(new Request('https://api.example/health'),env())).json();assert.equal(health.provider,'openai-compatible');assert.equal(health.model,'deepseek-v4-flash');
});

test('missing platform key asks for clarification without using existing Gemini key',async()=>{
 const config=env();delete config.LLM_API_KEY;let calls=0;
 const api=createApi({catalog:async()=>products,fetcher:async(url)=>{
  assert.match(String(url),/auth\/v1\/user/);calls++;return Response.json({id:'owner',role:'authenticated'});
 }});
 const response=await api.fetch(request('센스 있는 선물'),config);const data=await response.json();
 assert.equal(response.status,200);assert.equal(calls,1);assert.equal(data.mode,'rules');assert.deepEqual(data.session.state,state());assert.equal(data.question.key,'issue');
});

test('platform provider failure is retryable and never applies new app state',async()=>{
 const api=createApi({catalog:async()=>products,fetcher:async(url)=>String(url).includes('/auth/v1/user')?Response.json({id:'owner',role:'authenticated'}):new Response('platform-test-key',{status:401})});
 const response=await api.fetch(request('센스 있는 선물'),env());assert.equal(response.status,503);const data=await response.json();assert.ok(!('session' in data));assert.ok(!JSON.stringify(data).includes('platform-test-key'));
});
