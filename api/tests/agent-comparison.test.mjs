import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, summarize } from '../benchmarks/agent-comparison.mjs';
import { singleInitial, engineState } from '../../lib/single-gift.mjs';
import { recommend } from '../../lib/engine.mjs';
import { products } from '../../baseline/examples/catalog.mjs';
const state={...singleInitial(),recipients:['어머니'],budget:{amount_krw:50000,shipping_included:true},excluded_ingredients:['우유']};
const output=()=>({session:{state:structuredClone(state)},question:{key:null},view:{result:recommend(products,engineState(state))},message:'차 선물 세트 33,000원',routing:{intent:'explain'}});
test('comparison grader rejects lost constraints, bad ranks and explanations without evidence',()=>{
  assert.ok(evaluate(output(),200,{expectedState:state,explain:true},products).every(c=>c.passed));
  const lost=output();lost.session.state.excluded_ingredients=[];assert.ok(evaluate(lost,200,{expectedState:state},products).some(c=>c.id==='state.excluded_ingredients'&&!c.passed));
  const wrong=output();wrong.view.result.items.reverse();assert.ok(evaluate(wrong,200,{expectedState:state},products).some(c=>c.id==='recommendation_ids'&&!c.passed));
  const noEvidence=output();noEvidence.message='추천했어요';assert.ok(evaluate(noEvidence,200,{expectedState:state,explain:true},products).some(c=>c.id==='explanation_evidence'&&!c.passed));
});
test('comparison accuracy counts failed requests and latency includes failures',()=>{
  const checks=evaluate({},503,{expectedState:state},products);assert.equal(checks[0].passed,false);
  const summary=summarize([{passed:true,latencyMs:100,turns:[{checks:[{passed:true}],status:200,llmCalls:1}]},{passed:false,latencyMs:900,turns:[{checks,status:503,llmCalls:1}]}]);
  assert.equal(summary.taskAccuracy,.5);assert.equal(summary.meanLatencyMs,500);assert.equal(summary.meanSuccessfulLatencyMs,100);assert.equal(summary.httpErrors,1);
});
