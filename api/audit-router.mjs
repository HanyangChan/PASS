// Isolated Router audit: synthetic catalog/session and in-memory auth; one real LLM request.
// No user login tokens, real account records or real catalog are used or modified.
import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createApi } from './worker.mjs';
import { loadLocalEnv } from './local-env.mjs';
import { singleInitial } from '../lib/single-gift.mjs';
import { products } from '../baseline/examples/catalog.mjs';

const local=await loadLocalEnv();
const env={...local,CHAT_AGENT:'a-router',SUPABASE_URL:'https://router-audit.invalid',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_audit',APP_ORIGINS:'http://localhost:8766',IP_LIMITER:{limit:async()=>({success:true})},USER_LIMITER:{limit:async()=>({success:true})}};
let httpCalls=0,usage={};
const fetcher=async(url,options)=>{
  if(String(url)==='https://router-audit.invalid/auth/v1/user') return Response.json({id:'audit-owner',role:'authenticated'});
  httpCalls++;
  const response=await fetch(url,options);
  if(response.ok) {
    const data=await response.clone().json().catch(()=>null);
    for(const key of ['prompt_tokens','completion_tokens','total_tokens']) if(Number.isSafeInteger(data?.usage?.[key]))usage[key]=data.usage[key];
  }
  return response;
};
const api=createApi({catalog:async()=>products,fetcher});
const initial=()=>({state:singleInitial(),issues:[]});
async function send(text,session,instance=api) {
  const body={operation:'turn',text,session:structuredClone(session),history:[],source:'typed'};
  const response=await instance.fetch(new Request('http://audit.local/api/chat',{method:'POST',headers:{Authorization:'Bearer synthetic-audit-token','Content-Type':'application/json',Origin:'http://localhost:8766'},body:JSON.stringify(body)}),env);
  return {status:response.status,data:await response.json()};
}
const results=[];
async function check(id,label,fn) {
  const started=Date.now();const before=httpCalls;
  try {
    const details=await fn();
    results.push({id,label,ok:true,latencyMs:Date.now()-started,httpLlmCalls:httpCalls-before,...details});
  } catch(error) {
    results.push({id,label,ok:false,latencyMs:Date.now()-started,httpLlmCalls:httpCalls-before,code:error?.code==='ERR_ASSERTION'?'assertion_failed':'request_failed'});
  }
}
let ready;
await check('rules','명확한 조건을 규칙으로 처리',async()=>{
  const {status,data}=await send('엄마 예산 5만원 배송비 포함',initial());
  assert.equal(status,200);assert.equal(data.mode,'rules');assert.equal(data.routing.llmCalls,0);assert.equal(data.session.state.budget.amount_krw,50000);assert.deepEqual(data.session.state.recipients,['어머니']);assert.equal(data.question.key,null);assert.equal(data.view.result.items[0].id,'tea');
  ready=data.session;return {routing:data.routing,topProduct:'tea'};
});
await check('exclusions','선호·제외 조건 반영',async()=>{
  assert.ok(ready);
  const preferred=await send('차 좋아해',ready);assert.equal(preferred.status,200);
  const excluded=await send('견과류는 빼줘',preferred.data.session);assert.equal(excluded.status,200);
  assert.deepEqual(excluded.data.session.state.preferences,['category:coffee_tea']);assert.deepEqual(excluded.data.session.state.excluded_ingredients,['견과류']);assert.ok(excluded.data.view.result.items.every(p=>!p.allergens_declared.includes('견과류')));
  ready=excluded.data.session;return {routing:excluded.data.routing,excludedIngredients:['견과류']};
});
await check('explain','추천 이유를 엔진 사실로 설명',async()=>{
  const {status,data}=await send('왜 추천했어?',ready);
  assert.equal(status,200);assert.equal(data.routing.intent,'explain');assert.equal(data.routing.llmCalls,0);assert.match(data.message,/33,000/);assert.match(data.message,/선호 점수/);assert.deepEqual(data.session,ready);
  return {routing:data.routing};
});
await check('what_if','예산 가정 비교가 현재 상태를 바꾸지 않음',async()=>{
  const {status,data}=await send('예산 7만원이면?',ready);
  assert.equal(status,200);assert.equal(data.routing.intent,'compare_budget');assert.equal(data.routing.llmCalls,0);assert.match(data.message,/고급 차 세트/);assert.deepEqual(data.session,ready);assert.equal(data.view.result.items[0].id,'tea');
  return {routing:data.routing,currentBudget:50000,hypotheticalBudget:70000};
});
await check('apply_budget','명시적 요청 후에만 예산 변경',async()=>{
  const {status,data}=await send('예산 7만원으로 바꿔줘',ready);
  assert.equal(status,200);assert.equal(data.session.state.budget.amount_krw,70000);assert.equal(data.view.result.items[0].id,'premium');assert.equal(ready.state.budget.amount_krw,50000);
  return {routing:data.routing,appliedBudget:70000};
});
await check('conflict','충돌 예산은 질문하고 기존 조건 보존',async()=>{
  const {status,data}=await send('예산 5만원 이하 최소 7만원',ready);
  assert.equal(status,200);assert.equal(data.question.key,'issue');assert.equal(data.routing.llmCalls,0);assert.deepEqual(data.session.state,ready.state);
  return {routing:data.routing};
});
await check('recipient','수령인 변경 시 이전 선호·제외 분리',async()=>{
  const {status,data}=await send('친구 예산 4만원 배송비 포함',ready);
  assert.equal(status,200);assert.deepEqual(data.session.state.recipients,['친구']);assert.deepEqual(data.session.state.preferences,[]);assert.deepEqual(data.session.state.excluded_ingredients,[]);
  return {routing:data.routing};
});
await check('allergy_question','미확정 알레르기는 비교·추천보다 확인 우선',async()=>{
  const pending=await send('알레르기가 있어요',ready);assert.equal(pending.status,200);assert.match(pending.data.question.text,/성분/);
  const blocked=await send('예산 7만원이면?',pending.data.session);assert.equal(blocked.status,200);assert.equal(blocked.data.question.key,'issue');assert.match(blocked.data.message,/성분/);assert.equal(blocked.data.routing.llmCalls,0);
  return {routing:blocked.data.routing};
});
await check('real_llm','미해석 자유 발화를 실제 선택한 LLM으로 보완',async()=>{
  assert.ok(local.LLM_API_KEY||local.GEMINI_API_KEY);
  const {status,data}=await send('받는 분은 커피보다 차를 즐기고, 우유가 들어간 음식은 피하고 싶대요. 지금 정한 예산과 배송비 조건은 그대로 해주세요.',ready);
  assert.equal(status,200);assert.equal(data.mode,'llm');assert.equal(data.routing.llmCalls,1);assert.equal(data.llmModel,local.LLM_MODEL||local.GEMINI_MODEL);assert.ok(data.session.state.preferences.includes('category:coffee_tea'));assert.ok(data.session.state.excluded_ingredients.includes('우유'));assert.ok(data.session.state.excluded_ingredients.includes('견과류'));assert.equal(data.session.state.budget.amount_krw,50000);assert.equal(data.session.state.budget.shipping_included,true);assert.equal(data.question.key,null);
  return {routing:data.routing,model:data.llmModel,usage:{...usage},budget:50000};
});
await check('provider_failure','모의 공급자 오류가 503이며 변경 상태를 반환하지 않음',async()=>{
  const failing=createApi({catalog:async()=>products,fetcher:async url=>String(url)==='https://router-audit.invalid/auth/v1/user'?Response.json({id:'audit-owner',role:'authenticated'}):new Response('synthetic provider error',{status:401})});
  const {status,data}=await send('센스 있는 선물',ready,failing);assert.equal(status,503);assert.ok(!('session' in data));
  return {simulated:true,status};
});
const report={generatedAt:new Date().toISOString(),timezone:'Asia/Seoul',agent:'a-router',model:local.LLM_MODEL||local.GEMINI_MODEL,scope:'Synthetic sessions/catalog and mocked auth through the actual Worker handler; real configured LLM for one case; no browser UI or real Supabase auth exercised.',passed:results.filter(r=>r.ok).length,total:results.length,ok:results.every(r=>r.ok),realLlmHttpCalls:httpCalls,results};
console.log(JSON.stringify(report,null,2));
const outputArg=process.argv.find(arg=>arg.startsWith('--output='));
if(outputArg) {const path=outputArg.slice(9);await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(report,null,2)+'\n');}
if(!report.ok)process.exitCode=1;
