import test from 'node:test';
import assert from 'node:assert/strict';
import { recommend, APP_RANKING } from '../lib/engine.mjs';
import { productTypes } from '../lib/ranking.mjs';
import { recipientAge } from '../lib/catalog.mjs';
import { product, state } from './fixtures/context-feedback.mjs';
import { createLocalChatService } from '../mobile/src/services/chatService.ts';

test('missing requested flowers produce an honest empty result, not unrelated food', async () => {
  const data=[product('nuts','food',{name:'견과류 선물세트'})];
  const s=state({preferences:['category:flower','type:bouquet']});
  const result=recommend(data,s,APP_RANKING);
  assert.equal(result.status,'no_match'); assert.deepEqual(result.items,[]);
  assert.match(result.message,/요청한 상품 종류/);
  const service=createLocalChatService(data);
  const turn=await service.send(service.createSession(),'어머니 꽃다발 선물 5만원 배송비 포함');
  assert.deepEqual(service.view(turn.session).result.items,[]);
  assert.match(turn.message,/요청한 상품 종류/);
});

test('one matching watch is returned alone instead of filling the other slots with food',()=>{
  const data=[product('watch','watch'),product('tea'),product('food','food')];
  assert.deepEqual(recommend(data,state({preferences:['category:watch']}),APP_RANKING).items.map(p=>p.id),['watch']);
  assert.equal(recommend(data,state({preferences:['category:watch']})).items.length,3,'unconfigured shared core preserves legacy behavior');
});

test('a coffee drip bag is not classified as tea just because the title says tea bag',()=>{
  const coffee=product('coffee','coffee_tea',{name:'콜롬비아 드립백 선물세트 티백 원두 커피'});
  const tea=product('tea','coffee_tea',{name:'전통차 선물세트 티백'});
  assert.deepEqual(productTypes(coffee),['type:coffee']);
  assert.deepEqual(recommend([coffee,tea],state({preferences:['category:coffee_tea','type:tea']}),APP_RANKING).items.map(p=>p.id),['tea']);
});

test('writing implements exclude planners and bulk erasers even when all are stationery',()=>{
  const data=[product('pen','stationery',{name:'볼펜 선물세트'}),product('planner','stationery',{name:'스터디 플래너'}),product('eraser','stationery',{name:'지우개 60개 세트'})];
  assert.deepEqual(recommend(data,state({preferences:['type:writing']}),APP_RANKING).items.map(p=>p.id),['pen']);
});

test('explicit high-school age is retained and does not imply an elementary-school child',()=>{
  assert.equal(recipientAge(['고등학생 조카']),'teen'); assert.equal(recipientAge(['초등학생 조카']),'child');
  const data=[product('child','stationery',{name:'초등학생 어린이날 볼펜 60개 세트'}),product('teen','stationery',{name:'볼펜 선물세트'})];
  assert.deepEqual(recommend(data,state({recipients:['고등학생 조카'],preferences:['category:stationery']}),APP_RANKING).items.map(p=>p.id),['teen']);
});

test('generic elder wellness request favors a physical comfort gift over bodybuilding nutrition',()=>{
  const data=[product('sports','health',{name:'BCAA 프로틴 파우더',rating_count:10000}),product('comfort','health',{name:'온열 찜질기',rating_count:1})];
  assert.equal(recommend(data,state({recipients:['할머니'],preferences:['category:health']}),APP_RANKING).items[0].id,'comfort');
});

test('a non-drinker office gift does not rank wine glasses before an equally priced neutral gift',()=>{
  const data=[product('wine','kitchen',{name:'와인잔 선물세트',rating_count:1000}),product('tea','coffee_tea',{name:'전통차 선물세트',rating_count:1})];
  assert.equal(recommend(data,state({recipients:['상사'],excluded_categories:['liquor']}),APP_RANKING).items[0].id,'tea');
});

test('excluding wine does not silently exclude every other type of liquor',async()=>{
  const data=[product('wine','liquor',{name:'레드 와인 선물세트'}),product('rice','liquor',{name:'전통주 막걸리 선물세트'})];
  const service=createLocalChatService(data);
  const turn=await service.send(service.createSession(),'친구 결혼 축하 선물 배송비 합쳐 십만원. 와인은 말고');
  assert.deepEqual(turn.session.state.excluded_categories,[]);
  assert.ok(turn.session.state.preferences.includes('avoid_wine'));
  assert.ok(service.view(turn.session).result.items.every(p=>p.id!=='wine'));
  assert.equal(recommend(data,state({preferences:['category:liquor','avoid_wine']}),APP_RANKING).items[0].id,'rice');
});
