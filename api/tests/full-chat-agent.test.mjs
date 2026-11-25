import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../worker.mjs';
import { prototypeFullChatTurn } from '../full-chat-agent.mjs';
import { recoverEmptyRecommendation } from '../c-empty-recovery.mjs';
import { APP_RANKING, recommend } from '../../lib/engine.mjs';
import { singleInitial } from '../../lib/single-gift.mjs';
import { products } from '../../baseline/examples/catalog.mjs';
const env={CHAT_AGENT:'full-chat',LLM_PROVIDER:'openai-compatible',LLM_API_KEY:'test-secret',LLM_BASE_URL:'https://llm.example',LLM_MODEL:'test-model',SUPABASE_URL:'https://test.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',IP_LIMITER:{limit:async()=>({success:true})},USER_LIMITER:{limit:async()=>({success:true})}};
const ready=()=>({state:{...singleInitial(),recipients:['어머니'],budget:{amount_krw:50000,shipping_included:true}},issues:[]});
function fixture(actions, catalog=products, auditReplies=[]) {
  const payloads=[];
  const auditPayloads=[];
  const api=createApi({catalog:async()=>catalog,fetcher:async(url,options)=>{
    if(String(url).includes('/auth/v1/user'))return Response.json({id:'owner',role:'authenticated'});
    assert.equal(options.headers.Authorization,'Bearer test-secret');
    const payload=JSON.parse(options.body);
    if(/You independently review/.test(payload.messages[0].content)) {
      auditPayloads.push(payload);
      const content=JSON.stringify(auditReplies.shift()??{flags:[]});
      return Response.json({choices:[{finish_reason:'stop',message:{content}}]});
    }
    payloads.push(payload);
    const next=actions.shift();assert.ok(next,'unexpected HTTP model request');
    if(next==='error')return new Response(null,{status:401});
    if(next==='unavailable')return new Response(null,{status:503});
    return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(next)}}]});
  }});
  const send=async(body,config=env)=>{
    const response=await api.fetch(new Request('https://api.example/api/chat',{method:'POST',headers:{Authorization:'Bearer fake.jwt','Content-Type':'application/json'},body:JSON.stringify({operation:'turn',text:'추천해줘',history:[],session:ready(),...body})}),config);
    return {status:response.status,data:await response.json()};
  };
  return {api,send,payloads,auditPayloads};
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
  const out=await quick.send({text:'아니요',source:'quick_reply',session});assert.equal(out.status,200);assert.equal(out.data.routing.llmCalls,1);assert.equal(out.data.session.state.budget.shipping_included,false);
  assert.match(quick.payloads[0].messages[0].content,/untrusted DATA/);assert.equal(JSON.parse(quick.payloads[0].messages[1].content).text,'아니요');
});

test('B recommendations, explanations and comparisons preserve app schema and engine facts',async()=>{
  for(const action of [{action:'search_products'},{action:'explain_recommendation'},{action:'compare_budget',amount_krw:70000}]) {
    const f=fixture([action,finish]),session=ready();const out=await f.send({session});
    assert.equal(out.status,200);assert.deepEqual(out.data.session,session);assert.equal(out.data.view.result.items[0].id,'tea');assert.equal(out.data.routing.toolCalls,1);assert.equal(out.data.routing.llmCalls,1);
    assert.ok(!('quantity' in out.data.session.state));assert.ok(!('scope' in out.data.session.state.budget));assert.ok(!JSON.stringify(out.data).includes('test-secret'));
    assert.equal(f.payloads.length,1);assert.equal(out.data.routing.steps[0].action,action.action);
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

test('B/C recover malformed actions once and keep the state on persistent provider failures',async()=>{
  const session=ready();
  session.state.excluded_ingredients=['우유'];
  for(const agentMode of ['full-chat','full-chat-feedback-2']) {
    const recovered=fixture([{action:'invent_product'},{action:'search_products'}]);
    const result=await recovered.send({session,agentMode});
    assert.equal(result.status,200);
    assert.equal(result.data.view.result.items[0].id,'tea');
    assert.match(recovered.payloads[1].messages[1].content,/previous decision was not valid JSON/);

    const failed=fixture(['error']);
    const out=await failed.send({session,agentMode});
    assert.equal(out.status,200);
    assert.equal(out.data.agent,agentMode);
    assert.equal(out.data.routing.stopReason,'auth_failed');
    assert.deepEqual(out.data.session,session);
    assert.deepEqual(out.data.view.result.items,[]);
    assert.ok(!JSON.stringify(out.data).includes('test-secret'));

    const exhausted=fixture(['unavailable','unavailable']);
    const retry=await exhausted.send({session,agentMode});
    assert.equal(retry.status,200);
    assert.equal(retry.data.routing.stopReason,'provider_unavailable');
    assert.deepEqual(retry.data.session,session);
    assert.deepEqual(retry.data.view.result.items,[]);
    assert.equal(exhausted.payloads.length,2);

    const invalidPatch={action:'update_conditions',patch:{quantity:2}};
    const pass={verdict:'pass',issues:[],feedback:''};
    const invalid=fixture(agentMode==='full-chat'?[invalidPatch,invalidPatch]:[invalidPatch,pass,invalidPatch,pass]);
    const rejected=await invalid.send({session,agentMode});
    assert.equal(rejected.status,200);
    assert.equal(rejected.data.routing.stopReason,'invalid_input');
    assert.deepEqual(rejected.data.session,session);
  }
});

test('B/C stop explicitly with no model calls, and can resume in the same session',async()=>{
  const session={...ready(),issues:['피해야 할 성분을 알려주세요.']};
  for(const agentMode of ['full-chat','full-chat-feedback-2']) {
    const f=fixture([{action:'search_products'}]);
    const out=await f.send({text:'고마워요, 여기까지만 할게요.',session,agentMode});
    assert.equal(out.status,200);
    assert.equal(out.data.routing.stopReason,'user_stop');
    assert.deepEqual(out.data.session,session);
    assert.equal(out.data.view.question.key,null);
    assert.deepEqual(out.data.view.result.items,[]);
    assert.equal(f.payloads.length,0);
    const next=await f.send({text:'추천해줘',session:out.data.session,agentMode});
    assert.equal(next.data.question.key,'issue');
    assert.deepEqual(next.data.view.result.items,[]);
    assert.equal(f.payloads.length,1);
    const offline=await f.send({text:'그만 추천해줘',session,agentMode},{...env,LLM_API_KEY:''});
    assert.equal(offline.status,200);
    assert.equal(offline.data.routing.stopReason,'user_stop');
    assert.equal(f.payloads.length,1);
  }
});

test('cancelling a B/C request aborts the provider without recording an HTTP failure',async()=>{
  for(const agentMode of ['full-chat','full-chat-feedback-2']) {
    const controller=new AbortController();
    const diagnostics=[];
    let seenAbort=false;
    let start;
    const started=new Promise(resolve=>{start=resolve;});
    const api=createApi({catalog:async()=>products,onDiagnostic:event=>diagnostics.push(event),fetcher:async(url,options)=>{
      if(String(url).includes('/auth/v1/user'))return Response.json({id:'owner',role:'authenticated'});
      start();
      await new Promise((_,reject)=>options.signal.addEventListener('abort',()=>{
        seenAbort=true;
        reject(new DOMException('request aborted','AbortError'));
      },{once:true}));
    }});
    const response=api.fetch(new Request('https://api.example/api/chat',{method:'POST',signal:controller.signal,
      headers:{Authorization:'Bearer fake.jwt','Content-Type':'application/json'},
      body:JSON.stringify({operation:'turn',text:'추천해줘',history:[],session:ready(),agentMode})}),env);
    await started;
    controller.abort();
    assert.equal((await response).status,204);
    assert.equal(seenAbort,true);
    assert.deepEqual(diagnostics,[]);
  }
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

test('B/C ask about an unknown ingredient before calling the model or showing cards',async()=>{
  for(const agentMode of ['full-chat','full-chat-feedback-2']) {
    const f=fixture([]);
    const first=await f.send({agentMode,text:'알레르기가 있는데 어떤 성분인지는 아직 몰라요. 간식 골라줘.'});
    assert.equal(first.status,200);
    assert.equal(first.data.routing.stopReason,'missing_ingredient');
    assert.match(first.data.question.text,/성분/);
    assert.deepEqual(first.data.view.result.items,[]);
    assert.equal(f.payloads.length,0);
  }
});

test('an unrelated reply or partial ingredient patch cannot unblock B/C recommendations',async()=>{
  const session={...ready(),issues:['예산을 다시 알려주세요.','피해야 할 알레르기 성분을 알려주세요.']};
  const patch={action:'update_conditions',patch:{excluded_ingredients:['우유']}};
  const pass={verdict:'pass',issues:[],feedback:''};
  for(const agentMode of ['full-chat','full-chat-feedback-2']) {
    for(const text of ['배송비 포함으로 바꿔줘','우유랑 땅콩이요']) {
      const f=fixture(agentMode==='full-chat'?[patch]:[patch,pass]);
      const out=await f.send({agentMode,session,text});
      assert.match(out.data.question.text,/성분/);
      assert.deepEqual(out.data.session.state.excluded_ingredients,[]);
      assert.deepEqual(out.data.view.result.items,[]);
    }
  }
});

test('B/C search one identified product and keep budget and ingredient exclusions',async()=>{
  for(const agentMode of ['full-chat','full-chat-feedback-2']) {
    const f=fixture(Array.from({length:4},()=>({action:'search_products'})));
    const exact=await f.send({agentMode,text:'"차 선물 세트"를 찾아줘.'});
    assert.deepEqual(exact.data.view.result.items.map(item=>item.id),['tea']);
    const expensive=await f.send({agentMode,text:'"고급 차 세트"를 찾아줘.'});
    assert.deepEqual(expensive.data.view.result.items,[]);
    const session=ready();
    session.state.excluded_ingredients=['견과류'];
    const excluded=await f.send({agentMode,text:'"견과 간식 세트"를 찾아줘.',session});
    assert.deepEqual(excluded.data.view.result.items,[]);
    const missing=await f.send({agentMode,text:'ASIN B0ZZZZZZ99 찾아줘.'});
    assert.deepEqual(missing.data.view.result.items,[]);
    assert.match(missing.data.message,/찾지 못했어요/);
    assert.equal(missing.data.routing.stopReason,'product_not_found');
    assert.equal(missing.data.question.key,'issue');
  }
});

test('B/C ask for a single-gift budget before shopping for an unsupported combined quantity',async()=>{
  for(const agentMode of ['full-chat','full-chat-feedback-2']) {
    const f=fixture([]);
    const out=await f.send({agentMode,text:'같은 제품 두 개가 필요해요. 두 개 합쳐 배송비까지 5만원이에요.'});
    assert.equal(out.data.routing.stopReason,'unsupported_quantity');
    assert.match(out.data.message,/선물 하나 기준/);
    assert.deepEqual(out.data.view.result.items,[]);
    assert.equal(f.payloads.length,0);
  }
});

test('B resolves a separated model number, narrows variants, and asks instead of substituting on a miss',async()=>{
  const white={...products[0],id:'amz-B01BKEZYBY',name:"SWISSTYLE Analog White Dial Women's Watch-SS-703W-703B",category:'watch'};
  const black={...white,id:'amz-B01BKEZYBZ',name:"SWISSTYLE Analog Black Dial Women's Watch-SS-703W-703B"};
  const f=fixture(Array.from({length:4},()=>({action:'search_products'})),[...products,white,black]);
  const exact=await f.send({text:'SWISSTYLE SS-703W-703B 흰색 다이얼 시계 제품이 있으면 보여줘.'});
  assert.deepEqual(exact.data.view.result.items.map(item=>item.id),[white.id]);
  const asin=await f.send({text:'ASIN B01BKEZYBZ 상품을 찾아줘.'});
  assert.deepEqual(asin.data.view.result.items.map(item=>item.id),[black.id]);
  const ambiguous=await f.send({text:'SWISSTYLE SS-703W-703B 시계와 같은 모델을 찾아주세요.'});
  assert.equal(ambiguous.data.routing.stopReason,'ambiguous_product');
  assert.deepEqual(ambiguous.data.view.result.items,[]);
  assert.deepEqual(ambiguous.data.view.candidateItems.map(item=>item.id),[white.id,black.id]);
  const missing=await f.send({text:'카탈로그에서 Acme Lunar Series 상품을 찾아주세요.'});
  assert.equal(missing.data.routing.stopReason,'product_not_found');
  assert.deepEqual(missing.data.view.result.items,[]);
});

test('B/C preview eligible name variants and confirm the selected ASIN',async()=>{
  const variants=[
    ['B000000001','Blue',29000],['B000000002','Grey',25000],['B000000003','Red',27000],
    ['B000000004','Green',28000],['B000000005','Black',150000],
  ].map(([asin,color,price_krw])=>({...products[0],id:`amz-${asin}`,
    name:`North Ridge Travel Mug, ${color}`,price_krw,category:'kitchen'}));
  for(const agentMode of ['full-chat','full-chat-feedback-2']) {
    const f=fixture([],variants);
    const query='"North Ridge Travel Mug" 제품을 찾아주세요.';
    const preview=await f.send({agentMode,text:query});
    assert.equal(preview.data.question.key,'issue');
    assert.deepEqual(preview.data.view.result.items,[]);
    assert.deepEqual(preview.data.view.candidateItems.map(item=>item.id),
      [variants[2].id,variants[0].id,variants[1].id]);
    const chosen=await f.send({agentMode,text:'ASIN B000000002 찾아줘',session:preview.data.session});
    assert.equal(chosen.data.question.key,null);
    assert.deepEqual(chosen.data.view.result.items.map(item=>item.id),[variants[1].id]);
    assert.equal(chosen.data.view.candidateItems,undefined);
    const session=ready();
    session.state.excluded_ingredients=['우유'];
    const conservative=await f.send({agentMode,text:query,session});
    assert.equal(conservative.data.view.candidateItems,undefined);
  }
});

test('B uses explicit shopping conditions when a model asks for optional recipient details',async()=>{
  const watch={...products[0],id:'watch',name:'손목시계',category:'watch',price_krw:21000};
  const f=fixture([{action:'clarify',question:'선물 받는 분은 남성, 여성 중 어느 쪽인가요?'}],[...products,watch]);
  const out=await f.send({
    text:'택배비까지 내고 3만 원 안에 사려고 합니다. 연인에게 줄 만한 손목시계가 있을까요?',
    session:{state:singleInitial(),issues:[]},
  });
  assert.equal(out.status,200);
  assert.equal(out.data.question.key,null);
  assert.deepEqual(out.data.session.state.recipients,['연인']);
  assert.deepEqual(out.data.session.state.budget,{amount_krw:30000,shipping_included:true});
  assert.deepEqual(out.data.view.result.items.map(item=>item.id),['watch']);
  assert.equal(f.payloads.length,1);
  const timings=out.data.routing.timings;
  for(const key of ['lookupMs','modelMs','rankingMs','responseMs']) assert.ok(Number.isFinite(timings[key])&&timings[key]>=0);
  assert.equal(timings.recommendationRuns,1);
});

test('B carries a digital category through a delivery change despite a conflicting model category',async()=>{
  const audio={...products[0],id:'audio',name:'휴대용 스피커',category:'audio',rating_count:1000};
  const digital={...products[0],id:'digital',name:'디지털 카메라',category:'digital'};
  const f=fixture([
    {action:'update_conditions',patch:{preferences:['category:audio']}},
    {action:'update_conditions',patch:{delivery_by:'2026-12-06'}},
  ],[...products,audio,digital]);
  const first=await f.send({text:'친구에게 줄 디지털기기 선물을 찾습니다. 배송비 포함 8만 원 한도로 골라주세요.'});
  assert.deepEqual(first.data.session.state.preferences,['category:digital']);
  assert.deepEqual(first.data.view.result.items.map(item=>item.id),['digital']);
  const second=await f.send({text:'나머지 조건은 그대로 두고 2026년 12월 3일까지 도착할 상품으로 변경해 주세요.',session:first.data.session});
  assert.equal(second.data.session.state.delivery_by,'2026-12-03');
  assert.deepEqual(second.data.session.state.preferences,['category:digital']);
  assert.deepEqual(second.data.view.result.items.map(item=>item.id),['digital']);
});

test('B replaces the prior category and preserves cost and exclusions on a category-only change',async()=>{
  const jewelry={...products[0],id:'jewelry',name:'은 목걸이',category:'jewelry',rating_count:1000};
  const snack={...products[0],id:'snack-safe',name:'쌀 과자',category:'snack'};
  const f=fixture([
    {action:'update_conditions',patch:{preferences:['category:snack']}},
    {action:'update_conditions',patch:{preferences:['category:jewelry'],budget:{amount_krw:90000,shipping_included:false},excluded_categories:[]}},
  ],[jewelry,snack]);
  const session=ready();
  session.state.preferences=['category:jewelry','avoid_fragrance'];
  session.state.excluded_categories=['kitchen'];
  session.state.excluded_ingredients=['우유'];

  for(const recipient of ['어머니','친구']) {
    const current={...session,state:{...session.state,recipients:[recipient]}};
    const out=await f.send({session:current,text:'처음 찾던 주얼리 대신 간식으로 바꿔 줘. 배송 포함 예산은 그대로야.'});
    assert.equal(out.status,200);
    assert.deepEqual(out.data.session.state,{...current.state,preferences:['avoid_fragrance','category:snack']});
    assert.deepEqual(out.data.view.result.items.map(item=>item.id),['snack-safe']);
  }
});

test('B switches to fashion accessories and applies the explicitly changed shipping-inclusive cap',async()=>{
  const accessory={...products[0],id:'accessory',name:'가죽 지갑',category:'accessory',price_krw:36000};
  const tooExpensive={...accessory,id:'over-cap',price_krw:39000};
  const kitchen={...products[0],id:'kitchen',name:'머그컵',category:'kitchen',rating_count:1000};
  const f=fixture([
    {action:'update_conditions',patch:{preferences:['category:kitchen'],budget:{amount_krw:40000}}},
  ],[accessory,tooExpensive,kitchen]);
  const session=ready();
  session.state.preferences=['category:beauty'];
  session.state.budget.shipping_included=false;
  const out=await f.send({session,text:'생각이 바뀌어서 패션소품으로 보고 싶어. 택배비를 넣어 4만 원까지만 쓸게.'});
  assert.equal(out.status,200);
  assert.deepEqual(out.data.session.state.preferences,['category:accessory']);
  assert.deepEqual(out.data.session.state.budget,{amount_krw:40000,shipping_included:true});
  assert.deepEqual(out.data.view.result.items.map(item=>item.id),['accessory']);
});

test('C locates separated product name words and still applies the price and ingredient filters',async()=>{
  const item={...products[0],id:'tote',name:"Lavie Women's Betula Medium Tote Bag",category:'bag',allergens_declared:['우유']};
  const f=fixture([],[...products,item]);
  const text='카탈로그에서 Lavie Betula Medium 여성용 토트백 상품을 찾아줄래?';
  const agentMode='full-chat-feedback-2';
  const session=ready();
  const found=await f.send({agentMode,text,session});
  assert.equal(found.status,200);
  assert.deepEqual(found.data.view.result.items.map(product=>product.id),['tote']);
  assert.equal(found.data.routing.llmCalls,2);
  assert.equal(found.data.routing.resultAudit.status,'complete');
  const excluded=await f.send({agentMode,text,session:{...session,state:{...session.state,excluded_ingredients:['우유']}}});
  assert.deepEqual(excluded.data.view.result.items,[]);
  const overCap=await f.send({agentMode,text,session:{...session,state:{...session.state,budget:{amount_krw:30000,shipping_included:true}}}});
  assert.deepEqual(overCap.data.view.result.items,[]);
  assert.equal(f.payloads.length,0);
});

test('C applies a complete recommendation request without asking for already supplied conditions',async()=>{
  const speaker={...products[0],id:'speaker',name:'휴대용 블루투스 스피커',category:'audio',price_krw:22000};
  const f=fixture([],[...products,speaker]);
  const response=await f.send({agentMode:'full-chat-feedback-2',session:{state:singleInitial(),issues:[]},
    text:'받는 사람은 연인이고 원하는 건 음향기기입니다. 배송 포함 예산은 3만 원까지예요.'});
  assert.equal(response.status,200);
  assert.deepEqual(response.data.session.state.recipients,['연인']);
  assert.deepEqual(response.data.session.state.preferences,['category:audio']);
  assert.deepEqual(response.data.session.state.budget,{amount_krw:30000,shipping_included:true});
  assert.deepEqual(response.data.view.result.items.map(product=>product.id),['speaker']);
  assert.equal(response.data.question.key,null);
  assert.equal(response.data.routing.llmCalls,2);
  assert.equal(f.auditPayloads.length,2);
  assert.equal(response.data.routing.stopReason,'verified_shopping_request');
});

test('C removes an audited color mismatch with catalog evidence and retains an unsupported flag',async()=>{
  const item={...products[0],id:'tote',name:'Lavie Black Betula Medium Tote Bag',category:'bag'};
  const text='카탈로그에서 Lavie Betula Medium 흰색 토트백을 찾아줘.';
  const agentMode='full-chat-feedback-2';
  const f=fixture([],[item],[{flags:['exact_identity']},{flags:[{id:'tote',reason:'variant_color'}]}]);
  const out=await f.send({agentMode,text});
  assert.equal(out.status,200);
  assert.deepEqual(out.data.view.result.items,[]);
  assert.equal(out.data.routing.resultAudit.removedCards,1);
  assert.deepEqual(JSON.parse(f.auditPayloads[1].messages[1].content).request_checks,['exact_identity']);
  const invalid=fixture([],[item],[{flags:[]},{flags:[{id:'tote',reason:'over_budget'}]}]);
  const kept=await invalid.send({agentMode,text});
  assert.deepEqual(kept.data.view.result.items.map(item=>item.id),['tote']);
  assert.equal(kept.data.routing.resultAudit.removedCards,0);
});

test('C explains a missing catalog category without trying another category',async()=>{
  const f=fixture([{action:'search_products'}]);
  const out=await f.send({agentMode:'full-chat-feedback-2',text:'어머니에게 줄 문구류를 추천해줘. 배송비 포함 5만 원까지.'});
  assert.equal(out.status,200);
  assert.deepEqual(out.data.routing.recovery,{outcome:'category_unavailable',attempts:0});
  assert.match(out.data.message,/요청하신 상품군이 없어요/);
  assert.deepEqual(out.data.view.result.items,[]);
  assert.deepEqual(out.data.session.state.preferences,['category:stationery']);
  assert.equal(f.auditPayloads.length,1);
});

test('C repairs an empty search once when a verified category was missed and preserves hard constraints',async()=>{
  const before={...ready().state,delivery_by:'2026-12-01',excluded_ingredients:['우유']};
  const wrong={...before,preferences:['category:stationery']};
  const good={...products[0],id:'speaker',name:'휴대용 블루투스 스피커',category:'audio'};
  const catalog=[
    good,
    {...good,id:'late',arrival_date:'2026-12-02'},
    {...good,id:'expensive',price_krw:49000},
    {...good,id:'excluded',allergens_declared:['우유']},
  ];
  const agentFactory=()=>({runTurn:async()=>({
    kind:'recommendation',session:{state:{...wrong,quantity:1,same_product:true,budget:{...wrong.budget,scope:'per_set'}}},
    routing:{agent:'full-chat-feedback-2',route:'agent',llmCalls:1,httpAttempts:1,usage:{},stopReason:'complete'},
  })});
  const fetcher=async()=>Response.json({choices:[{finish_reason:'stop',message:{content:'{"flags":[]}'}}]});
  const input={operation:'turn',text:'스피커 선물을 추천해줘.',issues:[],state:before};
  const result=await prototypeFullChatTurn(input,catalog,{agent:'full-chat-feedback-2',agentFactory,env,fetcher});
  assert.deepEqual(result.routing.recovery,{outcome:'recovered',attempts:1,reason:'category_mismatch'});
  assert.deepEqual(result.view.result.items.map(item=>item.id),[good.id]);
  assert.deepEqual(result.session.state,{...before,preferences:['category:audio']});
  const empty=await prototypeFullChatTurn(input,catalog.slice(1),{agent:'full-chat-feedback-2',agentFactory,env,fetcher});
  assert.deepEqual(empty.routing.recovery,{outcome:'still_empty',attempts:1,reason:'category_mismatch'});
  assert.deepEqual(empty.view.result.items,[]);
  assert.match(empty.message,/다시 찾아봤지만/);
});

test('C removes a newly inferred stationery subtype only for a verified broad request',()=>{
  const before=ready().state;
  const staged={...before,preferences:['category:stationery','type:writing']};
  const catalog=[{...products[0],id:'notebook',name:'A5 Hardcover Notebook',category:'stationery'}];
  const rank=(items,state)=>recommend(items,state,APP_RANKING);
  const recovered=recoverEmptyRecommendation('문구류를 추천해줘.',before,staged,catalog,rank);
  assert.equal(recovered.reason,'inferred_type_filter');
  assert.deepEqual(recovered.state.preferences,['category:stationery']);
  assert.deepEqual(recovered.result.items.map(item=>item.id),['notebook']);
  assert.equal(recoverEmptyRecommendation('볼펜 같은 문구류를 추천해줘.',before,staged,catalog,rank).attempts,0);
  assert.equal(recoverEmptyRecommendation('문구류를 추천해줘.',staged,staged,catalog,rank).attempts,0);
});
