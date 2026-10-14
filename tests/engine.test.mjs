import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {initial,apply,extract,recommend,differences,ALLERGY_NOTICE}from '../lib/engine.mjs';
const products=JSON.parse(fs.readFileSync(new URL('./fixtures/food-demo.json',import.meta.url)));const cases=JSON.parse(fs.readFileSync(new URL('../lib/test-dialogues.json',import.meta.url)));
for(const c of cases)test(c.id+' '+c.title,()=>{let s=initial();for(const t of c.turns){const parsed=extract(t.user,s);s=apply(s,parsed.patch);assert.deepEqual(s,t.expected_state);assert.equal(parsed.questions.length>0,t.clarification_topics.length>0)}});
test('total budget includes per-set shipping',()=>{const s=apply(initial(),{quantity:3,same_product:true,budget:{amount_krw:78000,scope:'total',shipping_included:true}});assert.equal(recommend(products,s).items.length,0);s.budget.amount_krw=81000;assert.ok(recommend(products,s).items.every(p=>p.total===81000));});
test('empty results and allergen exclusion with notice',()=>{
 assert.equal(recommend(products,apply(initial(),{budget:{amount_krw:10000}})).status,'no_match');
 const data=[{...products[0],id:'A',allergens_declared:['땅콩']},{...products[0],id:'B',allergens_declared:[]}];
 const r=recommend(data,apply(initial(),{excluded_ingredients:['땅콩']}));
 assert.equal(r.status,'ready');assert.deepEqual(r.items.map(p=>p.id),['B']);assert.equal(r.notice,ALLERGY_NOTICE);assert.match(r.message,/성분표/);
 assert.equal(recommend(data,initial()).notice,null);
});
test('new category words map to the catalog vocabulary',()=>{
 assert.deepEqual(extract('과자는 빼줘',initial()).patch.excluded_categories,['snack']);
 assert.deepEqual(extract('견과류는 빼줘',initial()).patch.excluded_ingredients,['견과류']);
 assert.deepEqual(extract('차로 할게',initial()).patch.preferences,['category:coffee_tea']);
});
test('exact date, category and formal packaging filters',()=>{const s=apply(initial(),{delivery_by:'2026-09-21',packaging:'formal',excluded_categories:['nuts'],budget:{amount_krw:60000,scope:'per_set'}});const r=recommend(products,s);assert.ok(r.items.length);for(const p of r.items){assert.ok(p.arrival_date<=s.delivery_by);assert.equal(p.packaging,'formal');assert.notEqual(p.category,'nuts');assert.ok(p.price_krw<=60000)}});
test('diff includes nested changes without mutating previous state',()=>{const a=initial(),b=apply(a,{budget:{amount_krw:50000}});assert.equal(a.budget.amount_krw,null);assert.deepEqual(differences(a,b),[{field:'budget.amount_krw',before:null,after:50000}])});
test('equal preference ranks by review count before price',()=>{
 const p=(id,price,rating_count)=>({...products[0],id,price_krw:price,shipping_fee_per_set_krw:0,rating_count,allergens_declared:[]});
 const r=recommend([p('cheap',5000,10),p('popular',28000,9000),p('mid',15000,500)],apply(initial(),{budget:{amount_krw:30000}}));
 assert.deepEqual(r.items.map(x=>x.id),['popular','mid','cheap']);
});
test('review counts compare within each category so one loud category cannot take every slot',()=>{
 const p=(id,category,price,rating_count)=>({...products[0],id,category,price_krw:price,shipping_fee_per_set_krw:0,rating_count,allergens_declared:[]});
 const data=[p('ear1','audio',12000,300000),p('ear2','audio',20000,200000),p('ear3','audio',22000,190000),p('tea1','coffee_tea',25000,800),p('tea2','coffee_tea',9000,90)];
 assert.deepEqual(recommend(data,apply(initial(),{budget:{amount_krw:30000}})).items.map(x=>x.id),['ear1','tea1','ear2']);
});
test('recipient categories add a small boost that explicit tastes still outrank',()=>{
 const p=(id,category,price,rating_count)=>({...products[0],id,category,price_krw:price,shipping_fee_per_set_krw:0,rating_count,allergens_declared:[]});
 const data=[p('ear','audio',12000,300000),p('vit','health',25000,900),p('mug','kitchen',18000,700)];
 const base={budget:{amount_krw:30000}};
 assert.deepEqual(recommend(data,apply(initial(),{...base,recipients:['어머니']})).items.map(x=>x.id),['vit','mug','ear']);
 assert.deepEqual(recommend(data,apply(initial(),{...base,recipients:['어머니'],preferences:['category:audio']})).items[0].id,'ear');
 assert.deepEqual(recommend(data,apply(initial(),{...base,recipients:['동창']})).items[0].id,'ear');
});
test('category leaders tie-break by absolute reviews, not price',()=>{
 const p=(id,category,price,rating_count)=>({...products[0],id,category,price_krw:price,shipping_fee_per_set_krw:0,rating_count,allergens_declared:[]});
 assert.deepEqual(recommend([p('box','decor',12000,900),p('tea','coffee_tea',28000,20000)],apply(initial(),{budget:{amount_krw:30000}})).items.map(x=>x.id),['tea','box']);
});
test('rule parsing recognises common family and work recipients',()=>{for(const who of ['어머니','아버지','동료','동창'])assert.deepEqual(extract(`${who} 선물`,initial()).patch.recipients,[who]);});
test('taste words become category preferences, or exclusions with a removal verb',()=>{
 assert.deepEqual(extract('운동 좋아하는 친구 선물',initial()).patch.preferences,['category:fitness']);
 assert.deepEqual(extract('향수 같은 거',initial()).patch.preferences,['category:beauty']);
 assert.deepEqual(extract('이어폰이나 스피커',initial()).patch.preferences,['category:audio']);
 assert.deepEqual(extract('시계는 빼줘',initial()).patch.excluded_categories,['watch']);
 assert.equal(extract('시계는 빼줘',initial()).patch.preferences,undefined);
});
