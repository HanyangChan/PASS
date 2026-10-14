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
