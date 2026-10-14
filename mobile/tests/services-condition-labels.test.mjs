import test from 'node:test';
import assert from 'node:assert/strict';
import {CATEGORY_NAMES} from '../../lib/catalog.mjs';
import {singleInitial} from '../../lib/single-gift.mjs';
import {conditionLabel,conditionValue,normalizeEditedConditions} from '../src/services/conditionLabels.ts';
test('every new category round trips through the condition editor',()=>{
 for(const [category,label] of Object.entries(CATEGORY_NAMES)){
  assert.equal(conditionLabel(`category:${category}`),label);
  assert.equal(conditionValue(label,'preferences'),`category:${category}`);
  assert.equal(conditionValue(label,'excluded_categories'),category);
 }
 assert.equal(conditionValue('우유','excluded_ingredients'),'우유');
});
test('old Korean labels are converted and require review before apply',()=>{
 const result=normalizeEditedConditions({...singleInitial(),preferences:[conditionValue('차','preferences')],excluded_categories:[conditionValue('견과류','excluded_categories')],excluded_ingredients:['우유']});
 assert.deepEqual(result.state.preferences,['category:coffee_tea']);
 assert.deepEqual(result.state.excluded_categories,[]);
 assert.deepEqual(result.state.excluded_ingredients,['우유','견과류']);
 assert.ok(result.notices.length);
 assert.deepEqual(normalizeEditedConditions(result.state).notices,[]);
 assert.throws(()=>normalizeEditedConditions({...singleInitial(),excluded_categories:['없는 상품군']}));
});
