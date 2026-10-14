import test from 'node:test';
import assert from 'node:assert/strict';
import {CATEGORIES,CATEGORY_NAMES,toEngineProduct,fetchCatalog,cachedCatalog,todayKst} from '../lib/catalog.mjs';
const row={id:'amz-B000000001',name:'타타 골드 홍차',name_en:'Tata Tea Gold',category:'coffee_tea',description:'커피·차',price_krw:20000,shipping_fee_krw:3000,stock:99,arrival_days:3,packaging:'basic',sweetness:'unknown',brand:'Tata',allergens:['우유'],rating:4.5,rating_count:120,image_url:'https://m.media-amazon.com/a.jpg',source_url:'https://www.amazon.in/dp/B000000001',demo_fields:['stock']};
test('16 categories each have a Korean name',()=>{assert.equal(CATEGORIES.length,16);for(const c of CATEGORIES)assert.ok(CATEGORY_NAMES[c],c);});
test('rows become engine products dated from today',()=>{
 const p=toEngineProduct(row,'2026-10-30');
 assert.equal(p.arrival_date,'2026-11-02');assert.equal(p.shipping_fee_per_set_krw,3000);assert.equal(p.stock_sets,99);
 assert.deepEqual(p.allergens_declared,['우유']);assert.equal(p.allergen_information_complete,false);
 assert.equal(p.image,row.image_url);assert.equal(p.link,row.source_url);assert.equal(p.rating,4.5);
});
test('KST date rolls over at 15:00 UTC',()=>assert.equal(todayKst(Date.UTC(2026,9,14,15,0)),'2026-10-15'));
test('catalog pages until a short page and sends the public key',async()=>{
 const urls=[];const fetcher=async(url,init)=>{urls.push(url);assert.equal(init.headers.apikey,'sb_publishable_x');const offset=Number(new URL(url).searchParams.get('offset'));return Response.json(Array.from({length:offset===0?2:1},(_,i)=>({id:`r${offset+i}`})));};
 const rows=await fetchCatalog({url:'https://p.supabase.co/',key:'sb_publishable_x',fetcher,pageSize:2});
 assert.deepEqual(rows.map(r=>r.id),['r0','r1','r2']);assert.equal(urls.length,2);
 assert.match(urls[0],/^https:\/\/p\.supabase\.co\/rest\/v1\/products\?is_active=eq\.true&select=/);
 await assert.rejects(fetchCatalog({url:'https://p.supabase.co',key:'k',fetcher:async()=>new Response('',{status:500})}),/catalog_http_500/);
});
test('cache serves within TTL, keeps stale data on failure, throws when empty',async()=>{
 let t=0,calls=0,fail=false;const c=cachedCatalog(async()=>{calls++;if(fail)throw Error('down');return [calls];},{ttlMs:10,now:()=>t});
 assert.deepEqual(await c(),[1]);assert.deepEqual(await c(),[1]);assert.equal(calls,1);
 t=20;fail=true;assert.deepEqual(await c(),[1]);
 await assert.rejects(cachedCatalog(async()=>{throw Error('down');})(),/down/);
});
