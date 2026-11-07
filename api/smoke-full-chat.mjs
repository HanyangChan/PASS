// Real model through /api/chat handler; synthetic sessions/catalog and stub auth only.
import assert from 'node:assert/strict';
import { loadLocalEnv } from './local-env.mjs';
import { createApi } from './worker.mjs';
import { singleInitial } from '../lib/single-gift.mjs';
import { products } from '../baseline/examples/catalog.mjs';

const results=[];
try {
  const local=await loadLocalEnv();
  const config={...local,CHAT_AGENT:'full-chat',SUPABASE_URL:'https://synthetic.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic',IP_LIMITER:{limit:async()=>({success:true})},USER_LIMITER:{limit:async()=>({success:true})}};
  if(config.LLM_PROVIDER!=='openai-compatible'||!config.LLM_API_KEY)throw Object.assign(Error(),{code:'configuration'});
  let decisions=[];
  const api=createApi({catalog:async()=>products,fetcher:async(url,options)=>{
    if(String(url).includes('/auth/v1/user'))return Response.json({id:'synthetic-owner',role:'authenticated'});
    const response=await fetch(url,options);
    // Only structured decisions for these fixed synthetic prompts; never log keys or private reasoning.
    try {decisions.push(JSON.parse((await response.clone().json()).choices[0].message.content));} catch {}
    return response;
  }});
  const initial=()=>({state:singleInitial(),issues:[]});
  const ready=()=>({state:{...singleInitial(),recipients:['어머니'],budget:{amount_krw:50000,shipping_included:true}},issues:[]});
  const scenarios=[
    {id:'greeting',session:initial(),text:'안녕',check:d=>{assert.match(d.message,/안녕하세요/);assert.equal(d.routing.llmCalls,1);assert.equal(d.routing.toolCalls,0);}},
    {id:'conditions',session:initial(),text:'엄마 선물 하나 골라줘. 차를 좋아하시고 우유는 제외해줘. 예산은 배송비 포함 5만원이야.',check:d=>{assert.equal(d.session.state.budget.amount_krw,50000);assert.equal(d.session.state.budget.shipping_included,true);assert.ok(d.session.state.preferences.includes('type:tea'));assert.ok(d.session.state.excluded_ingredients.includes('우유'));assert.equal(d.question.key,null);}},
    {id:'explain',session:ready(),text:'왜 추천했어?',check:d=>{assert.match(d.message,/33,000/);assert.equal(d.routing.intent,'explain');}},
    {id:'compare',session:ready(),text:'예산 7만원이면?',check:d=>{assert.equal(d.session.state.budget.amount_krw,50000);assert.match(d.message,/70,000/);assert.match(d.message,/고급 차 세트/);assert.equal(d.routing.intent,'compare_budget');}},
    {id:'quick_reply',session:{...ready(),state:{...ready().state,budget:{amount_krw:50000,shipping_included:null}}},text:'아니요',source:'quick_reply',check:d=>assert.equal(d.session.state.budget.shipping_included,false)},
    {id:'conflict',session:ready(),text:'예산 5만원 이하로 해줘. 최소 7만원은 써야 해.',check:d=>{assert.equal(d.session.state.budget.amount_krw,50000);assert.equal(d.question.key,'issue');}},
  ];
  for(const scenario of scenarios) {
    decisions=[];
    const started=Date.now();
    const response=await api.fetch(new Request('https://api.example/api/chat',{method:'POST',headers:{Authorization:'Bearer synthetic.jwt','Content-Type':'application/json'},body:JSON.stringify({operation:'turn',session:scenario.session,text:scenario.text,source:scenario.source??'typed',history:[]})}),config);
    const data=await response.json();
    let ok=false,code;
    try {assert.equal(response.status,200);assert.equal(data.agent,'full-chat');assert.equal(data.mode,'llm');scenario.check(data);ok=true;} catch {code=data.code??'assertion_failed';}
    const result={id:scenario.id,ok,status:response.status,latencyMs:Date.now()-started,...(code?{code,decisions}:{}),routing:data.routing};
    results.push(result);console.log(JSON.stringify(result));
  }
  if(results.some(r=>!r.ok))process.exitCode=1;
  console.log(JSON.stringify({ok:results.every(r=>r.ok),model:config.LLM_MODEL,scenarios:results.length,scope:'real provider; synthetic catalog/session/auth; no browser or live Supabase verification'}));
} catch(error) {
  console.error(JSON.stringify({ok:false,code:error?.code??'request_failed'}));process.exitCode=1;
}
