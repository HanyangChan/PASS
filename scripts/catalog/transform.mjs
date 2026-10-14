import {tagAllergens} from '../../lib/allergens.mjs';
import {CATEGORY_NAMES} from '../../lib/catalog.mjs';
export const RUPEE_TO_KRW=16;
// Korean gift price-level correction (design 2026-10-14). Deliberately not shown in the app.
export const PRICE_LEVEL=2;
// Single snack packs (₹10–₹149) are not gifts and would win the engine's cheapest-first tie-break.
export const MIN_INR=150;
export const SUBCATEGORIES=['Coffee, Tea & Beverages','Snack Foods','All Grocery & Gourmet Foods','Diet & Nutrition','Make-up','Beauty & Grooming','Luxury Beauty','Personal Care Appliances','Kitchen & Dining','Home Décor','Watches','Fashion & Silver Jewellery','Handbags & Clutches','Wallets','Sunglasses','Headphones','Speakers','Toys & Games','Fitness Accessories','Yoga'];
export function parseCsv(text){
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){const ch=text[i];
  if(quoted){if(ch==='"'){if(text[i+1]==='"'){field+='"';i++;}else quoted=false;}else field+=ch;}
  else if(ch==='"')quoted=true;else if(ch===','){row.push(field);field='';}
  else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(field);rows.push(row);row=[];field='';}
  else field+=ch;}
 if(field||row.length){row.push(field);rows.push(row);}
 const [head,...body]=rows;const keys=head.map(h=>h.replace(/^﻿/,''));
 return body.filter(r=>r.length===keys.length).map(r=>Object.fromEntries(keys.map((k,i)=>[k,r[i]])));
}
export const asinOf=link=>String(link??'').match(/\/dp\/([A-Z0-9]{10})/)?.[1]??null;
export const amount=text=>{const t=String(text??'').replace(/[^0-9.]/g,'');return t?Number(t):null;};
// Scraped URLs with an /images/W/<render-id>/ segment now answer 400; the plain path still serves.
export const imageUrl=url=>String(url).replace(/\/images\/W\/[^/]+\//,'/');
export const priceKrw=inr=>Math.max(100,Math.round(inr*RUPEE_TO_KRW*PRICE_LEVEL/100)*100);
export function candidates(rows,perGroup=200){
 const best=new Map();
 for(const r of rows){
  if(!SUBCATEGORIES.includes(r.sub_category))continue;
  const asin=asinOf(r.link),inr=amount(r.discount_price)??amount(r.actual_price),rating=amount(r.ratings),count=amount(r.no_of_ratings);
  if(!asin||!inr||inr<MIN_INR||!rating||rating<3.5||!count||count<20||!String(r.image).startsWith('https://'))continue;
  if((best.get(asin)?.count??-1)<count)best.set(asin,{asin,name:r.name.trim(),sub_category:r.sub_category,image:imageUrl(r.image),link:`https://www.amazon.in/dp/${asin}`,inr,rating,count});
 }
 // Amazon colour/size variants share one review pool: same brand word, rating and review count.
 const variants=new Map();
 for(const c of [...best.values()].sort((a,b)=>a.asin.localeCompare(b.asin))){const key=`${c.name.split(/\s+/)[0].toLowerCase()}|${c.rating}|${c.count}`;if(!variants.has(key))variants.set(key,c);}
 return [...Map.groupBy(variants.values(),c=>c.sub_category).values()].flatMap(group=>group.sort((a,b)=>b.count-a.count||a.asin.localeCompare(b.asin)).slice(0,perGroup));
}
const hash=text=>[...text].reduce((h,ch)=>(h*31+ch.charCodeAt(0))>>>0,7);
export function toRow(c,{name_ko,category}){
 const price_krw=priceKrw(c.inr);
 return {id:`amz-${c.asin}`,name:name_ko,name_en:c.name,category,description:CATEGORY_NAMES[category],price_krw,
  shipping_fee_krw:price_krw>=30000?0:3000,stock:99,arrival_days:2+hash(c.asin)%3,
  packaging:/\b(gift|hamper|combo|set|box)\b/i.test(c.name)?'formal':'basic',
  sweetness:/sugar[- ]?free|no added sugar|unsweetened|zero sugar/i.test(c.name)||/무가당|무설탕/.test(name_ko)?'unsweetened':'unknown',
  brand:c.name.split(/\s+/)[0].replace(/[^\p{L}\p{N}&'-]/gu,'')||null,allergens:tagAllergens(`${c.name} ${name_ko}`),
  rating:c.rating,rating_count:c.count,image_url:c.image,source:'amazon-kaggle',source_url:c.link,
  demo_fields:['shipping_fee_krw','arrival_days','stock','packaging'],is_active:true};
}
