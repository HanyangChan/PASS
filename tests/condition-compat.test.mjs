import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeConditions} from '../lib/condition-compat.mjs';
import {singleInitial} from '../lib/single-gift.mjs';
import {validateState} from '../lib/llm.mjs';
test('legacy food conditions map to canonical categories without dropping nut avoidance',()=>{
 const original={...singleInitial(),recipients:['부모님'],preferences:['category:tea','category:coffee','less_sweet'],excluded_categories:['nuts','fruit','hangwa','oil'],excluded_ingredients:['우유'],budget:{amount_krw:50000,shipping_included:true},delivery_by:'2026-12-20',packaging:'formal'};
 const before=structuredClone(original),{state,notices}=normalizeConditions(original);
 assert.deepEqual(state.preferences,['category:coffee_tea','less_sweet']);
 assert.deepEqual(state.excluded_categories,['food','snack']);
 assert.deepEqual(state.excluded_ingredients,['우유','견과류']);
 assert.deepEqual(state.budget,original.budget);
 assert.equal(state.delivery_by,original.delivery_by);assert.equal(state.packaging,'formal');
 assert.deepEqual(original,before);assert.ok(notices.length);validateState(state);
 assert.deepEqual(normalizeConditions(state),{state,notices:[]});
});
test('all legacy preferences have an explicit mapping and unsupported values still fail validation',()=>{
 const result=normalizeConditions({...singleInitial(),preferences:['category:fruit','category:hangwa','category:nuts','category:oil'],excluded_categories:['coffee','tea']});
 assert.deepEqual(result.state.preferences,['category:food','category:snack']);
 assert.deepEqual(result.state.excluded_categories,['coffee_tea']);validateState(result.state);
 const unknown=normalizeConditions({...singleInitial(),preferences:['category:unknown']});
 assert.deepEqual(unknown.state.preferences,['category:unknown']);assert.throws(()=>validateState(unknown.state));
});
