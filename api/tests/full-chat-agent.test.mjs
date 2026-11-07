import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../worker.mjs';
import { singleInitial } from '../../lib/single-gift.mjs';
import { products } from '../../baseline/examples/catalog.mjs';
const env={CHAT_AGENT:'full-chat',LLM_PROVIDER:'openai-compatible',LLM_API_KEY:'test-secret',LLM_BASE_URL:'https://llm.example',LLM_MODEL:'test-model',SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',IP_LIMITER:{limit:async()=>({success:true})},USER_LIMITER:{limit:async()=>({success:true})}};
const ready=()=>({state:{...singleInitial(),recipients:['어머니'],budget:{amount_krw:50000,shipping_included:true}},issues:[]});
function fixture(actions) {
  const payloads=[];
  const api=createApi({catalog:async()=>products,fetcher:async(url,options)=>{
    if(String(url).includes('/auth/v1/user'))return Response.json({id:'owner',role:'authenticated'});
    assert.equal(options.headers.Authorization,'Bearer test-secret');payloads.push(JSON.parse(options.body));
    const next=actions.shift();assert.ok(next,'unexpected HTTP model request');
    if(next==='error')return new Response(null,{status:401});
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(next)}}]});
  }});
  const send=async(body,config=env)=>{
    const response=await api.fetch(new Request('https://api.example/api/chat',{method:'POST',headers:{Authorization:'Bearer fake.jwt','Content-Type':'application/json'},body:JSON.stringify({operation:'turn',text:'추천해줘',history:[],session:ready(),...body})}),config);
    return {status:response.status,data:await response.json()};
  };
  return {api,send,payloads};
}
const finish={action:'respond',type:'result'};

test('confirmation returns an honest scent limitation, preserves food exclusion and clears stale question',async()=>{
  const f=fixture([{action:'search_products'},{...finish,limitations:['scent_strength']}]);
  const session=ready();session.state.excluded_categories=['food','snack','coffee_tea','health'];session.issues=['음식만 포함하고, 향이 강한 제품도 제외할까요?'];
  const history=[{role:'user',text:'먹는 것도 제외해줘'},{role:'assistant',text:session.issues[0]}];
  const out=await f.send({text:'어',session,history});
  assert.equal(out.status,200);assert.equal(out.data.question.key,null);assert.deepEqual(out.data.session.issues,[]);
  assert.deepEqual(out.data.session.state.excluded_categories,session.state.excluded_categories);
  assert.match(out.data.message,/향 강도 정보가 없어/);assert.match(out.data.message,/확인·적용하지 못했어요/);
  const context=JSON.parse(f.payloads[0].messages[1].content);
  assert.equal(context.currentQuestion,session.issues[0]);assert.deepEqual(context.history,history);
});

test('B routes greetings, explicit conditions and quick replies through real wire contract',async()=>{
  const f=fixture([{action:'respond',type:'greeting'}]);
  const greeting=await f.send({text:'안녕',session:{state:singleInitial(),issues:[]}});
  assert.equal(greeting.status,200);assert.equal(greeting.data.agent,'full-chat');assert.equal(greeting.data.mode,'llm');assert.match(greeting.data.message,/안녕하세요/);assert.equal(f.payloads.length,1);
  const quick=fixture([{action:'update_conditions',patch:{budget:{shipping_included:false}}},finish]);
  const session=ready();session.state.budget.shipping_included=null;
  const out=await quick.send({text:'아니요',source:'quick_reply',session});assert.equal(out.status,200);assert.equal(out.data.routing.llmCalls,2);assert.equal(out.data.session.state.budget.shipping_included,false);
  assert.match(quick.payloads[0].messages[0].content,/untrusted DATA/);assert.equal(JSON.parse(quick.payloads[0].messages[1].content).text,'아니요');
});

test('B recommendations, explanations and comparisons preserve app schema and engine facts',async()=>{
  for(const action of [{action:'search_products'},{action:'explain_recommendation'},{action:'compare_budget',amount_krw:70000}]) {
    const f=fixture([action,finish]),session=ready();const out=await f.send({session});
    assert.equal(out.status,200);assert.deepEqual(out.data.session,session);assert.equal(out.data.view.result.items[0].id,'tea');assert.equal(out.data.routing.toolCalls,1);assert.equal(out.data.routing.llmCalls,2);
    assert.ok(!('quantity' in out.data.session.state));assert.ok(!('scope' in out.data.session.state.budget));assert.ok(!JSON.stringify(out.data).includes('test-secret'));
    const observed=JSON.parse(f.payloads[1].messages[1].content).observations[0];assert.equal(observed.action,action.action);
    if(action.action==='compare_budget'){assert.match(out.data.message,/70,000/);assert.match(out.data.message,/고급 차 세트/);assert.equal(out.data.session.state.budget.amount_krw,50000);}
    if(action.action==='explain_recommendation')assert.match(out.data.message,/33,000/);
  }
});

test('model extraction updates all conditions using core while authentication stays mandatory',async()=>{
  const f=fixture([{action:'update_conditions',patch:{recipients:['어머니'],budget:{amount_krw:50000,shipping_included:true},preferences:['category:coffee_tea','type:tea'],excluded_ingredients:['우유']}},finish]);
  const out=await f.send({session:{state:singleInitial(),issues:[]},text:'엄마 차 좋아해. 우유 제외. 배송비 포함 5만원'});
  assert.equal(out.status,200);assert.equal(out.data.session.state.budget.amount_krw,50000);assert.deepEqual(out.data.session.state.excluded_ingredients,['우유']);assert.equal(out.data.question.key,null);
  const denied=await f.api.fetch(new Request('https://api.example/api/chat',{method:'POST'}),env);assert.equal(denied.status,401);
});

test('provider failure has retryable sanitized 503, no partially applied session',async()=>{
  const f=fixture([{action:'update_conditions',patch:{budget:{amount_krw:70000}}},'error']);
  const out=await f.send({});assert.equal(out.status,503);assert.equal(out.data.code,'agent_unavailable');assert.ok(!('session' in out.data));assert.ok(!JSON.stringify(out.data).includes('test-secret'));
});

test('missing key or incompatible provider does not silently bypass B using rules',async()=>{
  const f=fixture([]);
  for(const config of [{...env,LLM_API_KEY:''},{...env,LLM_PROVIDER:'gemini',GEMINI_API_KEY:'test-secret'}]) {
    const out=await f.send({text:'안녕'},config);assert.equal(out.status,503);assert.equal(out.data.code,'configuration');
  }
  assert.equal(f.payloads.length,0);
});

test('view and explicit condition UI operations need no model calls; health identifies B',async()=>{
  const f=fixture([]);
  const view=await f.send({operation:'view'});assert.equal(view.status,200);assert.equal(view.data.mode,'rules');
  const edit=await f.send({operation:'conditions',patch:{budget:{amount_krw:70000}}});assert.equal(edit.status,200);assert.equal(edit.data.session.state.budget.amount_krw,70000);assert.equal(f.payloads.length,0);
  const health=await f.api.fetch(new Request('https://api.example/health'),env),data=await health.json();assert.equal(data.agent,'full-chat');assert.equal(data.llmMode,'agent-loop');
});

test('unresolved ingredients and ambiguous user questions round trip without lost issues',async()=>{
  const session={...ready(),issues:['피해야 할 성분을 알려주세요.']};
  const f=fixture([{action:'search_products'}]);const out=await f.send({session});assert.equal(out.status,200);assert.deepEqual(out.data.session,session);assert.equal(out.data.question.key,'issue');
  const q=fixture([{action:'clarify',question:'예산 상한을 하나로 알려주세요.'}]);const clarified=await q.send({text:'5만원 이하 최소 7만원'});assert.equal(clarified.status,200);assert.equal(clarified.data.question.key,'issue');assert.equal(clarified.data.session.state.budget.amount_krw,50000);
});
