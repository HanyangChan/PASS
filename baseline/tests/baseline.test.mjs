import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createSession,runTurn} from '../src/index.mjs';
import {recommend} from '../src/vendor/engine.mjs';
import {products} from '../examples/catalog.mjs';
const patch={recipients:['어머니'],quantity:1,same_product:true,budget:{amount_krw:50000,scope:'per_set',shipping_included:true}};
const turn=(session,request,extra={})=>runTurn({session,products,request:{expectedVersion:session.version,...request},...extra});
const ready=async()=> (await turn(createSession('test'),{kind:'patch',patch})).session;
test('shared engine snapshot remains frozen',async()=>{
 const manifest=JSON.parse(await readFile(new URL('../src/vendor/provenance.json',import.meta.url)));
 for(const [name,hash] of Object.entries(manifest.sha256)) assert.equal(createHash('sha256').update(await readFile(new URL(`../src/vendor/${name}`,import.meta.url))).digest('hex'),hash);
});
test('clear input uses rules with zero extension calls and matches engine ranking',async()=>{
 let calls=0;
 const out=await turn(createSession('t'),{kind:'message',text:'어머니 한 세트 세트당 예산 5만원 이하 배송비 포함 추천'},{interpret:()=>{calls++;}});
 assert.equal(calls,0); assert.equal(out.kind,'recommendation');
 assert.deepEqual(out.result.cards.map(p=>p.id),recommend(products,out.session.state).items.map(p=>p.id));
 assert.equal(out.result.cards[0].budget_cost_krw,33000);
});
test('missing conditions ask a single question without invented defaults',async()=>{
 const out=await turn(createSession('t'),{kind:'view'});
 assert.equal(out.kind,'question'); assert.match(out.question,/받는 사람/); assert.equal(out.session.version,0);
});
test('conflicting budgets and giver statements do not alter existing state',async()=>{
 const session=await ready();
 for(const text of ['예산 10만원 이하 최소 15만원','나는 단 것을 좋아해','어머니 차 싫어해','배송비 포함 배송비 별도']) {
  const out=await turn(session,{kind:'message',text});
  assert.equal(out.kind,'question'); assert.deepEqual(out.session,session);
 }
});
test('recipient switch clears prior budget and constraints; explicit new values survive',async()=>{
 const session=await ready();session.state.excluded_ingredients=['견과류'];
 const out=await turn(session,{kind:'patch',patch:{recipients:['친구'],budget:{amount_krw:70000}}});
 assert.deepEqual(out.session.state.excluded_ingredients,[]);assert.equal(out.session.state.budget.scope,null);
 assert.equal(out.session.state.budget.amount_krw,70000);assert.equal(out.kind,'question');
});
test('partial budget update preserves all other confirmed conditions',async()=>{
 const session=await ready();
 const out=await turn(session,{kind:'patch',patch:{budget:{amount_krw:40000}}});
 assert.deepEqual(out.session.state,{...session.state,budget:{...session.state.budget,amount_krw:40000}});
 assert.equal(session.state.budget.amount_krw,50000); assert.equal(out.session.version,2);
});
test('what-if reranks but never mutates input or returned session',async()=>{
 const session=await ready(),before=structuredClone(session);
 const out=await turn(session,{kind:'what_if_budget',amount_krw:70000});
 assert.equal(out.kind,'comparison');assert.equal(out.result.cards[0].id,'premium');
 assert.equal(out.evaluatedState.budget.amount_krw,70000);assert.deepEqual(session,before);assert.deepEqual(out.session,before);
});
test('hard exclusions, stock and budget are enforced including shipping',async()=>{
 const s=await ready();
 const out=await turn(s,{kind:'patch',patch:{excluded_ingredients:['견과류'],budget:{amount_krw:30000}}});
 assert.equal(out.result.status,'no_match'); assert.equal(out.result.cards.length,0);assert.match(out.result.message,/조건/);
 const out2=await turn(s,{kind:'view'},{products:products.map(p=>({...p,stock_sets:0}))});
 assert.equal(out2.result.status,'no_match');
});
test('stale versions are rejected',async()=>{
 const session=await ready();
 await assert.rejects(turn(session,{kind:'view',expectedVersion:0}),{code:'version_conflict'});
});
test('malformed patches, invalid catalog, invalid extension outputs fail closed',async()=>{
 const s=await ready();
 for(const p of [{unknown:true},{budget:null},{budget:{amount_krw:-1}},{budget:{scope:'anything'}},{quantity:1.5},{delivery_by:'2026-02-30'}])
  await assert.rejects(turn(s,{kind:'patch',patch:p}),{code:'invalid_input'});
 await assert.rejects(turn(s,{kind:'view'},{products:[...products,products[0]]}),{code:'invalid_input'});
 await assert.rejects(turn(s,{kind:'message',text:'무난한 선물'},{interpret:async()=>({patch:{budget:{amount_krw:-1}},questions:[],unresolved:false})}),{code:'invalid_input'});
});
test('extension gets a state clone and cannot mutate caller session',async()=>{
 const s=await ready(),before=structuredClone(s);
 const out=await turn(s,{kind:'message',text:'무난한 선물'},{interpret:async({state})=>{
  state.budget.amount_krw=1;return {patch:{preferences:['category:coffee_tea']},questions:[],unresolved:false};
 }});
 assert.deepEqual(s,before);assert.equal(out.session.state.budget.amount_krw,50000);assert.equal(out.trace[1].provider,'extension');
});
test('category, brand, packaging, deadline and total budget share one constraint path',async()=>{
 const s=await ready();
 for (const patch of [{excluded_categories:['coffee_tea','snack']},{brand:'없는 브랜드'},{delivery_by:'2026-11-30'},{packaging:'formal'},{quantity:2,same_product:true,budget:{scope:'total',amount_krw:40000}}]) {
  const out=await turn(s,{kind:'patch',patch});
  assert.equal(out.kind,'recommendation');assert.equal(out.result.status,'no_match');
 }
});
test('hypothetical budget must be a positive integer',async()=>{
 const s=await ready();
 for(const amount_krw of [null,0,-1,1.5,'70000']) await assert.rejects(turn(s,{kind:'what_if_budget',amount_krw}),{code:'invalid_request'});
});
