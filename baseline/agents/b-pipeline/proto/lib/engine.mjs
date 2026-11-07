import {mentionedAllergens} from './allergens.mjs';
import {recipientCategories} from './catalog.mjs';
export const initial=()=>({occasion:null,recipients:[],quantity:null,same_product:null,budget:{amount_krw:null,scope:null,shipping_included:null},preferences:[],excluded_categories:[],excluded_ingredients:[],brand:null,delivery_by:null,packaging:null});
export function apply(state,patch){const next=structuredClone(state); for(const [k,v] of Object.entries(patch))next[k]=k==='budget'?{...next[k],...v}:v;return next}
export function differences(a,b,path=''){return Object.keys(b).flatMap(k=>{const p=path?`${path}.${k}`:k;return b[k]&&typeof b[k]==='object'&&!Array.isArray(b[k])?differences(a[k],b[k],p):JSON.stringify(a[k])!==JSON.stringify(b[k])?[{field:p,before:a[k],after:b[k]}]:[]})}
// A single ranking path is shared by normal and hypothetical recommendations.
export function budgetCost(product, state) {
 const unit = product.price_krw + (state.budget.shipping_included ? product.shipping_fee_per_set_krw : 0);
 return state.budget.scope === 'total' ? unit * (state.quantity || 1) : unit;
}
export const ALLERGY_NOTICE='상품명 기준으로 알레르기 성분을 추정했어요. 구매 전 성분표를 꼭 확인해 주세요.';
// Category-relative popularity, then absolute review count (so leaders of small categories do not tie on price).
export const morePopular=(a,b)=>a.popularity-b.popularity||(a.rating_count||0)-(b.rating_count||0);
export function rankProducts(products, s) {
 // Equal preference: popularity first, then the cheaper item. Review counts differ by orders of
 // magnitude across categories (earphones vs tea), so popularity is relative to the category leader.
 const suited=recipientCategories(s.recipients);
 const leader={};for(const p of products)leader[p.category]=Math.max(leader[p.category]||0,p.rating_count||0);
 if(s.budget.scope==='total'&&!s.quantity)return {status:'needs_clarification',message:'총 몇 세트가 필요한가요?',items:[]};
 if(s.quantity>1&&s.same_product!==true)return {status:'needs_clarification',message:'모두 같은 상품으로 보낼까요?',items:[]};
 const q=s.quantity||1;
 const items=products.filter(p=>!s.excluded_categories.includes(p.category)&&(!s.brand||p.brand===s.brand)&&(!s.packaging||p.packaging===s.packaging)&&(!s.delivery_by||p.arrival_date<=s.delivery_by)&&p.stock_sets>=q&&!(p.allergens_declared||[]).some(a=>s.excluded_ingredients.includes(a))).map(p=>({...p,popularity:(p.rating_count||0)/(leader[p.category]||1),total:q*(p.price_krw+(s.budget.shipping_included?p.shipping_fee_per_set_krw:0)),score:(suited.has(p.category)?1:0)+s.preferences.reduce((v,x)=>v+(x===`category:${p.category}`?3:x==='unsweetened'&&p.sweetness==='unsweetened'?2:x==='less_sweet'?({unsweetened:2,naturally_sweet:1,sweet:0}[p.sweetness]||0):0),0)})).filter(p=>s.budget.amount_krw===null||budgetCost(p,s)<=s.budget.amount_krw).sort((a,b)=>b.score-a.score||morePopular(b,a)||a.price_krw-b.price_krw||a.id.localeCompare(b.id));
 const notice=s.excluded_ingredients.length?ALLERGY_NOTICE:null;
 return {status:items.length?'ready':'no_match',message:items.length?`현재 조건에 맞는 상품을 골랐어요.${notice?` ${notice}`:''}`:'조건에 맞는 상품이 없어요. 예산이나 제외 조건을 조정해 주세요.',notice,items};
}
export function recommend(products,s){const result=rankProducts(products,s);return {...result,items:result.items.slice(0,3)}}
const nums={'한':1,'두':2,'세':3,'네':4,'다섯':5,'네 집':4};
const CATEGORY_WORDS=[['food',/과일|식품|기름|오일/],['coffee_tea',/커피|홍차|녹차|전통차|차로|차를|차\s*(?:좋아|선호)/],['snack',/과자|간식|초콜릿|쿠키|한과/],['beauty',/향수|화장품|스킨케어|로션/],['makeup',/메이크업|립스틱|섀도/],['fitness',/운동|헬스|요가|피트니스/],['audio',/이어폰|헤드폰|스피커|음악/],['jewelry',/주얼리|목걸이|팔찌|귀걸이|반지/],['watch',/시계/],['bag',/가방|백팩/],['accessory',/지갑|선글라스/],['toy',/장난감|완구|인형|레고/],['health',/건강|영양제|홍삼/],['kitchen',/주방|요리/],['decor',/인테리어|장식|향초|무드등/],['personal_care',/면도기|드라이기/]];
export function extract(text,state){const p={},questions=[];let recognized=false;const set=(k,v)=>{p[k]=v;recognized=true};
 if(/추석|설(?:날|\s|$)/.test(text))set('occasion',text.includes('추석')?'추석':'설');
 text=text.replaceAll('엄마','어머니').replaceAll('아빠','아버지');
 const rs=['부모님','어머니','아버지','처가','교수님','직장 상사','동료','친구','동창'].filter(x=>text.includes(x));if(rs.length)set('recipients',/에도/.test(text)?[...new Set([...state.recipients,...rs])]:rs);
 const qm=text.match(/(다섯|한|두|세|네|\d+)\s*(?:세트|집)/);if(qm)set('quantity',nums[qm[1]]||Number(qm[1]));
 if(/같은|동일/.test(text))set('same_product',true);
 if(/서로 다른/.test(text))set('same_product',false);
 const money=[...text.matchAll(/(\d+(?:\.\d+)?)\s*(만\s*원|천\s*원|원)/g)];
 if(money.length){const m=money.at(-1);set('budget',{amount_krw:Math.round(Number(m[1])*(m[2].includes('만')?10000:m[2].includes('천')?1000:1)),scope:/합쳐|총|전체/.test(text)?'total':/세트당/.test(text)?'per_set':state.budget.scope||'per_set'});}
 if(/배송비 포함/.test(text)){p.budget={...p.budget,shipping_included:true};recognized=true}
 if(/상품값|배송비는.*빼/.test(text)){p.budget={...p.budget,shipping_included:false};recognized=true}
 if(/저렴/.test(text)&&!money.length)questions.push('원하는 새 예산 상한을 알려주세요.');
 if(/단맛 없는|달지|단 건|덜 단/.test(text))set('preferences',[...new Set([...state.preferences,/단맛 없는/.test(text)?'unsweetened':'less_sweet'])]);
 if(/차\s*(한|세트)|차로/.test(text))set('preferences',[...new Set([...(p.preferences||state.preferences),'category:coffee_tea'])]);
 // Apply exclusion verbs within their clause, not to every category in the message.
 const clauses=text.split(/[.,!?;\n]+|(?:그리고|하지만)|(?:하고|지만|고)\s+/).filter(Boolean);
 for(const clause of clauses){
  const removal=/빼|제외|포함해도/.test(clause);
  for(const [cat,re] of CATEGORY_WORDS){if(!re.test(clause))continue;
   if(removal){const arr=p.excluded_categories||[...state.excluded_categories];set('excluded_categories',/포함해도/.test(clause)?arr.filter(x=>x!==cat):[...new Set([...arr,cat])]);}
   else if(!/좋아하지|선호하지|안\s*좋아|싫/.test(clause))set('preferences',[...new Set([...(p.preferences||state.preferences),`category:${cat}`])]);}
  // Nuts are an ingredient exclusion in this catalog, not a product category.
  if(/견과/.test(clause)&&removal){const current=p.excluded_ingredients||state.excluded_ingredients;set('excluded_ingredients',/포함해도/.test(clause)?current.filter(x=>x!=='견과류'):[...new Set([...current,'견과류'])]);}
 }
 if(/알레르기|피해야/.test(text)){const ingredients=mentionedAllergens(text);if(ingredients.length)set('excluded_ingredients',[...new Set([...(p.excluded_ingredients||state.excluded_ingredients),...ingredients])]);else questions.push('피해야 할 성분을 알려주세요.');}
 if(/가상브랜드\d+/.test(text))set('brand',text.match(/가상브랜드\d+/)[0]);if(/브랜드.*상관없/.test(text))set('brand',null);
 if(/격식/.test(text))set('packaging','formal');
 const date=text.match(/(\d{4})\s*(?:년|-)\s*(\d{1,2})\s*(?:월|-)\s*(\d{1,2})/);if(date)set('delivery_by',`${date[1]}-${date[2].padStart(2,'0')}-${date[3].padStart(2,'0')}`);else if(/전날|내일|까지.*(와야|받)|명절 전/.test(text))questions.push('수령 마감일을 2026-09-21처럼 알려주세요.');
 if(!recognized&&!questions.length)questions.push('이 데모는 정해진 표현을 처리해요. 예: “상품값 5만 원 이하”, “견과류는 빼줘”.');
 return {patch:p,questions};
}
