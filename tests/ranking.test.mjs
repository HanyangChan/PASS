import test from 'node:test';
import assert from 'node:assert/strict';
import {initial,apply,recommend} from '../lib/engine.mjs';
import {productTypes} from '../lib/ranking.mjs';
const p=(id,price,extra={})=>({id,name:id,category:'decor',brand:id,price_krw:price,shipping_fee_per_set_krw:0,stock_sets:10,arrival_date:'2026-11-07',packaging:'basic',sweetness:'unknown',rating_count:1000,allergens_declared:[],...extra});
const state=patch=>apply(initial(),{quantity:1,same_product:true,budget:{amount_krw:100000,scope:'per_set',shipping_included:true},...patch});
test('explicit tea preference outranks a more expensive coffee and respects hard exclusions',()=>{
 const data=[p('tea',20000,{name:'홍차',category:'coffee_tea'}),p('coffee',80000,{name:'커피',category:'coffee_tea'}),p('badTea',80000,{name:'홍차',category:'coffee_tea',allergens_declared:['우유']})];
 const s=state({preferences:['category:coffee_tea','type:tea'],excluded_ingredients:['우유']});
 const r=recommend(data,s);assert.equal(r.items[0].id,'tea');assert.ok(!r.items.some(x=>x.id==='badTea'));
 assert.deepEqual(productTypes(data[0]),['type:tea']);assert.deepEqual(productTypes(data[1]),['type:coffee']);
});
