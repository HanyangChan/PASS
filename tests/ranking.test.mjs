import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {initial,apply,recommend,budgetCost} from '../lib/engine.mjs';
import {productTypes,RANKING_POLICY} from '../lib/ranking.mjs';
import {toEngineProduct} from '../lib/catalog.mjs';
const p=(id,price,extra={})=>({id,name:id,category:'decor',brand:id,price_krw:price,shipping_fee_per_set_krw:0,stock_sets:10,arrival_date:'2026-11-07',packaging:'basic',sweetness:'unknown',rating_count:1000,allergens_declared:[],...extra});
const state=patch=>apply(initial(),{quantity:1,same_product:true,budget:{amount_krw:100000,scope:'per_set',shipping_included:true},...patch});
test('budget changes can change the winner without admitting over-budget products',()=>{
 const data=[p('cheap',10000,{rating_count:100000}),p('mid',40000),p('gift',80000),p('tooMuch',100001)];
 assert.equal(recommend(data,state({budget:{amount_krw:50000}})).items[0].id,'mid');
 const r=recommend(data,state());assert.equal(r.items[0].id,'gift');assert.equal(r.rankingPolicy,RANKING_POLICY);
 assert.ok(r.items.every(x=>budgetCost(x,state())<=100000));
 assert.deepEqual(recommend(data,state()),r);
});
test('shipping and total quantity affect budget fit as well as the cap',()=>{
 const s=state({quantity:2,budget:{amount_krw:100000,scope:'total',shipping_included:true}});
 const r=recommend([p('A',37000,{shipping_fee_per_set_krw:3000}),p('B',80000),p('C',10000)],s);
 assert.equal(r.items[0].id,'A');assert.equal(r.items[0].budget_ratio,0.8);assert.ok(r.items.every(x=>x.total<=100000));
});
test('near-equivalent variants and brands do not fill all three recommendation slots',()=>{
 const data=[p('a',80000,{name_en:'Gift Tea 100 g',brand:'same'}),p('b',80000,{name_en:'Gift Tea 200 g',brand:'same'}),p('c',78000,{name_en:'Flower set',brand:'other'}),p('d',76000,{name_en:'Mug set',brand:'third'})];
 assert.deepEqual(recommend(data,state()).items.map(x=>x.id),['a','c','d']);
});
test('explicit tea preference outranks a more expensive coffee and respects hard exclusions',()=>{
 const data=[p('tea',20000,{name:'홍차',category:'coffee_tea'}),p('coffee',80000,{name:'커피',category:'coffee_tea'}),p('badTea',80000,{name:'홍차',category:'coffee_tea',allergens_declared:['우유']})];
 const s=state({preferences:['category:coffee_tea','type:tea'],excluded_ingredients:['우유']});
 const r=recommend(data,s);assert.equal(r.items[0].id,'tea');assert.ok(!r.items.some(x=>x.id==='badTea'));
 assert.deepEqual(productTypes(data[0]),['type:tea']);assert.deepEqual(productTypes(data[1]),['type:coffee']);
});
test('cheap-only preferred candidates remain available with an explanation',()=>{
 const r=recommend([p('cheap',10000)],state());assert.equal(r.items[0].id,'cheap');assert.match(r.budgetNotice,/낮은 가격대/);
 assert.equal(recommend([p('cheap',10000)],state({budget:{amount_krw:null}})).budgetNotice,null);
});
test('the 3376-product catalog responds to budget while preserving tea preference',()=>{
 const data=JSON.parse(fs.readFileSync(new URL('../supabase/seed/products-amazon.json',import.meta.url))).map(x=>toEngineProduct(x,'2026-11-05'));
 assert.equal(data.length,3376);
 const patch={recipients:['어머니'],preferences:['category:coffee_tea','type:tea']};
 const a=recommend(data,state({...patch,budget:{amount_krw:30000,scope:'per_set',shipping_included:true}}));
 const b=recommend(data,state(patch));
 assert.notDeepEqual(a.items.map(x=>x.id),b.items.map(x=>x.id));
 assert.equal(new Set(b.items.map(x=>x.brand)).size,3);
 assert.ok(b.items.every(x=>productTypes(x).includes('type:tea')&&x.total<=100000));
 assert.ok(b.items.reduce((n,x)=>n+x.total,0)>a.items.reduce((n,x)=>n+x.total,0));
 assert.match(b.budgetNotice,/낮은 가격대/);
});
