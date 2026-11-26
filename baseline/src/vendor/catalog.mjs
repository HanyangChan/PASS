export const CATALOG_ID='amazon-kaggle-v1';
export const CATEGORIES=['food','snack','coffee_tea','health','beauty','makeup','personal_care','kitchen','decor','jewelry','watch','bag','accessory','audio','toy','fitness','flower','stationery','digital','liquor'];
// Recipient profile tags describe who the gift is for ("남자아이야", "60대 여성이에요") without replacing the recipient.
export const PROFILE_TAGS=['gender:male','gender:female','age:child','age:teen','age:adult','age:elder'];
export const PREFERENCE_TAGS=['less_sweet','unsweetened','type:tea','type:coffee','type:writing','type:bouquet','avoid_fragrance','avoid_wine',...CATEGORIES.map(c=>`category:${c}`),...PROFILE_TAGS];
export const CATEGORY_NAMES={food:'식품',snack:'과자·간식',coffee_tea:'커피·차',health:'건강식품',beauty:'뷰티',makeup:'메이크업',personal_care:'생활가전',kitchen:'주방용품',decor:'홈데코',jewelry:'주얼리',watch:'시계',bag:'가방',accessory:'패션소품',audio:'음향기기',toy:'장난감',fitness:'운동용품',flower:'꽃·식물',stationery:'문구',digital:'디지털기기',liquor:'주류'};
// Recipient groups → categories that usually suit them (ranking tabs and a +1 recommendation boost).
export const RECIPIENT_CATEGORIES={부모님:['health','food','coffee_tea','kitchen','decor'],친구:['beauty','makeup','jewelry','audio','snack'],직장동료:['coffee_tea','snack','decor','accessory','kitchen']};
// Partner and child profiles boost recommendations only; they are not ranking tabs.
const GROUP_CATEGORIES={...RECIPIENT_CATEGORIES,연인:['jewelry','watch','bag','accessory','beauty','audio'],아이:['toy','stationery','snack']};
const RECIPIENT_GROUPS=[['부모님',/부모|어머니|아버지|엄마|아빠|처가|시댁|장인|장모|할머니|할아버지|이모|삼촌|고모/],['연인',/연인|애인|남편|아내|와이프|여자\s*친구|남자\s*친구|여친|남친/],['친구',/(?<!여자\s*|남자\s*)친구|동창|선배|후배|언니|누나|오빠|^형$|동생/],['직장동료',/동료|상사|팀장|부장|직장|교수|선생/],['아이',/조카|아이|어린이|손주|손녀|아들|딸/]];
// Recipients whose gender the word itself tells; mixed or unknown gives null.
// 손주 is a grandchild of either gender (손자 = grandson, 손녀 = granddaughter).
const FEMALE=/어머니|엄마|할머니|여자|여친|아내|와이프|언니|누나|여동생|이모|고모|장모|딸|손녀|여아/, MALE=/아버지|아빠|할아버지|남자|남친|남편|오빠|^형$|남동생|삼촌|장인|아들|손자|남아/;
// A profile tag the user stated (gender:*, age:*) wins over what the recipient word suggests.
const profileTag=(preferences,kind)=>preferences?.find(p=>p.startsWith(`${kind}:`))?.slice(kind.length+1)??null;
export function recipientGender(recipients,preferences=[]){
 const stated=profileTag(preferences,'gender');
 if(stated)return stated;
 const genders=new Set(recipients.map(r=>FEMALE.test(r)?'female':MALE.test(r)?'male':null));
 return genders.size===1?[...genders][0]:null;
}
const BASIC_GROUPS=[['부모님',/부모|어머니|아버지|엄마|아빠|처가|시댁|장인|장모|할머니|할아버지/],['친구',/친구|동창|연인|애인/],['직장동료',/동료|상사|팀장|직장|교수|선생/]];
// `profiles` adds the partner/child/relative profiles and drops makeup for men (app ranking only).
// child / elder (parents and grandparents) / adult; unknown or mixed gives null.
const CHILD=/조카|어린이|아이$|손주|손녀|손자|남아|여아|초등학생|유치원/, ELDER=/부모|어머니|아버지|엄마|아빠|할머니|할아버지|장인|장모|시어머니|시아버지/;
export function recipientAge(recipients,preferences=[]){
 const stated=profileTag(preferences,'age');
 if(stated)return stated;
 const ages=new Set(recipients.map(r=>/중학생|고등학생|청소년/.test(r)?'teen':/성인|대학생/.test(r)?'adult':CHILD.test(r)?'child':ELDER.test(r)?'elder':RECIPIENT_GROUPS.some(([group,re])=>group!=='아이'&&re.test(r))?'adult':null));
 return ages.size===1?[...ages][0]:null;
}
// A stated age overrides the age a relation word implies: an adult 손주 does not get the child group's toys and snacks.
const GROUP_AGE={아이:'child',부모님:'elder'};
export const recipientCategories=(recipients,{profiles=false,preferences=[]}={})=>{
 const stated=profileTag(preferences,'age');
 const suited=new Set(recipients.flatMap(r=>(profiles?RECIPIENT_GROUPS:BASIC_GROUPS).filter(([group,re])=>re.test(r)&&!(stated&&GROUP_AGE[group]&&GROUP_AGE[group]!==stated)).flatMap(([group])=>GROUP_CATEGORIES[group])));
 if(profiles&&recipientGender(recipients,preferences)==='male')suited.delete('makeup');
 return suited;
};
// Rough first guess by gender and age, used only when the user has not said what the recipient likes.
// Stated tastes (category:/type: preferences, +3) outrank it, so a man who likes cosmetics or an adult who
// likes toys still gets them once said. `likely` adds +1, `unlikely` −1.
const AGE_LIKELY={child:['toy','stationery','snack'],teen:['digital','audio','stationery','accessory','fitness','snack'],adult:[],elder:['health','food','coffee_tea','kitchen']};
const GENDER_AGE_LIKELY={
 'adult:male':['watch','audio','digital','fitness','bag','accessory'],
 'adult:female':['beauty','jewelry','bag','accessory','flower','decor'],
 'teen:male':['fitness','digital'],
 'teen:female':['beauty','jewelry','accessory'],
 'elder:male':['coffee_tea','fitness'],
 'elder:female':['flower','decor','kitchen'],
};
const AGE_UNLIKELY={child:['health','kitchen','coffee_tea','personal_care','watch'],teen:['health','kitchen'],adult:['toy'],elder:['toy','makeup']};
const GENDER_UNLIKELY={male:['makeup','beauty']};
// Toys are the clear first pick for a child, so they get +2 rather than +1.
const AGE_PRIMARY={child:'toy'};
export function profilePrior(category,gender,age){
 const likely=new Set([...(AGE_LIKELY[age]??[]),...(GENDER_AGE_LIKELY[`${age}:${gender}`]??[])]);
 const unlikely=new Set([...(AGE_UNLIKELY[age]??[]),...(GENDER_UNLIKELY[gender]??[])]);
 return (likely.has(category)?1:0)+(AGE_PRIMARY[age]===category?1:0)-(unlikely.has(category)?1:0);
}
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
