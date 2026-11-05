import { initial } from '../../src/vendor/engine.mjs';
import { ALLERGEN_NAMES } from '../../src/vendor/allergens.mjs';

const categories = [
  ['coffee_tea','커피|홍차|녹차|전통차|차'], ['snack','과자|간식|초콜릿|쿠키|한과'],
  ['food','과일|식품|기름|오일'], ['beauty','향수|화장품|스킨케어|로션'],
  ['makeup','메이크업|립스틱|섀도'], ['fitness','운동|헬스|요가|피트니스'],
  ['audio','이어폰|헤드폰|스피커|음악'], ['jewelry','주얼리|목걸이|팔찌|귀걸이|반지'],
  ['watch','시계'], ['bag','가방|백팩'], ['accessory','지갑|선글라스'],
  ['toy','장난감|완구|인형|레고'], ['health','건강식품|영양제|홍삼'],
  ['kitchen','주방용품|요리'], ['decor','인테리어|장식|향초|무드등'],
  ['personal_care','면도기|드라이기'],
];
const question = text => ({ patch:{}, questions:[text], unresolved:true, route:'clarification' });
const unknown = () => ({ patch:{}, questions:['받는 사람의 선호나 조건을 조금 더 구체적으로 알려주세요.'], unresolved:true, route:'unresolved' });
const unique = values => [...new Set(values)];

// Bounded money normalization follows the prototype's language.mjs conventions.
export function normalizeMoney(text) {
  const digits={영:0,일:1,이:2,삼:3,사:4,오:5,육:6,칠:7,팔:8,구:9};
  const number = word => {
    let total=0,part=0,digit=0;
    for (const c of word) {
      if (c in digits) { digit=digits[c]; continue; }
      const unit={십:10,백:100,천:1000,만:10000}[c];
      if (unit===10000) { total+=(part+digit||1)*unit;part=0; }
      else part+=(digit||1)*unit;
      digit=0;
    }
    return total+part+digit;
  };
  return text.replace(/(?<![\d,])\d{1,3}(?:,\d{3})+(?![\d,])/g,m=>m.replaceAll(',',''))
    .replace(/([영일이삼사오육칠팔구십백천만]+)\s*원/g,(match,n,offset,whole)=>/[\d.,]\s*$/.test(whole.slice(0,offset))?match:`${number(n)}원`)
    .replace(/(\d+(?:\.\d+)?)\s*(만|천)(?!\s*원)/g,'$1$2 원');
}
export function moneyValues(text) {
  return [...normalizeMoney(text).matchAll(/(\d+(?:\.\d+)?)\s*(만\s*원|천\s*원|원)/g)]
    .map(m=>Number(m[1])*(m[2].includes('만')?10000:m[2].includes('천')?1000:1));
}

export function parseConditions(text, state, { pendingQuestion = '' } = {}) {
  let rest=normalizeMoney(text).trim();
  const patch={};
  if (/나는|저는|제가|내가|주는 사람/.test(rest)) return question('주는 사람과 받는 사람의 취향을 구분해서, 받는 사람의 조건만 알려주세요.');
  if (/최소|이상|하한|최대.*최소/.test(rest)) return question('적용할 예산 상한 하나를 알려주세요.');
  const amounts=moneyValues(rest);
  if (amounts.length>1) return question('적용할 예산 상한 하나를 알려주세요.');
  if (amounts.some(n=>!Number.isSafeInteger(n)||n<=0||n>1e9) || /-\s*\d+\s*(만|천|원)/.test(rest)) return question('예산 상한을 양의 정수 금액으로 알려주세요.');
  const positiveShipping=/배송비(?:도|를|는)?\s*포함(?!\s*(?:하지|안))/.test(rest);
  const negativeShipping=/배송비\s*(?:포함하지|포함\s*안|불포함|제외|별도|빼)|상품값만/.test(rest);
  if (positiveShipping && negativeShipping) return question('배송비 포함 여부를 하나로 지정해 주세요.');
  if (/세트당|개당/.test(rest) && /총예산|총|전체\s*예산|합쳐/.test(rest)) return question('총예산인지 세트당 예산인지 하나로 지정해 주세요.');
  const shippingYes=/^(네|예|응|그래|좋아|좋아요|포함해줘|포함)[.!?]?$/;
  const shippingNo=/^(아니|아니요|아뇨|빼줘|제외|별도)[.!?]?$/;
  if ((shippingYes.test(rest)||shippingNo.test(rest)) && /배송비/.test(pendingQuestion)) {
    return {patch:{budget:{shipping_included:shippingYes.test(rest)}},questions:[],unresolved:false,route:'rules'};
  }
  const take=(re,fn)=>{rest=rest.replace(re,(...args)=>{fn?.(...args);return ' ';});};
  const recipients=[];
  take(/(직장 상사|직장동료|부모님|어머니|아버지|할머니|할아버지|교수님|선생님|엄마|아빠|친구|동료|연인|애인|손주|손녀|자녀)(?:는|은|에게|한테|께)?/g,(_,r)=>recipients.push(({엄마:'어머니',아빠:'아버지'})[r]||r));
  if (unique(recipients).length>1) return question('이번에 선물할 수령인 한 명을 지정해 주세요.');
  if (recipients.length) {
    patch.recipients=unique(recipients);
    if (state.recipients.length && JSON.stringify(patch.recipients)!==JSON.stringify(state.recipients)) state=initial();
  }
  take(/(\d+(?:\.\d+)?)\s*(만\s*원|천\s*원|원)/g,()=>{patch.budget={...patch.budget,amount_krw:amounts[0]};});
  take(/배송비\s*(?:포함하지\s*않아|포함\s*안\s*해|불포함|제외|별도|빼줘)|상품값만/g,()=>{patch.budget={...patch.budget,shipping_included:false};});
  take(/배송비(?:도|를|는)?\s*포함(?:해줘|해요)?/g,()=>{patch.budget={...patch.budget,shipping_included:true};});
  take(/세트당|개당|한\s*(?:세트|개)\s*예산/g,()=>{patch.budget={...patch.budget,scope:'per_set'};});
  take(/총예산|총|전체\s*예산|모두\s*합쳐서|합쳐서/g,()=>{patch.budget={...patch.budget,scope:'total'};});
  const quantities={한:1,하나:1,두:2,둘:2,세:3,셋:3,네:4,넷:4,다섯:5};
  take(/(하나|둘|셋|넷|다섯|한|두|세|네|\d+)\s*(?:세트|개)(?!당)/g,(_,n)=>{patch.quantity=quantities[n]??Number(n);if(patch.quantity===1)patch.same_product=true;});
  take(/서로\s*다른\s*상품|각각\s*다른\s*상품/g,()=>{patch.same_product=false;});
  take(/같은\s*상품|동일한\s*상품/g,()=>{patch.same_product=true;});
  take(/단맛\s*(?:상관없어|상관없음|조건\s*취소)/g,()=>{patch.preferences=state.preferences.filter(v=>!['less_sweet','unsweetened'].includes(v));});
  take(/단맛\s*없는|무가당|안\s*단|달지\s*않은/g,()=>{patch.preferences=unique([...(patch.preferences??state.preferences),'unsweetened']);});
  take(/덜\s*단|덜\s*달게/g,()=>{patch.preferences=unique([...(patch.preferences??state.preferences),'less_sweet']);});
  take(/알레르기\s*(?:없음|없어|없어요|해제|취소)/g,()=>{patch.excluded_ingredients=[];});
  const allergens=unique([...ALLERGEN_NAMES,'견과']).sort((a,b)=>b.length-a.length).join('|');
  take(new RegExp(`(${allergens})(?:는|은|를|을|가|에)?\\s*(?:제외\\s*취소|포함해도\\s*돼)`, 'g'),(_,name)=>{
    const tag=name==='견과'?'견과류':name;
    patch.excluded_ingredients=(patch.excluded_ingredients??state.excluded_ingredients).filter(x=>x!==tag);
  });
  const hasAllergen=/알레르기/.test(rest);
  const allergenRe=new RegExp(`(${allergens})(?:는|은|를|을|가|에)?\\s*(?:알레르기(?:가)?\\s*(?:있어요|있어|있음)?|피해야\\s*해|피해줘|빼줘|제외|싫어|안\\s*좋아해)`, 'g');
  take(allergenRe,(_,name)=>{patch.excluded_ingredients=unique([...(patch.excluded_ingredients??state.excluded_ingredients),name==='견과'?'견과류':name]);});
  if (/성분/.test(pendingQuestion)) take(new RegExp(`^\\s*(${allergens})(?:요|이요)?[.!]?\\s*$`),(_,name)=>{patch.excluded_ingredients=unique([...state.excluded_ingredients,name==='견과'?'견과류':name]);});
  if (hasAllergen && !patch.excluded_ingredients) return question('피해야 할 알레르기 성분을 알려주세요.');
  for (const [category,words] of categories) {
    take(new RegExp(`(${words})(?:는|은|를|을|가)?\\s*(?:제외\\s*취소|포함해도\\s*돼)`,'g'),()=>{patch.excluded_categories=(patch.excluded_categories??state.excluded_categories).filter(x=>x!==category);});
    take(new RegExp(`(${words})(?:는|은|를|을|가)?\\s*(?:좋아하지\\s*않아|안\\s*좋아해|싫어|빼줘|제외|말고)`,'g'),()=>{
      patch.excluded_categories=unique([...(patch.excluded_categories??state.excluded_categories),category]);
      patch.preferences=(patch.preferences??state.preferences).filter(x=>x!==`category:${category}`&&!(category==='coffee_tea'&&['type:tea','type:coffee'].includes(x)));
    });
    take(new RegExp(`(${words})(?:는|은|를|을|가|로)?\\s*(?:좋아해요|좋아해|선호해|선호|추천해줘|추천|골라줘)`,'g'),(_,word)=>{
      const typed=category==='coffee_tea'?[word==='커피'?'type:coffee':'type:tea']:[];
      patch.preferences=unique([...(patch.preferences??state.preferences),`category:${category}`,...typed]);
    });
  }
  take(/브랜드\s*상관없어|브랜드\s*조건\s*취소/g,()=>{patch.brand=null;});
  take(/브랜드\s*["“]([^"”\n]{1,100})["”]/g,(_,brand)=>{patch.brand=brand;});
  take(/격식\s*있는\s*포장|격식\s*포장/g,()=>{patch.packaging='formal';});
  take(/기본\s*포장/g,()=>{patch.packaging='basic';});
  take(/포장\s*상관없어/g,()=>{patch.packaging=null;});
  take(/(\d{4})[-년]\s*(\d{1,2})[-월]\s*(\d{1,2})(?:일)?(?:까지)?/g,(_,y,m,d)=>{patch.delivery_by=`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;});
  take(/배송일\s*조건\s*취소/g,()=>{patch.delivery_by=null;});
  // Only recognized filler may disappear. Unconsumed text triggers the LLM/clarification route.
  rest=rest.replace(/추천해주세요|추천해줘|추천|골라줘|찾아줘|상품|선물|예산|이하|이내|상한|으로|에게|한테|께|그리고|해줘|주세요|주세요|해주세요|변경|바꿔줘|수정|까지|요/g,'').replace(/[\s,.!?~]/g,'');
  if (rest) return unknown();
  if (!Object.keys(patch).length) return unknown();
  if (patch.delivery_by!==undefined && patch.delivery_by!==null) {
    const date=new Date(patch.delivery_by);
    if (!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==patch.delivery_by) return question('실제 수령 마감일을 YYYY-MM-DD 형식으로 알려주세요.');
  }
  if (patch.quantity!==undefined && (!Number.isSafeInteger(patch.quantity)||patch.quantity<1||patch.quantity>1000)) return question('수량을 1개 이상으로 알려주세요.');
  const excluded=patch.excluded_categories??state.excluded_categories;
  if ((patch.preferences??[]).some(x=>x.startsWith('category:')&&excluded.includes(x.slice(9)))) return question('선호 상품군과 제외 상품군이 겹쳐요. 적용할 조건을 확인해 주세요.');
  return {patch,questions:[],unresolved:false,route:'rules'};
}

export function classifyIntent(text, state) {
  const normalized=normalizeMoney(text).trim();
  if (/^(?:다시\s*)?(?:추천|추천해줘|추천해주세요|선물\s*추천해줘|보여줘)[.!?]?$/.test(normalized)) return {kind:'view',intent:'recommend'};
  if (/^(?:왜|추천\s*이유|이유|설명)(?:\s*(?:추천했어|추천했어요|추천한\s*거야|알려줘|설명해줘|해줘))?[.!?]?$/.test(normalized)) return {kind:'view',intent:'explain'};
  if (/이면|올리면|늘리면|줄이면|낮추면|바꾸면|가정|비교/.test(normalized)) {
    const values=moneyValues(normalized);
    const rest=normalized.replace(/\d+(?:\.\d+)?\s*(만\s*원|천\s*원|원)/g,'').replace(/예산|상한|을|를|으로|로|에서|더|이면|올리면|늘리면|줄이면|낮추면|바꾸면|가정|비교|해줘|하면|어때|어떻게|달라져|돼|요|[\s,.!?]/g,'');
    if (!rest&&values.length===1) {
      const delta=/올리면|늘리면|줄이면|낮추면/.test(normalized);
      if (delta&&state.budget.amount_krw===null) return {kind:'clarify',question:'먼저 현재 예산 상한을 알려주세요.'};
      const amount=delta?state.budget.amount_krw+(/줄이면|낮추면/.test(normalized)?-values[0]:values[0]):values[0];
      if (!Number.isSafeInteger(amount)||amount<=0||amount>1e9) return {kind:'clarify',question:'비교할 예산을 양의 정수 금액으로 알려주세요.'};
      return {kind:'what_if_budget',amount_krw:amount,intent:'compare_budget'};
    }
    // A hypothetical with other conditions must never fall through to a state-changing patch.
    return {kind:'clarify',question:'가상 비교에서는 예산 상한만 바꿔주세요. 예: “예산 7만원이면?”'};
  }
  return {kind:'message',intent:'conditions'};
}
