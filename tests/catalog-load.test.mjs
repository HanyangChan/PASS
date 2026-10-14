import test from 'node:test';
import assert from 'node:assert/strict';
import {load,validateRows} from '../scripts/catalog/load.mjs';
const row=i=>({id:`amz-B${String(i).padStart(9,'0')}`,name:`상품 ${i}`,name_en:`P ${i}`,category:'snack',description:'과자·간식',price_krw:9100,shipping_fee_krw:3000,stock:99,arrival_days:3,packaging:'basic',sweetness:'unknown',brand:'X',allergens:[],rating:4,rating_count:50,image_url:'https://m.media-amazon.com/i.jpg',source:'amazon-kaggle',source_url:'https://www.amazon.in/dp/B000000001',demo_fields:[],is_active:true});
const fake=(active)=>{const calls=[];return {calls,fetcher:async(url,init)=>{calls.push({url:String(url),method:init.method,headers:init.headers,body:init.body});return init.method==='GET'?Response.json(active.map(id=>({id}))):new Response(null,{status:201});}};};
test('validation rejects duplicates, bad categories and insecure URLs',()=>{
 assert.throws(()=>validateRows([row(1),row(1)]),/중복/);
 assert.throws(()=>validateRows([{...row(1),category:'shoes'}]),/필드/);
 assert.throws(()=>validateRows([{...row(1),image_url:'http://x'}]),/필드/);
});
test('dry run only reads',async()=>{const f=fake([]);const r=await load([row(1)],{url:'https://p.supabase.co',key:'sb_secret_x',fetcher:f.fetcher,dryRun:true,log:()=>{}});assert.deepEqual(r,{upserted:0,deactivated:0});assert.ok(f.calls.every(c=>c.method==='GET'));});
test('upserts in batches of 500 and deactivates stale rows',async()=>{
 const rows=Array.from({length:1200},(_,i)=>row(i));const f=fake([rows[0].id,'amz-OLD0000001']);
 const r=await load(rows,{url:'https://p.supabase.co/',key:'sb_secret_x',fetcher:f.fetcher,log:()=>{}});
 const posts=f.calls.filter(c=>c.method==='POST'),patches=f.calls.filter(c=>c.method==='PATCH');
 assert.deepEqual(posts.map(c=>JSON.parse(c.body).length),[500,500,200]);
 assert.match(posts[0].url,/\/rest\/v1\/products\?on_conflict=id$/);assert.match(posts[0].headers.Prefer,/merge-duplicates/);
 assert.equal(patches.length,1);assert.match(patches[0].url,/id=in\.\(amz-OLD0000001\)/);assert.deepEqual(JSON.parse(patches[0].body),{is_active:false});
 assert.equal(posts[0].headers.apikey,'sb_secret_x');assert.equal(posts[0].headers.Authorization,undefined);
 assert.deepEqual(r,{upserted:1200,deactivated:1});
});
test('small inputs never deactivate the existing catalog; legacy JWT keys also send Authorization',async()=>{
 const f=fake(['amz-OLD0000001']);const logs=[];
 const r=await load([row(1)],{url:'https://p.supabase.co',key:'eyJ.legacy.jwt',fetcher:f.fetcher,log:m=>logs.push(m)});
 assert.equal(r.deactivated,0);assert.ok(!f.calls.some(c=>c.method==='PATCH'));assert.match(logs.join('\n'),/비활성화하지 않습니다/);
 assert.equal(f.calls[0].headers.Authorization,'Bearer eyJ.legacy.jwt');
});
test('committed seed data passes loader validation and carries no awkward health items',async()=>{
 const {readFileSync}=await import('node:fs');const {awkward}=await import('../scripts/catalog/transform.mjs');
 const rows=JSON.parse(readFileSync(new URL('../supabase/seed/products-amazon.json',import.meta.url)));
 assert.ok(validateRows(rows).length>=1000);
 assert.deepEqual(rows.filter(r=>awkward(r.name_en,r.category)).map(r=>r.id),[]);
});
