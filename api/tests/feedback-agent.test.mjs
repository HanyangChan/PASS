import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../worker.mjs';
import { singleInitial } from '../../lib/single-gift.mjs';
import { products } from '../../baseline/examples/catalog.mjs';
const env={CHAT_AGENT:'full-chat-feedback-1',LLM_PROVIDER:'openai-compatible',LLM_API_KEY:'synthetic-secret',LLM_MODEL:'deepseek-v4-flash',SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',IP_LIMITER:{limit:async()=>({success:true})},USER_LIMITER:{limit:async()=>({success:true})}};
test('C verifies an explicit budget against the request with one actor call',async()=>{
 const actions=[{action:'update_conditions',patch:{budget:{amount_krw:90000}}}];let calls=0;
 const api=createApi({catalog:async()=>products,fetcher:async(url,options)=>{
  if(String(url).includes('/auth/v1/user'))return Response.json({id:'synthetic',role:'authenticated'});
  calls++;const payload=JSON.parse(options.body);assert.deepEqual(payload.reasoning,{enabled:false});
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(actions.shift())}}],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12}});
 }});
 const response=await api.fetch(new Request('https://test/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer synthetic.jwt'},body:JSON.stringify({operation:'turn',text:'예산 7만원으로 바꿔줘',history:[],session:{state:{...singleInitial(),recipients:['어머니'],budget:{amount_krw:50000,shipping_included:true}},issues:[]}})}),env);
 const data=await response.json();assert.equal(response.status,200);assert.equal(data.agent,'full-chat-feedback-1');assert.equal(data.session.state.budget.amount_krw,70000);assert.equal(data.routing.llmCalls,1);assert.equal(data.routing.httpAttempts,1);assert.equal(data.routing.usage.total_tokens,12);assert.equal(data.routing.feedback.reviewSkips,1);assert.ok(!JSON.stringify(data).includes('synthetic-secret'));
 const health=await (await api.fetch(new Request('https://test/health'),{...env,CHAT_AGENT:'full-chat-feedback-2'})).json();assert.equal(health.llmMode,'feedback-loop');assert.equal(health.agent,'full-chat-feedback-2');
});

test('C rechecks a corrected allergen removal and counts both review calls',async()=>{
 const actions=[
  {action:'update_conditions',patch:{excluded_ingredients:[]}},
  {verdict:'revise',issues:['missing_constraint'],feedback:'Keep the other exclusion.'},
  {action:'update_conditions',patch:{excluded_ingredients:['땅콩']}},
  {verdict:'pass',issues:[],feedback:''},
 ];
 const api=createApi({catalog:async()=>products,fetcher:async(url,options)=>{
  if(String(url).includes('/auth/v1/user'))return Response.json({id:'synthetic',role:'authenticated'});
  const payload=JSON.parse(options.body);
  const reply=payload.messages[0].content.includes('You independently review')?{flags:[]}:actions.shift();
  assert.ok(reply);
  if(reply.verdict)assert.match(payload.messages[0].content,/action reviewer/);
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(reply)}}],usage:{prompt_tokens:10,completion_tokens:2,total_tokens:12}});
 }});
 const state={...singleInitial(),recipients:['어머니'],budget:{amount_krw:50000,shipping_included:true},excluded_ingredients:['우유','땅콩']};
 const response=await api.fetch(new Request('https://test/api/chat',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer synthetic.jwt'},body:JSON.stringify({operation:'turn',text:'우유 제외 해제해 줘. 땅콩은 계속 빼줘.',history:[],session:{state,issues:[]}})}),{...env,CHAT_AGENT:'full-chat-feedback-2'});
 const data=await response.json();
 assert.equal(response.status,200);
 assert.deepEqual(data.session.state.excluded_ingredients,['땅콩']);
 assert.equal(data.routing.httpAttempts,6);
 assert.equal(data.routing.usage.total_tokens,72);
 assert.deepEqual(data.routing.feedback.reviews.map(review=>review.reason),['allergy_constraint','allergy_constraint']);
});
