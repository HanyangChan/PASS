import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCsv,asinOf,priceKrw,candidates,toRow} from '../scripts/catalog/transform.mjs';
const csv='﻿name,main_category,sub_category,image,link,ratings,no_of_ratings,discount_price,actual_price\r\n'+
 '"Tata Tea Gold, 500g",grocery,"Coffee, Tea & Beverages",https://m.media-amazon.com/a.jpg,https://www.amazon.in/Tata/dp/B000000001/ref=sr_1,4.3,"1,200",₹285,₹300\r\n'+
 '"He said ""hi"" cookies",grocery,Snack Foods,https://m.media-amazon.com/b.jpg,https://www.amazon.in/x/dp/B000000002/ref=sr,3.9,50,,₹100\r\n';
const cand=(asin,sub,count,extra={})=>({name:`P ${asin}`,main_category:'x',sub_category:sub,image:'https://m.media-amazon.com/i.jpg',link:`https://www.amazon.in/p/dp/${asin}/ref=1`,ratings:'4.0',no_of_ratings:String(count),discount_price:'₹500',actual_price:'₹600',...extra});
test('CSV handles BOM, quoted commas, escaped quotes and CRLF',()=>{
 const rows=parseCsv(csv);assert.equal(rows.length,2);
 assert.equal(rows[0].name,'Tata Tea Gold, 500g');assert.equal(rows[0].sub_category,'Coffee, Tea & Beverages');
 assert.equal(rows[1].name,'He said "hi" cookies');assert.equal(rows[1].discount_price,'');
});
test('ASIN and price conversion',()=>{assert.equal(asinOf('https://www.amazon.in/a/dp/B0BRKXTSBT/ref=sr_1_4'),'B0BRKXTSBT');assert.equal(asinOf('https://x'),null);assert.equal(priceKrw(285),9100);assert.equal(priceKrw(1),100);});
test('candidates filter, dedupe by ASIN and cap each subcategory',()=>{
 const rows=[cand('B000000001','Snack Foods',30),cand('B000000001','Snack Foods',90),cand('B000000002','Snack Foods',80),cand('B000000003','Snack Foods',70),
  cand('B000000004','Snack Foods',10),cand('B000000005','Snack Foods',99,{ratings:'3.0'}),cand('B000000006','Air Conditioners',999),cand('B000000007','Snack Foods',60,{discount_price:'',actual_price:''})];
 const out=candidates(rows,2);
 assert.deepEqual(out.map(c=>[c.asin,c.count]),[['B000000001',90],['B000000002',80]]);
 assert.equal(out[0].link,'https://www.amazon.in/dp/B000000001');assert.equal(out[0].inr,500);
 assert.equal(candidates(parseCsv(csv),200)[1].inr,100);
});
test('rows are deterministic with synthesized demo fields and allergen tags',()=>{
 const c={asin:'B000000009',name:'Sunfeast Gift Box cookies with milk',sub_category:'Snack Foods',image:'https://m.media-amazon.com/i.jpg',link:'https://www.amazon.in/dp/B000000009',inr:285,rating:4.2,count:500};
 const r=toRow(c,{name_ko:'선피스트 쿠키 선물 상자',category:'snack'});
 assert.deepEqual(r,toRow(c,{name_ko:'선피스트 쿠키 선물 상자',category:'snack'}));
 assert.equal(r.id,'amz-B000000009');assert.equal(r.price_krw,9100);assert.equal(r.shipping_fee_krw,3000);
 assert.equal(r.packaging,'formal');assert.equal(r.brand,'Sunfeast');assert.equal(r.description,'과자·간식');
 assert.ok(r.arrival_days>=2&&r.arrival_days<=4);assert.deepEqual(r.allergens.sort(),['밀','우유'].sort());
 assert.deepEqual(r.demo_fields,['shipping_fee_krw','arrival_days','stock','packaging']);
 assert.equal(toRow({...c,inr:1000},{name_ko:'x',category:'snack'}).shipping_fee_krw,0);
 assert.equal(toRow({...c,name:'Sugar Free Mints'},{name_ko:'x',category:'snack'}).sweetness,'unsweetened');
});
