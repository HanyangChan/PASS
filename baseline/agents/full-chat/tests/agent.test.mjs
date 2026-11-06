import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgent, FullChatError, validAction } from '../index.mjs';
import { createSession } from '../../../src/index.mjs';
import { products } from '../../../examples/catalog.mjs';
const ready=()=>({...createSession('test'),state:{...createSession('test').state,recipients:['어머니'],quantity:1,same_product:true,budget:{amount_krw:50000,shipping_included:true,scope:'per_set'}}});
const sequence=(actions,seen=[])=>async input=>{seen.push(structuredClone(input));assert.ok(actions.length,'unexpected model call');return actions.shift();};
const run=(agent,session=ready(),extra={})=>agent.runTurn({session,products,request:{kind:'message',expectedVersion:session.version,text:'추천해줘'},...extra});
const finish={action:'respond',type:'result'};

test('every message, including greetings and quick-reply yes, goes to model first',async()=>{
  const seen=[];
  const out=await run(createAgent({decide:sequence([{action:'respond',type:'greeting'}],seen)}),createSession('empty'),{request:{kind:'message',expectedVersion:0,text:'안녕'}});
  assert.equal(out.kind,'conversation');assert.equal(out.routing.llmCalls,1);assert.equal(out.routing.toolCalls,0);assert.equal(seen[0].text,'안녕');
  const session=ready();session.state.budget.shipping_included=null;
  const reply=await run(createAgent({decide:sequence([{action:'update_conditions',patch:{budget:{shipping_included:false}}},finish])}),session,{request:{kind:'message',text:'아니요',expectedVersion:0},pendingQuestion:'예산에 배송비를 포함할까요?'});
  assert.equal(reply.session.state.budget.shipping_included,false);assert.equal(reply.routing.llmCalls,2);
});

test('model selects tool, observes engine facts, then selects finish',async()=>{
  const seen=[];const session=ready(),before=structuredClone(session);
  const out=await run(createAgent({decide:sequence([{action:'search_products'},finish],seen)}),session);
  assert.equal(out.result.cards[0].id,'tea');assert.equal(out.result.cards[0].budget_cost_krw,33000);
  assert.equal(seen[1].observations[0].result.cards[0].id,'tea');assert.equal(out.routing.llmCalls,2);assert.equal(out.routing.toolCalls,1);assert.deepEqual(session,before);
});

test('hypothetical comparison preserves state; explicit update uses shared engine',async()=>{
  const session=ready();
  const out=await run(createAgent({decide:sequence([{action:'compare_budget',amount_krw:70000},finish])}),session);
  assert.equal(out.kind,'comparison');assert.deepEqual(out.session,session);assert.equal(out.evaluatedState.budget.amount_krw,70000);assert.equal(out.result.cards[0].id,'premium');
  const changed=await run(createAgent({decide:sequence([{action:'update_conditions',patch:{budget:{amount_krw:70000}}},finish])}),session,{request:{kind:'message',text:'예산 7만원 적용',expectedVersion:0}});
  assert.equal(changed.session.state.budget.amount_krw,70000);assert.equal(changed.session.version,1);assert.equal(session.state.budget.amount_krw,50000);
});

test('first recipient preserves prior conditions; recipient switch clears old preferences',async()=>{
  const first=ready();first.state.recipients=[];
  const out=await run(createAgent({decide:sequence([{action:'update_conditions',patch:{recipients:['어머니']}},finish])}),first);
  assert.equal(out.session.state.budget.amount_krw,50000);
  const old=ready();old.state.excluded_ingredients=['우유'];old.state.preferences=['type:tea'];
  const switched=await run(createAgent({decide:sequence([{action:'update_conditions',patch:{recipients:['친구']}}])}),old);
  assert.equal(switched.kind,'question');assert.deepEqual(switched.session.state.excluded_ingredients,[]);assert.deepEqual(switched.session.state.preferences,[]);assert.equal(switched.session.state.budget.amount_krw,null);
});

test('clarification ends execution and rolls back any staged changes',async()=>{
  const session=ready();
  const out=await run(createAgent({decide:sequence([{action:'update_conditions',patch:{budget:{amount_krw:70000}}},{action:'clarify',question:'누구의 취향인가요?'}])}),session);
  assert.equal(out.kind,'question');assert.deepEqual(out.session,session);assert.equal(out.routing.llmCalls,2);
});

test('invalid condition schema and implicit allergen removal fail without mutating input',async()=>{
  for(const patch of [{budget:{amount_krw:-1}},{quantity:2},{preferences:['made-up']},{packaging:'invalid'},{delivery_by:'2026-02-30'},{excluded_ingredients:[]}]) {
    const session=ready();session.state.excluded_ingredients=['우유'];const before=structuredClone(session);
    await assert.rejects(run(createAgent({decide:sequence([{action:'update_conditions',patch}])}),session),FullChatError);assert.deepEqual(session,before);
  }
});

test('unresolved ingredient question blocks search and unrelated updates',async()=>{
  const session=ready(),pendingQuestion='피해야 할 성분을 알려주세요.';
  const blocked=await run(createAgent({decide:sequence([{action:'search_products'}])}),session,{pendingQuestion});
  assert.equal(blocked.kind,'question');assert.equal(blocked.question,pendingQuestion);assert.deepEqual(blocked.session,session);
  const unrelated=await run(createAgent({decide:sequence([{action:'update_conditions',patch:{budget:{amount_krw:70000}}}])}),session,{pendingQuestion});
  assert.equal(unrelated.question,pendingQuestion);assert.deepEqual(unrelated.session,session);
  const fixed=await run(createAgent({decide:sequence([{action:'update_conditions',patch:{excluded_ingredients:['우유']}},finish])}),session,{pendingQuestion,request:{kind:'message',text:'우유',expectedVersion:0}});
  assert.equal(fixed.kind,'recommendation');assert.deepEqual(fixed.session.state.excluded_ingredients,['우유']);
});

test('explicit allergen cancellation and explicit condition editor can remove exclusions',async()=>{
  const session=ready();session.state.excluded_ingredients=['우유'];
  const out=await run(createAgent({decide:sequence([{action:'update_conditions',patch:{excluded_ingredients:[]}},finish])}),session,{request:{kind:'message',text:'알레르기 해제',expectedVersion:0}});
  assert.deepEqual(out.session.state.excluded_ingredients,[]);
  const edit=await run(createAgent(),session,{request:{kind:'patch',expectedVersion:0,patch:{excluded_ingredients:[]}}});assert.deepEqual(edit.session.state.excluded_ingredients,[]);assert.equal(edit.routing.llmCalls,0);
});

test('repeated tool / shared call limits terminate and discard staged changes',async()=>{
  const repeated=await run(createAgent({decide:sequence([{action:'search_products'},{action:'search_products'}])}));assert.equal(repeated.routing.stopReason,'no_progress');
  const session=ready();
  const limited=await run(createAgent({maxLlmCalls:1,decide:sequence([{action:'update_conditions',patch:{budget:{amount_krw:70000}}}])}),session);
  assert.equal(limited.routing.stopReason,'llm_limit');assert.deepEqual(limited.session,session);
  const tools=await run(createAgent({maxToolCalls:1,decide:sequence([{action:'search_products'},{action:'compare_budget',amount_krw:70000}])}));assert.equal(tools.routing.stopReason,'tool_limit');
});

test('timeouts and cancellation stop even an uncooperative decision function',async()=>{
  await assert.rejects(run(createAgent({timeoutMs:10,decide:()=>new Promise(()=>{})})),e=>e.code==='timeout');
  const controller=new AbortController();
  const promise=run(createAgent({decide:()=>new Promise(()=>{})}),ready(),{signal:controller.signal});setTimeout(()=>controller.abort(),5);
  await assert.rejects(promise,e=>e.code==='aborted');
});

test('provider failure after a successful tool cannot commit partial state',async()=>{
  const session=ready(),before=structuredClone(session);let calls=0;
  const decide=async()=>{if(calls++)throw Error('secret upstream detail');return {action:'update_conditions',patch:{budget:{amount_krw:70000}}};};
  await assert.rejects(run(createAgent({decide}),session),e=>e.code==='agent_unavailable'&&!e.message.includes('secret'));assert.deepEqual(session,before);
});

test('fake products/free-text responses and stale sessions are rejected',async()=>{
  assert.equal(validAction({action:'respond',type:'result',products:[{id:'fake'}]}),false);
  assert.equal(validAction({action:'respond',type:'conversation',message:'가짜 100원'}),false);
  await assert.rejects(run(createAgent({decide:sequence([finish])}),ready(),{request:{kind:'message',text:'추천',expectedVersion:2}}),e=>e.code==='version_conflict');
  const missing=await run(createAgent({decide:sequence([finish])}));assert.equal(missing.routing.stopReason,'missing_result');
});

test('result limitation codes are whitelisted and survive completion without changing exclusions',async()=>{
  assert.equal(validAction({action:'respond',type:'result',limitations:['scent_strength']}),true);
  for(const action of [
    {action:'respond',type:'greeting',limitations:['scent_strength']},
    {action:'respond',type:'result',limitations:['invented']},
    {action:'respond',type:'result',limitations:'scent_strength'},
    {action:'respond',type:'result',limitations:['scent_strength','scent_strength']},
  ])assert.equal(validAction(action),false);
  const session=ready();session.state.excluded_categories=['food','snack','coffee_tea','health'];
  const out=await run(createAgent({decide:sequence([{action:'search_products'},{action:'respond',type:'result',limitations:['scent_strength']}])}),session,{request:{kind:'message',text:'어',expectedVersion:0},pendingQuestion:'향이 강한 제품도 빼고 추천할까요?'});
  assert.equal(out.kind,'recommendation');assert.deepEqual(out.session,session);assert.deepEqual(out.limitations,['scent_strength']);assert.equal(out.routing.stopReason,'complete');
});

test('unsupported scent category exclusions are rejected with feedback before execution',async()=>{
  const seen=[],session=ready();session.state.excluded_categories=['food'];
  const out=await run(createAgent({decide:sequence([
    {action:'update_conditions',patch:{excluded_categories:['food','beauty','decor']}},
    {action:'search_products'}, {action:'respond',type:'result',limitations:['scent_strength']},
  ],seen)}),session,{request:{kind:'message',text:'향 강한 건 빼줘',expectedVersion:0}});
  assert.deepEqual(out.session,session);assert.equal(out.routing.toolCalls,1);
  assert.match(seen[1].capabilityFeedback,/cannot be mapped/);
  assert.equal(seen[1].observations.length,0);
  const allowed=await run(createAgent({decide:sequence([{action:'update_conditions',patch:{excluded_categories:['food','beauty']}},finish])}),session,{request:{kind:'message',text:'향이 강한 것 말고 화장품 전체를 제외해줘',expectedVersion:0}});
  assert.deepEqual(allowed.session.state.excluded_categories,['food','beauty']);
});

test('confirming an unchanged budget can finish; repeating it without progress stops',async()=>{
  const action={action:'update_conditions',patch:{budget:{amount_krw:50000}}};
  const out=await run(createAgent({decide:sequence([action,finish])}));assert.equal(out.kind,'recommendation');assert.equal(out.session.version,0);
  const repeated=await run(createAgent({decide:sequence([action,action])}));assert.equal(repeated.routing.stopReason,'no_progress');
});

test('model context exposes only single gift fields and does not retain resolved pending question',async()=>{
  const seen=[],session=ready();session.state.budget.shipping_included=null;
  await run(createAgent({decide:sequence([{action:'update_conditions',patch:{budget:{shipping_included:false}}},finish],seen)}),session,{pendingQuestion:'예산에 배송비를 포함할까요?'});
  assert.ok(!('scope' in seen[0].state.budget));assert.ok(!('quantity' in seen[0].state));assert.equal(seen[1].currentQuestion,null);assert.ok(!('scope' in seen[1].observations[0].evaluatedState.budget));
});

test('concurrent runs do not share observations, counters or staged state',async()=>{
  const agent=createAgent({decide:async input=>{
    await new Promise(resolve=>setTimeout(resolve,1));
    if(input.observations.length)return finish;
    return {action:'compare_budget',amount_krw:input.text.includes('7')?70000:40000};
  }});
  const [a,b]=await Promise.all([run(agent,ready(),{request:{kind:'message',text:'7만원이면?',expectedVersion:0}}),run(agent,ready(),{request:{kind:'message',text:'4만원이면?',expectedVersion:0}})]);
  assert.equal(a.evaluatedState.budget.amount_krw,70000);assert.equal(b.evaluatedState.budget.amount_krw,40000);assert.equal(a.routing.llmCalls,2);assert.equal(b.routing.llmCalls,2);assert.equal(a.session.state.budget.amount_krw,50000);assert.equal(b.session.state.budget.amount_krw,50000);
});
