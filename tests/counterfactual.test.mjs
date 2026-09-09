import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {initial,apply,recommend,rankProducts} from '../lib/engine.mjs';
import {budgetAlternatives} from '../lib/counterfactual.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('../lib/products.json',import.meta.url)));
const state=(patch={})=>apply(apply(initial(),{quantity:1,budget:{amount_krw:30000,scope:'per_set',shipping_included:false}}),patch);
const product=(id,price,extra={})=>({id,name:`상품 ${id}`,category:'fruit',price_krw:price,shipping_fee_per_set_krw:0,packaging:'basic',sweetness:'sweet',arrival_date:'2026-09-20',stock_sets:10,brand:'A',...extra});

test('same preferences do not fabricate a changed top three',()=>{
 const s=state();const before=structuredClone(s);const result=budgetAlternatives(catalog,s);
 assert.equal(result.alternatives[0].amount,39000);
 assert.equal(result.alternatives[0].delta,9000);
 assert.equal(result.alternatives[0].effect,'eligible_only');
 assert.ok(result.alternatives[0].targetRank>3);
 assert.deepEqual(result.alternatives[0].topIds,recommend(catalog,s).items.map(p=>p.id));
 assert.deepEqual(s,before);
});
test('higher preference match really becomes the first recommendation',()=>{
 const data=[product('A',24000),product('B',55000,{sweetness:'unsweetened'})];
 const a=budgetAlternatives(data,state({preferences:['less_sweet']})).alternatives[0];
 assert.equal(a.effect,'top_changed');assert.equal(a.target.id,'B');assert.equal(a.amount,55000);assert.equal(a.delta,25000);assert.equal(a.targetRank,1);
});
test('second position can change without claiming a first-position change',()=>{
 const data=[product('A',20000,{sweetness:'unsweetened'}),product('B',24000),product('C',26000),product('D',40000,{sweetness:'naturally_sweet'})];
 const a=budgetAlternatives(data,state({preferences:['less_sweet']})).alternatives[0];
 assert.equal(a.effect,'top_three_changed');assert.equal(a.targetRank,2);assert.deepEqual(a.topIds,['A','D','B']);
});
test('total budget includes quantity and every shipping fee',()=>{
 const data=[product('A',39000,{shipping_fee_per_set_krw:3000})];
 const s=state({quantity:3,same_product:true,budget:{amount_krw:100000,scope:'total',shipping_included:true}});
 const a=budgetAlternatives(data,s).alternatives[0];
 assert.equal(a.amount,126000);assert.equal(a.delta,26000);assert.equal(a.effect,'first_match');
 assert.equal(recommend(data,apply(s,{budget:{amount_krw:125999}})).items.length,0);
 assert.equal(recommend(data,apply(s,a.patch)).items[0].id,'A');
});
test('per-set budget does not multiply the requested cap by quantity',()=>{
 const s=state({quantity:3,same_product:true,budget:{shipping_included:true}});
 const a=budgetAlternatives([product('A',39000,{shipping_fee_per_set_krw:3000})],s).alternatives[0];
 assert.equal(a.amount,42000);assert.equal(a.delta,12000);assert.equal(a.target.total,126000);
});
test('only budget changes; other exclusions and constraints remain enforced',()=>{
 const data=[product('nuts',31000,{category:'nuts',packaging:'formal'}),product('late',32000,{arrival_date:'2026-09-24',packaging:'formal'}),product('basic',33000),product('brand',34000,{brand:'B',packaging:'formal'}),product('empty',35000,{stock_sets:0,packaging:'formal'}),product('ok',45000,{packaging:'formal'})];
 const s=state({excluded_categories:['nuts'],brand:'A',packaging:'formal',delivery_by:'2026-09-21'});
 const a=budgetAlternatives(data,s).alternatives[0];assert.equal(a.target.id,'ok');
 const after=apply(s,a.patch);const expected=structuredClone(s);expected.budget.amount_krw=45000;assert.deepEqual(after,expected);
});
test('allergy uncertainty blocks alternatives instead of removing constraints',()=>{
 const s=state({excluded_ingredients:['땅콩']});const r=budgetAlternatives(catalog,s);assert.equal(r.status,'insufficient_product_info');assert.deepEqual(r.alternatives,[]);
});
test('missing budget, quantity, shipping or same-product decision prompts clarification',()=>{
 for(const s of [initial(),state({quantity:null}),state({budget:{shipping_included:null}}),state({quantity:2,same_product:null})])assert.equal(budgetAlternatives(catalog,s).alternatives.length,0);
});
test('no budget-only alternative means no invented candidate',()=>{
 const s=state({brand:'nonexistent'});assert.equal(budgetAlternatives(catalog,s).status,'no_alternative');
 assert.equal(budgetAlternatives(catalog,state({budget:{amount_krw:999999}})).alternatives.length,0);
});
test('each offered threshold is sufficient, minimal for target, and reproduces displayed ranking',()=>{
 for(const s of [state(),state({preferences:['less_sweet']}),state({quantity:3,same_product:true,budget:{amount_krw:40000,scope:'total',shipping_included:true}})]){
  for(const a of budgetAlternatives(catalog,s).alternatives){
   assert.deepEqual(recommend(catalog,apply(s,a.patch)).items.map(p=>p.id),a.topIds);
   assert.ok(!rankProducts(catalog,apply(s,{budget:{amount_krw:a.amount-1}})).items.some(p=>p.id===a.target.id));
   assert.ok(rankProducts(catalog,apply(s,a.patch)).items.some(p=>p.id===a.target.id));
  }
 }
});
test('shipping can make a cheaper product exceed the cap; contrast stays truthful',()=>{
 const data=[product('A',25000),product('B',24000,{shipping_fee_per_set_krw:4000})];
 const a=budgetAlternatives(data,state({budget:{amount_krw:25000,shipping_included:true}})).alternatives[0];
 assert.equal(a.effect,'top_changed');assert.equal(a.amount,28000);assert.match(a.rankingReason,/상품값은 더 낮지만 배송비/);
});
test('raising 150k to 200k cannot admit a 320k item',()=>{
 const data=[product('A',120000),product('B',320000)];const s=state({budget:{amount_krw:150000}});
 assert.ok(!recommend(data,apply(s,{budget:{amount_krw:200000}})).items.some(p=>p.id==='B'));
 const a=budgetAlternatives(data,s).alternatives[0];assert.equal(a.amount,320000);assert.equal(a.delta,170000);
});
