import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogCandidateCount, scoreTurn } from '../benchmarks/amazon-en/scoring.mjs';

test('benchmark catalog coverage applies the same hard criteria as recommendation scoring', () => {
  const spec={categories:['stationery'],budget:20000,deliveryBy:'2026-12-03'};
  const available={id:'pen',category:'stationery',stock_sets:1,price_krw:17000,shipping_fee_per_set_krw:3000,arrival_date:'2026-12-03'};
  const products=[available,{...available,id:'expensive',price_krw:18000},
    {...available,id:'late',arrival_date:'2026-12-04'},{...available,id:'empty',stock_sets:0},
    {...available,id:'unclassified',category:'unmapped'}];
  const grouped=Map.groupBy(products, product=>product.category);
  assert.equal(catalogCandidateCount(spec,grouped),1);
  assert.equal(catalogCandidateCount({...spec,budget:19000},grouped),0);
  assert.equal(catalogCandidateCount({...spec,quantity:2},grouped),null);
  assert.equal(catalogCandidateCount({expectedIds:['pen']},grouped),null);
  const data={session:{state:{budget:{amount_krw:20000,shipping_included:true},delivery_by:'2026-12-03'}},question:{key:null}};
  const score=scoreTurn(spec,data,200,products.map(product=>product.id),new Map(products.map(product=>[product.id,product])),{});
  assert.equal(score.eligibleItems,1);
  assert.equal(score.answeredWithEligibleRecommendation,true);
});
