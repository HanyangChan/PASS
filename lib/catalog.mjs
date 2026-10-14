export const CATALOG_ID='amazon-kaggle-v1';
export const CATEGORIES=['food','snack','coffee_tea','health','beauty','makeup','personal_care','kitchen','decor','jewelry','watch','bag','accessory','audio','toy','fitness'];
export const CATEGORY_NAMES={food:'식품',snack:'과자·간식',coffee_tea:'커피·차',health:'건강식품',beauty:'뷰티',makeup:'메이크업',personal_care:'생활가전',kitchen:'주방용품',decor:'홈데코',jewelry:'주얼리',watch:'시계',bag:'가방',accessory:'패션소품',audio:'음향기기',toy:'장난감',fitness:'운동용품'};
const COLUMNS='id,name,name_en,category,description,price_krw,shipping_fee_krw,stock,arrival_days,packaging,sweetness,brand,allergens,rating,rating_count,image_url,source_url,demo_fields';
export const todayKst=(now=Date.now())=>new Date(now+9*3600e3).toISOString().slice(0,10);
const addDays=(day,n)=>{const d=new Date(`${day}T00:00:00Z`);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
// DB rows keep relative demo arrival days; the engine compares absolute dates.
export function toEngineProduct(row,today){
 return {id:row.id,name:row.name,name_en:row.name_en??undefined,category:row.category,description:row.description??'',price_krw:row.price_krw,shipping_fee_per_set_krw:row.shipping_fee_krw??0,stock_sets:row.stock??0,arrival_date:addDays(today,row.arrival_days??3),packaging:row.packaging??'basic',sweetness:row.sweetness??'unknown',brand:row.brand??null,allergens_declared:row.allergens??[],allergen_information_complete:false,ingredients:[],image:row.image_url??undefined,link:row.source_url??undefined,rating:row.rating==null?undefined:Number(row.rating),rating_count:row.rating_count??0,demo_fields:row.demo_fields??[]};
}
export async function fetchCatalog({url,key,fetcher=fetch,pageSize=1000}){
 const base=`${url.replace(/\/$/,'')}/rest/v1/products?is_active=eq.true&select=${COLUMNS}&order=id&limit=${pageSize}`;const rows=[];
 for(let offset=0;;offset+=pageSize){
  const response=await fetcher(`${base}&offset=${offset}`,{headers:{apikey:key},signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error(`catalog_http_${response.status}`);
  const page=await response.json();rows.push(...page);
  if(page.length<pageSize)return rows;
 }
}
// One copy per process/isolate; a failed refresh keeps serving the previous copy.
export function cachedCatalog(load,{ttlMs=600000,now=Date.now}={}){
 let items=null,loadedAt=0,pending=null;
 return async()=>{
  if(items&&now()-loadedAt<ttlMs)return items;
  pending??=load().then(value=>{items=value;loadedAt=now();return value;}).finally(()=>{pending=null;});
  try{return await pending;}catch(error){if(items)return items;throw error;}
 };
}
