import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgent } from '../index.mjs';
import { createSession, runTurn } from '../../../src/index.mjs';
import { products } from '../../../examples/catalog.mjs';
const ready=async()=> (await runTurn({session:createSession('router'),products,request:{kind:'patch',expectedVersion:0,patch:{recipients:['어머니'],quantity:1,same_product:true,budget:{amount_krw:50000,scope:'per_set',shipping_included:true}}}})).session;
const send=(agent,session,text,extra={})=>agent.runTurn({session,products,request:{kind:'message',expectedVersion:session.version,text},...extra});

test('food exclusion is applied while shipping is pending and scent has an explicit capability notice',async()=>{
 const session=await ready();session.state.budget.shipping_included=null;session.state.preferences=['category:coffee_tea','type:tea'];session.state.excluded_ingredients=['우유'];
 const agent=createAgent({interpret:async()=>{throw Error('must use rules');}});
 const out=await send(agent,session,'향이 강한 제품은 빼고, 먹는 것도 제외해줘.',{pendingQuestion:'예산에 배송비도 포함할까요?'});
 assert.equal(out.kind,'question');assert.match(out.question,/배송비/);assert.equal(out.routing.llmCalls,0);
 assert.deepEqual(out.session.state.excluded_categories,['food','snack','coffee_tea','health']);assert.deepEqual(out.session.state.preferences,['avoid_fragrance']);
 assert.deepEqual(out.session.state.excluded_ingredients,['우유']);
 const next=await send(agent,out.session,'배송비 포함');
 assert.equal(next.kind,'recommendation');assert.deepEqual(next.session.state.excluded_categories,out.session.state.excluded_categories);
 const scent=await send(agent,await ready(),'향이 강한 제품은 제외해줘.');
 assert.equal(scent.kind,'recommendation');assert.deepEqual(scent.session.state.excluded_categories,[]);assert.deepEqual(scent.session.state.preferences,['avoid_fragrance']);
 const cancelled=await send(agent,next.session,'향 제품 제외 취소');
 assert.ok(!cancelled.session.state.preferences.includes('avoid_fragrance'));assert.deepEqual(cancelled.session.state.excluded_categories,next.session.state.excluded_categories);
});

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

test('explicit budget targets and increments are read-only while self-correction applies', async()=>{
 const session=await ready(), agent=createAgent();
 for (const [text,amount] of [['7만원으로 올리면?',70000],['3만원 더 올리면?',80000],['7만원으로 더 올리면?',70000],['4만원으로 줄이면?',40000]]) {
  const out=await send(agent,session,text);
  assert.equal(out.kind,'comparison',text);
  assert.equal(out.evaluatedState.budget.amount_krw,amount);
  assert.deepEqual(out.session,session);
 }
 const correction=await send(agent,session,'예산 5만원. 아니, 7만원으로');
 assert.equal(correction.session.state.budget.amount_krw,70000);
 const conflict=await send(agent,session,'배송비까지 해서 5만원, 배송비 별도');
 assert.match(conflict.question,/배송비/);
 assert.deepEqual(conflict.session,session);
});

test('ingredient lists preserve other exclusions and conflicting instructions ask for clarification', async()=>{
 const session=await ready(), agent=createAgent();
 session.state.excluded_ingredients=['새우'];
 for (const text of ['땅콩이랑 우유 알레르기 있어요','우유는 빼고 땅콩도 제외해 주세요']) {
  const out=await send(agent,session,text);
  assert.deepEqual([...out.session.state.excluded_ingredients].sort(),['땅콩','새우','우유']);
  assert.equal(out.routing.llmCalls,0);
  const removed=await send(agent,out.session,'땅콩 알레르기 없어요');
  assert.deepEqual(removed.session.state.excluded_ingredients,['새우','우유']);
 }
 const conflict=await send(agent,session,'땅콩 알레르기 없어요, 땅콩 알레르기 있어요');
 assert.equal(conflict.kind,'question');
 assert.deepEqual(conflict.session,session);

 const noAllergy=await send(agent,session,'없어요',{pendingQuestion:'알레르기가 있나요?'});
 assert.deepEqual(noAllergy.session.state.excluded_ingredients,[]);
 const missingIngredient=await send(agent,session,'없어요',{pendingQuestion:'피해야 할 알레르기 성분을 알려주세요.'});
 assert.equal(missingIngredient.kind,'question');
 assert.deepEqual(missingIngredient.session,session);
 const listReply=await send(agent,session,'땅콩이랑 우유요',{pendingQuestion:'피해야 할 알레르기 성분을 알려주세요.'});
 assert.deepEqual(listReply.session.state.excluded_ingredients,['새우','땅콩','우유']);
 const ambiguousReply=await send(agent,session,'없어요',{pendingQuestion:'알레르기 조건을 확인해 주세요.'});
 assert.equal(ambiguousReply.kind,'question');
 assert.deepEqual(ambiguousReply.session,session);
});

test('common phrasing maps to the existing gift conditions without model calls',async()=>{
 const session=await ready();
 session.state.budget.shipping_included=false;
 const agent=createAgent({interpret:async()=>{throw Error('must use rules');}});
 for (const [text,expected] of [
  ['배송비까지 해서 5만원',{budget:{...session.state.budget,shipping_included:true}}],
  ['4만원 안쪽으로',{budget:{...session.state.budget,amount_krw:40000}}],
  ['엄마 생신 선물 추천',{occasion:'생일',recipients:['어머니']}],
  ['합격 축하 선물',{occasion:'합격'}],
  ['수능 응원 선물',{occasion:'수험'}],
  ['결혼기념일 선물',{occasion:'기념일'}],
  ['엄마는 커피를 좋아하세요',{preferences:['category:coffee_tea','type:coffee']}],
  ['저는 커피 좋아하는데 엄마는 차 좋아해요',{preferences:['category:coffee_tea','type:tea']}],
  ['먹는 건 빼주세요',{excluded_categories:['food','snack','coffee_tea','health']}],
  ['뷰티 상품 전체를 제외해 주세요',{excluded_categories:['beauty']}],
  ['향이 센 건 싫어하세요',{preferences:['avoid_fragrance']}],
  ['견과류는 빼주세요',{excluded_ingredients:['견과류']}],
 ]) {
  const out=await send(agent,session,text);
  assert.equal(out.routing.route,'rules',text);
  for (const [field,value] of Object.entries(expected)) assert.deepEqual(out.session.state[field],value,text);
 }
 const perfume=await send(agent,session,'향수 말고 커피로 추천해줘');
 // Requirement table: apply the coffee taste and ask whether to drop only perfume or all beauty.
 assert.match(perfume.question,/향수만/);
 assert.deepEqual(perfume.session.state.preferences,['category:coffee_tea','type:coffee']);
 assert.deepEqual(perfume.session.state.excluded_categories,[]);
 const explanation=await send(agent,session,'왜 이게 1위야?');
 assert.equal(explanation.routing.intent,'explain');
 assert.deepEqual(explanation.session,session);
});

test('explicit recipient replacement does not carry prior preferences or exclusions',async()=>{
 const session=await ready();
 session.state.recipients=['친구'];
 session.state.preferences=['type:coffee'];
 session.state.excluded_ingredients=['우유'];
 const out=await send(createAgent(),session,'친구 말고 엄마한테 줄 거야');
 assert.deepEqual(out.session.state.recipients,['어머니']);
 assert.deepEqual(out.session.state.preferences,[]);
 assert.deepEqual(out.session.state.excluded_ingredients,[]);
});
