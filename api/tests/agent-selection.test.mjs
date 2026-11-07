import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../worker.mjs';
import { singleInitial } from '../../lib/single-gift.mjs';
import { products } from '../../baseline/examples/catalog.mjs';
const env={CHAT_AGENT:'full-chat',LLM_PROVIDER:'openai-compatible',LLM_API_KEY:'synthetic-secret',SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',IP_LIMITER:{limit:async()=>({success:true})},USER_LIMITER:{limit:async()=>({success:true})}};
const session=()=>({state:{...singleInitial(),recipients:['어머니'],budget:{amount_krw:50000,shipping_included:true}},issues:[]});
const request=body=>new Request('https://test/api/chat',{method:'POST',headers:{Authorization:'Bearer synthetic.jwt','Content-Type':'application/json'},body:JSON.stringify({operation:'turn',session:session(),text:'추천해줘',history:[],...body})});
function fixture() {
 let calls=0;
 const api=createApi({catalog:async()=>products,fetcher:async(url,options)=>{
  if(String(url).includes('/auth/v1/user'))return Response.json({id:'owner',role:'authenticated'});
  calls++;
  const messages=JSON.parse(options.body).messages,context=JSON.parse(messages[1].content);
  const result=messages[0].content.includes('action reviewer')?{verdict:'pass',issues:[],feedback:''}:context.observations.length?{action:'respond',type:'result'}:{action:'search_products'};
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(result)}}]});
 }});
 return {api,calls:()=>calls};
}
test('request agentMode selects the actual agent without changing the server default',async()=>{
 const f=fixture();
 for(const [mode,expectedCalls] of [['a-router',0],['full-chat',2],['full-chat-feedback-2',4]]) {
  const before=f.calls();const response=await f.api.fetch(request({agentMode:mode}),env);const data=await response.json();
  assert.equal(response.status,200);assert.equal(data.agent,mode);assert.equal(data.routing.agent,mode);assert.equal(f.calls()-before,expectedCalls);assert.deepEqual(data.session,session());
 }
 const fallback=await (await f.api.fetch(request({}),env)).json();assert.equal(fallback.agent,'full-chat');assert.equal(env.CHAT_AGENT,'full-chat');
});
test('unrecognized request modes fail before any model call',async()=>{
 const f=fixture();
 for(const agentMode of ['legacy','full-chat-feedback-1','invalid',null,{},1]) {
  const response=await f.api.fetch(request({agentMode}),env);assert.equal(response.status,400);assert.equal((await response.json()).code,'invalid_request');
 }
 assert.equal(f.calls(),0);
});
test('condition edits and view hydration honor selection and mode stays isolated per request',async()=>{
 const f=fixture();
 const responses=await Promise.all(['a-router','full-chat-feedback-2'].map(agentMode=>f.api.fetch(request({agentMode,operation:'conditions',patch:{budget:{amount_krw:70000}}}),env)));
 const data=await Promise.all(responses.map(r=>r.json()));assert.deepEqual(data.map(d=>d.agent),['a-router','full-chat-feedback-2']);assert.ok(data.every(d=>d.session.state.budget.amount_krw===70000));assert.equal(f.calls(),0);
 const view=await (await f.api.fetch(request({operation:'view',agentMode:'a-router'}),env)).json();assert.equal(view.agent,'a-router');
});
