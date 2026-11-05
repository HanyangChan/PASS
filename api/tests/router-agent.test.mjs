import test from 'node:test';
import assert from 'node:assert/strict';
import {createApi} from '../worker.mjs';
import {singleInitial,finishSingle} from '../../lib/single-gift.mjs';
import {products} from '../../baseline/examples/catalog.mjs';
const env=()=>({CHAT_AGENT:'a-router',SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',APP_ORIGINS:'https://app.example',IP_LIMITER:{limit:async()=>({success:true})},USER_LIMITER:{limit:async()=>({success:true})}});
const initial=()=>({state:singleInitial(),issues:[]});
const ready=()=>({state:{...singleInitial(),recipients:['어머니'],budget:{amount_krw:50000,shipping_included:true}},issues:[]});
const body=(extra={})=>({operation:'turn',session:initial(),text:'엄마 예산 5만원 배송비 포함',history:[],...extra});
const request=(value,headers={})=>new Request('https://api.example/api/chat',{method:'POST',headers:{Authorization:'Bearer test.jwt.value','Content-Type':'application/json',...headers},body:JSON.stringify(value)});
const verified=async()=>Response.json({id:'owner',role:'authenticated'});
const api=(extra={})=>createApi({catalog:async()=>products,fetcher:verified,...extra});
async function send(value,config=env(),instance=api()) {
 const response=await instance.fetch(request(value),config);
 return {status:response.status,data:await response.json()};
}

test('a-router handles typed prototype requests with no LLM even when a key exists',async()=>{
 let calls=0;
 const out=await send(body(),{...env(),GEMINI_API_KEY:'test-secret'},api({extract:async()=>{calls++;throw Error('unexpected');}}));
 assert.equal(out.status,200);assert.equal(out.data.agent,'a-router');assert.equal(out.data.mode,'rules');assert.equal(out.data.routing.llmCalls,0);assert.equal(calls,0);
 assert.deepEqual(out.data.session.state.recipients,['어머니']);assert.equal(out.data.session.state.budget.amount_krw,50000);
 assert.equal(out.data.question.key,null);assert.equal(out.data.view.result.items[0].id,'tea');
 assert.ok(!('quantity' in out.data.session.state));assert.ok(!('scope' in out.data.session.state.budget));
});

test('natural budget comparison returns computed facts while app conditions and main cards remain unchanged',async()=>{
 const session=ready(),before=structuredClone(session);
 const out=await send(body({session,text:'예산 7만원이면?'}));
 assert.equal(out.status,200);assert.deepEqual(out.data.session,session);assert.match(out.data.message,/고급 차 세트/);assert.match(out.data.message,/70,000/);
 assert.equal(out.data.view.result.items[0].id,'tea');assert.equal(out.data.routing.intent,'compare_budget');assert.deepEqual(session,before);
 const apply=await send(body({session,text:'예산 7만원으로 바꿔줘'}));assert.equal(apply.data.session.state.budget.amount_krw,70000);assert.equal(apply.data.view.result.items[0].id,'premium');
});

test('prototype condition edits and recipient switch preserve only explicit new conditions',async()=>{
 const session=ready();session.state.excluded_ingredients=['우유'];session.state.preferences=['category:coffee_tea'];
 const newRecipient=await send(body({session,operation:'conditions',patch:{recipients:['친구']}}));
 assert.equal(newRecipient.status,200);assert.deepEqual(newRecipient.data.session.state.excluded_ingredients,[]);assert.deepEqual(newRecipient.data.session.state.preferences,[]);assert.equal(newRecipient.data.session.state.budget.amount_krw,null);
 assert.equal(newRecipient.data.question.key,'amount');
 const changed=await send(body({session,operation:'conditions',patch:{budget:{amount_krw:70000}}}));
 assert.deepEqual(changed.data.session.state.excluded_ingredients,['우유']);assert.equal(changed.data.session.state.budget.shipping_included,true);
});

test('shipping replies, allergen corrections and ambiguity round-trip using existing app schema',async()=>{
 const session=ready();session.state.budget.shipping_included=null;
 const no=await send(body({session,text:'아니요',source:'quick_reply'}));assert.equal(no.data.mode,'rules_fast');assert.equal(no.data.session.state.budget.shipping_included,false);
 const unknown=await send(body({session:ready(),text:'알레르기가 있어요'}));assert.equal(unknown.data.question.key,'issue');assert.match(unknown.data.question.text,/성분/);
 const unrelated=await send(body({session:unknown.data.session,text:'예산 7만원'}));assert.equal(unrelated.data.question.key,'issue');assert.match(unrelated.data.question.text,/성분/);
 const ingredient=await send(body({session:unknown.data.session,text:'우유'}));assert.deepEqual(ingredient.data.session.state.excluded_ingredients,['우유']);assert.equal(ingredient.data.question.key,null);
});

test('only unresolved text invokes the existing server model adapter with attribution instructions',async()=>{
 let calls=0;
 const instance=api({extract:async(input,catalog,options)=>{
  calls++;assert.equal(options.apiKey,'test-secret');assert.match(options.additionalInstructions,/recipient-attributed/);
  assert.equal(input.history.length,1);return finishSingle(input.state,{...input.state,preferences:['category:coffee_tea']},[],catalog);
 }});
 const out=await send(body({session:ready(),text:'센스 있는 선물',history:[{role:'user',text:'엄마 선물'}]}),{...env(),GEMINI_API_KEY:'test-secret'},instance);
 assert.equal(out.status,200);assert.equal(out.data.mode,'llm');assert.equal(out.data.routing.llmCalls,1);assert.equal(calls,1);assert.ok(!JSON.stringify(out.data).includes('test-secret'));
});

test('model failure returns retryable 503 and no changed session or upstream details',async()=>{
 const out=await send(body({session:ready(),text:'센스 있는 선물'}),{...env(),GEMINI_API_KEY:'test-secret'},api({extract:async()=>{throw Error('test-secret and raw input');}}));
 assert.equal(out.status,503);assert.ok(!JSON.stringify(out.data).includes('test-secret'));assert.ok(!('session' in out.data));
});

test('no-key ambiguity and giver facts ask instead of inventing recipient tastes',async()=>{
 for (const text of ['센스 있는 선물','나는 커피를 좋아해','예산 10만원 이하 최소 15만원']) {
  const session=ready();const out=await send(body({session,text}));assert.equal(out.status,200);assert.deepEqual(out.data.session.state,session.state);assert.equal(out.data.question.key,'issue');
 }
});

test('explanation uses engine facts, multiple gifts are clarified, auth and config still fail closed',async()=>{
 const explained=await send(body({session:ready(),text:'왜 추천했어?'}));assert.match(explained.data.message,/33,000/);assert.match(explained.data.message,/선호 점수/);
 const multi=await send(body({session:ready(),text:'두 세트'}));assert.equal(multi.data.question.key,'issue');assert.match(multi.data.message,/선물 하나/);assert.deepEqual(multi.data.session.state,ready().state);
 const response=await api({fetcher:async()=>new Response(null,{status:401})}).fetch(request(body()),env());assert.equal(response.status,401);
 const bad=await send(body(),{...env(),CHAT_AGENT:'not-an-agent'});assert.equal(bad.status,503);assert.equal(bad.data.code,'configuration');
});

test('an unresolved allergy blocks chat recommendations, comparisons and explanations',async()=>{
 const session={...ready(),issues:['피해야 할 알레르기 성분을 알려주세요.']};
 for(const text of ['추천해줘','왜 추천했어?','예산 7만원이면?']) {
  const out=await send(body({session,text}));assert.equal(out.data.question.key,'issue');assert.match(out.data.message,/성분/);assert.ok(!out.data.message.includes('고급 차 세트'));
 }
});

test('actual Gemini wire adapter receives server-only attribution policy and returns validated conditions',async()=>{
 let modelCalls=0;
 const fetcher=async(url,options)=>{
  if(String(url).includes('/auth/v1/user')) return verified();
  modelCalls++;assert.equal(options.headers['x-goog-api-key'],'test-secret');
  const payload=JSON.parse(options.body);assert.match(payload.systemInstruction.parts[0].text,/recipient-attributed/);
  const state={...ready().state,preferences:['category:coffee_tea']};
  return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({state,question:null})}]}}]});
 };
 const out=await send(body({session:ready(),text:'센스 있는 선물'}),{...env(),GEMINI_API_KEY:'test-secret'},api({fetcher}));
 assert.equal(out.status,200);assert.equal(modelCalls,1);assert.equal(out.data.routing.route,'llm');assert.deepEqual(out.data.session.state.preferences,['category:coffee_tea']);assert.ok(!JSON.stringify(out.data).includes('test-secret'));
});
