import test from 'node:test';
import assert from 'node:assert/strict';
import {translateBatch,translateAll} from '../scripts/catalog/translate.mjs';
const cand=asin=>({asin,name:`Product ${asin}`,sub_category:'Snack Foods'});
const reply=items=>Response.json({candidates:[{content:{parts:[{text:JSON.stringify({items})}]}}]});
test('batch keeps only requested ids with valid fields',async()=>{
 let sent;const out=await translateBatch([cand('A1'),cand('A2'),cand('A3')],{apiKey:'k',fetcher:async(url,init)=>{sent={url,init};return reply([{id:'A1',name_ko:'과자',category:'snack'},{id:'A2',name_ko:'x',category:'shoes'},{id:'ZZ',name_ko:'y',category:'snack'},{id:'A3',name_ko:'  ',category:'snack'}]);}});
 assert.deepEqual(out,{A1:{name_ko:'과자',category:'snack'}});
 assert.match(sent.url,/models\/gemini-3\.5-flash-lite:generateContent$/);assert.equal(sent.init.headers['x-goog-api-key'],'k');
 assert.deepEqual(JSON.parse(JSON.parse(sent.init.body).contents[0].parts[0].text)[0],{id:'A1',name:'Product A1',sub_category:'Snack Foods'});
});
test('HTTP failures surface as Gemini errors',async()=>{await assert.rejects(translateBatch([cand('A1')],{apiKey:'k',fetcher:async()=>Response.json({},{status:429})}),/quota_exceeded/);});
test('all skips cached ids, batches, waits between batches and saves each batch',async()=>{
 const cache={A1:{name_ko:'기존',category:'snack'}};const calls=[],sleeps=[],saves=[];
 await translateAll(['A1','A2','A3','A4'].map(cand),cache,{apiKey:'k',batchSize:2,minIntervalMs:7,sleep:async ms=>sleeps.push(ms),onBatch:c=>saves.push(Object.keys(c).length),
  fetcher:async(url,init)=>{const ids=JSON.parse(JSON.parse(init.body).contents[0].parts[0].text).map(i=>i.id);calls.push(ids);return reply(ids.map(id=>({id,name_ko:`상품 ${id}`,category:'food'})));}});
 assert.deepEqual(calls,[['A2','A3'],['A4']]);assert.deepEqual(sleeps,[7]);assert.deepEqual(saves,[3,4]);assert.equal(cache.A1.name_ko,'기존');
});
