import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '../index.mjs';
import { createSession, runTurn } from '../../../src/index.mjs';
import { products } from '../../../examples/catalog.mjs';
const ready=async()=> (await runTurn({session:createSession('router'),products,request:{kind:'patch',expectedVersion:0,patch:{recipients:['어머니'],quantity:1,same_product:true,budget:{amount_krw:50000,scope:'per_set',shipping_included:true}}}})).session;
const send=(agent,session,text,extra={})=>agent.runTurn({session,products,request:{kind:'message',expectedVersion:session.version,text},...extra});

test('prototype conditions, Korean money, negation and partial edits use zero model calls',async()=>{
 let calls=0;const agent=createAgent({interpret:async()=>{calls++;throw Error('unexpected');}});
 let session=await ready();
 for(const [text,check] of [
  ['엄마는 차 좋아해',s=>assert.deepEqual(s.preferences,['category:coffee_tea','type:tea'])],
  ['견과류는 빼줘',s=>assert.deepEqual(s.excluded_ingredients,['견과류'])],
  ['예산 칠만원으로 바꿔줘',s=>assert.equal(s.budget.amount_krw,70000)],
  ['덜 단 상품으로',s=>assert.ok(s.preferences.includes('less_sweet'))],
  ['배송비 별도',s=>assert.equal(s.budget.shipping_included,false)],
  ['커피는 안 좋아해',s=>{assert.ok(s.excluded_categories.includes('coffee_tea'));assert.ok(!s.preferences.some(p=>['type:tea','type:coffee','category:coffee_tea'].includes(p)));}],
  ['커피 제외 취소',s=>assert.ok(!s.excluded_categories.includes('coffee_tea'))],
  ['브랜드 "데모"',s=>assert.equal(s.brand,'데모')],
  ['기본 포장',s=>assert.equal(s.packaging,'basic')],
  ['2026-12-05까지',s=>assert.equal(s.delivery_by,'2026-12-05')],
 ]) {
  const out=await send(agent,session,text);assert.notEqual(out.kind,'question',text);check(out.session.state);session=out.session;assert.equal(out.routing.llmCalls,0);
 }
 assert.equal(calls,0);
});

test('unrecognized remainder never silently applies the recognized part',async()=>{
 const session=await ready(),before=structuredClone(session);
 const out=await send(createAgent(),session,'예산 7만원 그리고 센스 있게 골라줘');
 assert.equal(out.kind,'question');assert.deepEqual(out.session,before);assert.deepEqual(session,before);
});

test('conflicts, giver facts and invalid dates ask without model calls or state mutation',async()=>{
 const session=await ready();let calls=0;const agent=createAgent({interpret:async()=>{calls++;}});
 for(const text of ['나는 단 것을 좋아해','예산 10만원 이하 최소 15만원','예산 5만원 7만원','예산 -1만원','예산 0원','2026-02-30까지','배송비 포함 배송비 별도','배송비 포함 상품값만','세트당 총 5만원','친구와 엄마 선물']) {
  const out=await send(agent,session,text);assert.equal(out.kind,'question',text);assert.deepEqual(out.session,session);
 }
 assert.equal(calls,0);
});

test('shipping yes/no is bound to the actual next question',async()=>{
 const session=await ready();session.state.budget.shipping_included=null;
 const out=await send(createAgent(),session,'아니요');assert.equal(out.session.state.budget.shipping_included,false);
 const missing=createSession('new');
 const ambiguous=await send(createAgent(),missing,'네');assert.equal(ambiguous.kind,'question');assert.equal(ambiguous.session.state.budget.shipping_included,null);
});

test('recommendation and explanation keep state and use engine facts',async()=>{
 const session=await ready();const agent=createAgent();
 for(const text of ['추천해줘','왜 추천했어?']) {
  const out=await send(agent,session,text);assert.deepEqual(out.session,session);assert.equal(out.result.cards[0].id,'tea');assert.equal(out.routing.llmCalls,0);
 }
});

test('natural budget comparisons rerank with absolute and relative budgets without applying',async()=>{
 const session=await ready();const agent=createAgent();
 for(const text of ['예산 7만원이면?','예산 2만원 올리면?']) {
  const out=await send(agent,session,text);assert.equal(out.kind,'comparison',text);assert.equal(out.evaluatedState.budget.amount_krw,70000);assert.equal(out.result.cards[0].id,'premium');assert.deepEqual(out.session,session);
 }
 const down=await send(agent,session,'예산 2만원 줄이면?');assert.equal(down.evaluatedState.budget.amount_krw,30000);
 const mixed=await send(agent,session,'예산 7만원이면 커피 제외');assert.equal(mixed.kind,'question');assert.deepEqual(mixed.session,session);
 const applied=await send(agent,session,'예산 7만원으로 바꿔줘');assert.equal(applied.session.state.budget.amount_krw,70000);
});

test('LLM fallback is one bounded interpretation and shared validation still applies',async()=>{
 const session=await ready();let calls=0;
 const agent=createAgent({interpret:async({state,signal})=>{calls++;assert.ok(signal instanceof AbortSignal);state.budget.amount_krw=1;return {patch:{preferences:['category:coffee_tea']},questions:[],unresolved:false};}});
 const out=await send(agent,session,'센스 있는 선물');assert.equal(calls,1);assert.equal(out.routing.route,'llm');assert.equal(out.session.state.budget.amount_krw,50000);assert.deepEqual(session.state.preferences,[]);
 const bad=createAgent({interpret:async()=>({patch:{budget:{amount_krw:-1}},questions:[],unresolved:false})});
 await assert.rejects(send(bad,session,'센스 있는 선물'),{code:'invalid_input'});
 const invented=createAgent({interpret:async()=>({patch:{excluded_categories:['invented']},questions:[],unresolved:false})});
 await assert.rejects(send(invented,session,'센스 있는 선물'),{code:'invalid_interpretation'});
});

test('provider failure, timeout and uncertainty preserve the existing session',async()=>{
 const session=await ready();
 for (const interpret of [async()=>{throw Error('credential-raw-input');},()=>new Promise(()=>{}),async()=>({patch:{budget:{amount_krw:1}},questions:['원하는 느낌을 알려주세요.'],unresolved:true})]) {
  const out=await send(createAgent({interpret,timeoutMs:10}),session,'센스 있는 선물');
  assert.equal(out.kind,'question');assert.deepEqual(out.session,session);assert.ok(!JSON.stringify(out).includes('credential-raw-input'));
 }
});

test('allergy constraints cannot be silently removed by a model',async()=>{
 const session=await ready();session.state.excluded_ingredients=['우유'];
 const agent=createAgent({interpret:async()=>({patch:{excluded_ingredients:[],preferences:['category:coffee_tea']},questions:[],unresolved:false})});
 const out=await send(agent,session,'센스 있는 선물');assert.deepEqual(out.session.state.excluded_ingredients,['우유']);
 const cancel=await send(agent,session,'알레르기 없음');assert.deepEqual(cancel.session.state.excluded_ingredients,[]);
 const pending=await send(createAgent(),await ready(),'우유',{pendingQuestion:'피해야 할 알레르기 성분을 알려주세요.'});assert.deepEqual(pending.session.state.excluded_ingredients,['우유']);
});

test('recipient switch clears prior conditions and prototype-only structural defaults are explicit',async()=>{
 const session=await ready();session.state.excluded_ingredients=['우유'];
 const standalone=await send(createAgent(),session,'친구 예산 7만원');
 assert.equal(standalone.kind,'question');assert.equal(standalone.session.state.quantity,null);assert.deepEqual(standalone.session.state.excluded_ingredients,[]);
 const prototype=await send(createAgent({singleGift:true}),session,'친구 예산 7만원 배송비 포함');
 assert.equal(prototype.kind,'recommendation');assert.equal(prototype.session.state.quantity,1);assert.equal(prototype.session.state.budget.scope,'per_set');assert.deepEqual(prototype.session.state.excluded_ingredients,[]);
});

test('stale and malformed requests are rejected before provider side effects',async()=>{
 const session=await ready();let calls=0;const agent=createAgent({interpret:async()=>{calls++;}});
 await assert.rejects(agent.runTurn({session,products,request:{kind:'message',text:'센스',expectedVersion:0}}),{code:'version_conflict'});
 await assert.rejects(agent.runTurn({session,products,request:{kind:'message',text:'',expectedVersion:1}}),{code:'invalid_request'});
 assert.equal(calls,0);
});

test('host-provided unresolved allergy blocks recommendation and hypothetical results',async()=>{
 const session=await ready();const agent=createAgent();
 for (const text of ['추천해줘','왜 추천했어?','예산 7만원이면?','예산 7만원']) {
  const out=await send(agent,session,text,{pendingQuestion:'피해야 할 알레르기 성분을 알려주세요.'});
  assert.equal(out.kind,'question');assert.match(out.question,/성분/);assert.ok(!out.result);
 }
});

test('first recipient identification retains conditions entered before the recipient',async()=>{
 const agent=createAgent({singleGift:true});
 const budget=await send(agent,createSession('budget-first'),'예산 5만원 배송비 포함');
 const recipient=await send(agent,budget.session,'엄마');
 assert.equal(recipient.kind,'recommendation');assert.equal(recipient.session.state.budget.amount_krw,50000);assert.equal(recipient.session.state.budget.shipping_included,true);
});

test('explicit preferences for a new recipient never merge prior recipient arrays',async()=>{
 const session=await ready();session.state.preferences=['less_sweet'];session.state.excluded_ingredients=['견과류'];session.state.excluded_categories=['coffee_tea'];
 const out=await send(createAgent({singleGift:true}),session,'친구 커피 좋아해 우유 알레르기 있어');
 assert.deepEqual(out.session.state.preferences,['category:coffee_tea','type:coffee']);assert.deepEqual(out.session.state.excluded_ingredients,['우유']);assert.deepEqual(out.session.state.excluded_categories,[]);
});
