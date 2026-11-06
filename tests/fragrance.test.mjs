import test from 'node:test';
import assert from 'node:assert/strict';
import { isFragranceProduct, FRAGRANCE_NOTICE } from '../lib/fragrance.mjs';
import { initial, apply, recommend } from '../lib/engine.mjs';
import { recommend as baselineRecommend } from '../baseline/src/vendor/engine.mjs';

test('fragrance names match in Korean and English, without excluding whole categories',()=>{
 for(const name of ['향수 선물 세트','리드 디퓨저','라벤더 향초','차량 방향제','아로마 오일','Perfume Gift Set','Reed Diffuser','Scented Candle','Air Freshener','Essential Oil','Incense Sticks'])assert.equal(isFragranceProduct({name}),true,name);
 for(const name of ['무향 향초','Unscented Candle','Fragrance-free Lotion','우드 인테리어 시계','Hair Diffuser Attachment','Diffuser Camera Filter','차 선물 세트','주방용 오일'])assert.equal(isFragranceProduct({name}),false,name);
 assert.equal(isFragranceProduct({name:'상품',name_en:'Eau de Parfum'}),true);
});

test('fragrance rule filters before ranking, persists on budget changes, and cancellation restores products',()=>{
 const product=(id,name,category)=>({id,name,category,brand:null,price_krw:20000,shipping_fee_per_set_krw:1000,stock_sets:10,arrival_date:'2026-11-07',packaging:'basic',sweetness:'unknown',rating_count:10,allergens_declared:[]});
 const products=[product('perfume','Perfume Gift','beauty'),product('diffuser','Reed Diffuser','decor'),product('clock','Wood Clock','decor'),product('lotion','Unscented Lotion','beauty'),product('tea','Tea Set','coffee_tea')];
 const state=apply(initial(),{recipients:['친구'],quantity:1,same_product:true,budget:{amount_krw:100000,shipping_included:true,scope:'per_set'},preferences:['avoid_fragrance'],excluded_categories:['food','snack','coffee_tea','health']});
 for(const budget of [100000,50000]) {
  const s=apply(state,{budget:{amount_krw:budget}});
  const out=recommend(products,s);
  assert.deepEqual(new Set(out.items.map(p=>p.id)),new Set(['clock','lotion']));
  assert.match(out.message,/상품명 기준/);assert.equal(out.notice,FRAGRANCE_NOTICE);
  assert.deepEqual(baselineRecommend(products,s),out);
 }
 const cleared=apply(state,{preferences:[]});
 assert.ok(recommend(products,cleared).items.some(p=>p.id==='perfume'||p.id==='diffuser'));
 assert.equal(recommend(products,cleared).notice,null);
});
