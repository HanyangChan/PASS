import test from 'node:test';
import assert from 'node:assert/strict';
import { parseConditions, classifyIntent } from '../parser.mjs';
import { initial } from '../../../src/vendor/engine.mjs';
const ready=()=>({...initial(),recipients:['어머니'],quantity:1,same_product:true,budget:{amount_krw:50000,scope:'per_set',shipping_included:true},preferences:['category:coffee_tea','type:tea']});
test('shipping aliases express cost scope while contradictions remain a question',()=>{
  assert.equal(parseConditions('택배비 빼고 삼만원. 받는 사람은 직장 동료야',initial()).patch.budget.shipping_included,false);
  assert.equal(parseConditions('엄마 5만원 택배비 포함, 배송료 별도',initial()).unresolved,true);
});
test('an explicit previous-budget correction works only when the old amount is the current one',()=>{
  assert.equal(parseConditions('예산은 5만이었는데 삼만오천원으로 낮춰. 배송료까지 포함해서',ready()).patch.budget.amount_krw,35000);
  assert.equal(parseConditions('예산 8만원이었는데 3만원으로 낮춰',ready()).unresolved,true);
});
test('a named old-recipient contrast changes ownership without carrying the old tastes',()=>{
  const out=parseConditions('그건 엄마 거였고 이번에는 커피 안 마시는 친구 줄 거야. 배송 포함 사만원',ready());
  assert.equal(out.unresolved,false); assert.deepEqual(out.patch.recipients,['친구']);
  assert.deepEqual(out.patch.excluded_categories,['coffee_tea']);
});
test('an explicit product replacement removes the old category and its subtype',()=>{
  const out=parseConditions('차보다는 시계 쪽으로 골라봐',ready());
  assert.deepEqual(out.patch.preferences,['category:watch']);
});
test('subtypes and stated school age survive parsing',()=>{
  assert.deepEqual(parseConditions('꽃다발로 바꿔줘',ready()).patch.preferences,['category:flower','type:bouquet']);
  assert.ok(parseConditions('필기구로 추천해줘',ready()).patch.preferences.includes('type:writing'));
  assert.deepEqual(parseConditions('고등학생 조카 선물 3만원 배송비 포함',initial()).patch.recipients,['고등학생 조카']);
});
test('unknown constraints are not swallowed by the new connective handling',()=>{
  for(const text of ['엄마 선물 5만원 배송료 포함인데 저자극성 인증 제품만','생신인데 5만원 택배비 포함, 달 착륙에 쓸 수 있는 것'])
    assert.equal(parseConditions(text,initial()).unresolved,true);
});
test('invalid dates stay atomic and job-title aliases keep their established canonical form',()=>{
  const out=parseConditions('엄마 선물 5만원 배송비 포함. 2026년 11월 31일까지',initial());
  assert.equal(out.unresolved,true); assert.deepEqual(out.patch,{});
  assert.deepEqual(parseConditions('직장 상사에게 드릴 선물이에요. 택배비 제외하고 6만 원까지요',initial()).patch.recipients,['직장 상사']);
});
test('an iramyeon hypothetical comparison never becomes a budget mutation',()=>{
  assert.deepEqual(classifyIntent('예산 10만원이라면 뭐가 달라져?',ready()),{kind:'what_if_budget',amount_krw:100000,intent:'compare_budget'});
});
