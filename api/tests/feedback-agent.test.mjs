import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../worker.mjs';
import { singleInitial } from '../../lib/single-gift.mjs';
import { products } from '../../baseline/examples/catalog.mjs';
const env={CHAT_AGENT:'full-chat-feedback-1',LLM_PROVIDER:'openai-compatible',LLM_API_KEY:'synthetic-secret',LLM_MODEL:'deepseek-v4-flash',SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',IP_LIMITER:{limit:async()=>({success:true})},USER_LIMITER:{limit:async()=>({success:true})}};
test('API feedback mode uses actor-review-revision wire calls and counts all usage',async()=>{
 const actions=[{action:'update_conditions',patch:{budget:{amount_krw:70000}}},{verdict:'pass',issues:[],feedback:''},{action:'respond',type:'acknowledge'},{verdict:'revise',issues:['premature_finish'],feedback:'Use result response for existing observations.'},{action:'respond',type:'result'}];let calls=0;
 const api=createApi({catalog:async()=>products,fetcher:async(url,options)=>{
  if(String(url).includes('/auth/v1/user'))return Response.json({id:'synthetic',role:'authenticated'});
  calls++;const payload=JSON.parse(options.body);assert.deepEqual(payload.reasoning,{enabled:false});
  if(calls===2||calls===4)assert.match(payload.messages[0].content,/action reviewer/);
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(actions.shift())}}],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12}});
 }});
 const response=await api.fetch(new Request('https://test/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer synthetic.jwt'},body:JSON.stringify({operation:'turn',text:'예산 7만원으로 바꿔줘',history:[],session:{state:{...singleInitial(),recipients:['어머니'],budget:{amount_krw:50000,shipping_included:true}},issues:[]}})}),env);
 const data=await response.json();assert.equal(response.status,200);assert.equal(data.agent,'full-chat-feedback-1');assert.equal(data.session.state.budget.amount_krw,70000);assert.equal(data.routing.llmCalls,5);assert.equal(data.routing.httpAttempts,5);assert.equal(data.routing.usage.total_tokens,60);assert.ok(!JSON.stringify(data).includes('synthetic-secret'));
 const health=await (await api.fetch(new Request('https://test/health'),{...env,CHAT_AGENT:'full-chat-feedback-2'})).json();assert.equal(health.llmMode,'feedback-loop');assert.equal(health.agent,'full-chat-feedback-2');
});
