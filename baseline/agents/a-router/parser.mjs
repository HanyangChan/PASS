import { initial } from '../../src/vendor/engine.mjs';
import { ALLERGEN_NAMES } from '../../src/vendor/allergens.mjs';

// Occasion words beyond the originals (병문안, 송별회, 프러포즈 …), as a regex alternation. A copy of
// extractableOccasionSource() from lib/occasions.mjs so this folder stays standalone;
// tests/occasions.test.mjs fails if the two drift apart.
const EXTRA_OCCASIONS = '프로젝트\\s*완료|프로젝트\\s*종료|반려동물\\s*입양|인턴\\s*수료|기분\\s*전환|서프라이즈|산후조리|첫\\s*출근|자격시험|100일|프러포즈|프로포즈|집들이|홈파티|병문안|송별회|환송회|수료식|전시회|연주회|마니또|첫만남|소개팅|상견례|감사|초대|퇴원|회복|쾌유|출산|육아|입사|취업|송별|퇴사|퇴직|이직|은퇴|수료|합격|시험|유학|전시|공연|출간|대회|수상|경품|여행|답례|입양|깜짝|미안|화해|청혼|약혼|재회';
const categories = [
  ['coffee_tea','커피|홍차|녹차|전통차|(?<![가-힣])차(?=[를을는은도가이로와랑나]|보다|[\\s,.!?]|$)'], ['snack','과자|간식|초콜릿|쿠키|한과|디저트|사탕|젤리|(?<![가-힣])단\\s*(?:것|거|걸)(?=\\s*좋아)'],
  ['health','건강식품|영양제|비타민|유산균|홍삼|(?<![가-힣])건강(?!\\s*식품)'],
  ['food','과일|(?<!건강)식품|음식|기름|오일|고기|한우'], ['beauty','향수|화장품|스킨케어|로션|뷰티(?:\\s*상품)?(?:\\s*전체)?|피부\\s*관리'],
  ['makeup','메이크업|립스틱|섀도|틴트'], ['fitness','운동용품|운동|헬스|요가|피트니스|등산|골프|러닝'],
  ['audio','이어폰|헤드폰|헤드셋|스피커|음악|음향기기'], ['jewelry','주얼리|목걸이|팔찌|귀걸이|반지|보석'],
  ['watch','손목시계|시계'], ['bag','가방|백팩|핸드백|크로스백'], ['accessory','지갑|선글라스|벨트|모자|넥타이|스카프|패션\\s*소품'],
  ['toy','장난감|완구|인형|레고|보드게임'],
  ['kitchen','주방용품|주방|요리|그릇|텀블러'], ['decor','인테리어\\s*소품|인테리어|장식|향초|무드등|홈데코'],
  ['personal_care','면도기|드라이기|전동칫솔|생활가전'],
  ['flower','꽃다발|꽃바구니|생화|화분|(?<![가-힣])꽃'], ['stationery','문구|필기구|볼펜|만년필|(?<![가-힣])펜'],
  ['digital','전자기기|디지털기기|카메라|보조배터리'], ['liquor','전통주|와인|주류|막걸리|(?<![가-힣])술'],
];
// "안 좋아하셔", "못 드세요", "안 써요": they do not use or like it.
const NOT_USE = '(?:안|못)\\s*(?:좋아(?:하세요|하셔요|하셔|해요|해)?|드세요|드셔(?:요)?|드시고|드시는|마셔(?:요)?|마시세요|마시고|마시는|써(?:요)?|쓰세요|쓰셔(?:요)?|쓰시고|쓰는|하세요|하셔(?:요)?|해(?:요)?)';
const ALL_WORDS =categories.map(([,words])=>words).join('|');
// Gift items named in the Korean catalog. They only express a wish ("핸드크림 좋아해" → 뷰티); excluding
// one item ("양말 말고") must not drop its whole category, so they are never used for exclusions.
const ITEM_WORDS = {
  food:'한돈|갈비|굴비|전복|갈치|명란|장어|사과|한라봉|샤인머스캣|곶감|참기름|들기름|올리브유|스팸|참치|멸치',
  health:'배도라지|도라지즙|안마기|마사지기|마사지건|찜질기',
  snack:'약과|양갱|마카롱|육포|찹쌀떡|에너지바|케이크',
  coffee_tea:'수제청|원두|드립백|쌍화차|캐모마일',
  liquor:'막걸리',
  personal_care:'수건|칫솔|가습기|손난로|핫팩|샴푸',
  beauty:'핸드크림|바디워시|바디로션|립밤|(?<![가-힣])비누|기초\\s*화장품',
  accessory:'양말|키링|머플러|목도리|장갑|잠옷|우산|스카프|안대|슬리퍼',
  kitchen:'텀블러|머그컵|머그|와인잔|보온병|도시락|핸드드립',
  watch:'손목시계|스마트워치',
  bag:'반지갑|카드지갑|에코백',
  decor:'디퓨저|액자|포토북|무릎담요|담요|쿠션|스탠드',
  fitness:'요가매트|캠핑\\s*의자',
  toy:'보드게임|퍼즐',
  stationery:'다이어리|만년필|샤프|필통|플래너|독서대|포스트잇|형광펜|볼펜',
  digital:'폴라로이드|전자책',
  flower:'꽃바구니|튤립|프리지아|장미|카네이션|수국|백합|해바라기|작약|안개꽃',
};
const wishWords = (category,words) => ITEM_WORDS[category] ? `${ITEM_WORDS[category]}|${words}` : words;
const WISH_WORDS = categories.map(([category,words])=>wishWords(category,words)).join('|');
// "X나 Y", "X랑 Y", "X, Y": the leading items of a list, each followed by a joining word.
const listOf = all => `(?:(?:${all})\\s*(?:이나|나|이랑|랑|하고|와|과|및|,|또는)\\s*)+`;
const LIST = listOf(ALL_WORDS), WISH_LIST = listOf(WISH_WORDS);
const wordsIn = (text, wish=false) => text ? categories.flatMap(([category,words])=>[...text.matchAll(new RegExp(wish?wishWords(category,words):words,'g'))].map(m=>[category,m[0]])) : [];
const question = text => ({ patch:{}, questions:[text], unresolved:true, route:'clarification' });
const RECIPIENTS='직장\\s*상사|직장\\s*동료|회사\\s*동료|여자\\s*친구|남자\\s*친구|여친|남친|시어머니|시아버지|장모님|장인어른|부모님|어머니|아버지|할머니|할아버지|교수님|선생님|선배|후배|팀장님|부장님|상사|엄마|아빠|친구|동료|연인|애인|남편|아내|와이프|언니|누나|오빠|남동생|여동생|동생|조카|아들|딸|손주|손녀|자녀|이모|삼촌|고모|(?<![가-힣])형(?![가-힣])';
const recipientName = r => { const k=r.replace(/\s+/g,''); return ({엄마:'어머니',아빠:'아버지',여친:'여자친구',남친:'남자친구',와이프:'아내',회사동료:'직장동료',직장상사:'직장 상사'})[k] ?? k; };
const GIVER='저는|나는|난|전|제가|내가';
// Ways to say the recipient likes or wants something.
const LIKE='좋아(?:하세요|하셔요|하셔|하십니다|하시고|하시는데|하시며|하심|해요|해|함|하고|하는데|하며|하(?:는|시는)(?:\\s*(?:분|사람)(?:이야|이에요|입니다)?)?)|즐겨\\s*(?:드세요|드셔|드시고|마셔요|마셔|마시고|하세요|하셔|해요|해)|관심(?:이)?\\s*(?:많|있)(?:어요|어|으세요|으셔|으시고|고)|선호(?:하세요|하셔|해요|해)?|추천해\\s*(?:줘|주세요)|추천|골라\\s*(?:줘|주세요|봐)|위주로|필요(?:해요|해|하세요|하셔)';
const FRAGRANCE_SCOPE='향수만 제외할까요, 화장품·뷰티 전체를 제외할까요?';
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
    // "3만5천원", "3만 5천", "3만5000원" are one amount.
    .replace(/(\d+)\s*만\s*(\d+)\s*천\s*(?:원)?/g,(_,a,b)=>`${Number(a)*10000+Number(b)*1000}원`)
    .replace(/(\d+)\s*만\s*(\d{1,4})\s*원/g,(_,a,b)=>`${Number(a)*10000+Number(b)}원`)
    .replace(/([영일이삼사오육칠팔구십백천만]+)\s*원/g,(match,n,offset,whole)=>/[\d.,]\s*$/.test(whole.slice(0,offset))?match:`${number(n)}원`)
    .replace(/(\d+(?:\.\d+)?)\s*(만|천)(?!\s*원)/g,'$1$2 원');
}
export function moneyValues(text) {
  return [...normalizeMoney(text).matchAll(/(\d+(?:\.\d+)?)\s*(만\s*원|천\s*원|원)/g)]
    .map(m=>Number(m[1])*(m[2].includes('만')?10000:m[2].includes('천')?1000:1));
}

// Spoken-Korean endings and pairings that carry no condition of their own, removed before matching.
function tidy(text) {
  return text
    .replace(/택배비|배송료|운송료/g,'배송비')
    .replace(/상품값(?:과|에)\s*배송비\s*(?:합쳐|더해서)|배송비(?:를|까지)\s*(?:더해도|내고|넣어|포함(?!\s*(?:하지|안))(?:해서)?)/g,'배송비 포함')
    .replace(/배송(?=\s*(?:포함|불포함|미포함|별도|제외|따로|까지|합쳐))/g,'배송비')
    .replace(/배송비(?:는|은)?\s*(?:별도(?:로)?|따로)\s*(?:낼게요?|계산해(?:요)?)/g,'배송비 별도')
    .replace(new RegExp(`(?:우리|저희)\\s*(?=${RECIPIENTS})`,'g'),'')
    .replace(new RegExp(`(${RECIPIENTS})(?:야|예요|이에요|입니다|이고)(?=[\\s,.!?]|$)`,'g'),'$1')
    .replace(new RegExp(`받는\\s*(?:사람|분)(?:은|는)?\\s*(?=${RECIPIENTS})`,'g'),'')
    .replace(/(\d+(?:\.\d+)?\s*(?:만\s*원|천\s*원|원))(?:을|를)?\s*(?:안에서|안에|한도로|넘지\s*않는|까지만)/g,'$1 이하')
    .replace(/(\d+(?:\.\d+)?\s*(?:만\s*원|천\s*원|원))(?:을|를)?\s*넘기면\s*안\s*돼/g,'$1 이하')
    .replace(new RegExp(`(${ALL_WORDS})(?:보다는|보다)\\s*(${ALL_WORDS})`,'g'),'$1 말고 $2')
    .replace(/(?:엄마|어머니|어머님)\s*(?:랑|이랑|하고|와|과|,)?\s*(?:아빠|아버지|아버님)|(?:아빠|아버지|아버님)\s*(?:랑|이랑|하고|와|과|,)?\s*(?:엄마|어머니|어머님)|양가\s*부모님/g,'부모님')
    .replace(/어머님/g,'어머니').replace(/아버님/g,'아버지')
    .replace(/(원|포함|별도|선물)\s*(?:이에요|예요|입니다|이고|이며|이요|이야|인데|이라서)(?=[\s,.!?]|$)/g,'$1')
    .replace(/원\s*짜리/g,'원')
    .replace(/(\d+(?:\.\d+)?\s*(?:만\s*원|천\s*원|원))\s*(?:(?:내외|안팎|언저리|쯤|대)(?:에서|로|으로)?|선(?:에서|으로)(?![가-힣]))/g,'$1');
}

export function parseConditions(text, state, { pendingQuestion = '', singleGift = false } = {}) {
  if (/알레르기|알러지/.test(text) && /(?:성분|재료|뭘\s*피하는지)[^,.!?]{0,24}(?:몰라|모르|미확인|확인하지\s*못|듣지\s*못|안\s*알려|확인\s*전)/.test(text)) {
    return question('피해야 할 알레르기 성분을 알려주세요.');
  }
  let rest=tidy(normalizeMoney(text)).trim();
  if (singleGift && !/(?:개|세트)\s*(?:합계|합쳐)|(?:복수|여러)\s*(?:개|세트)/.test(rest)) {
    rest=rest.replace(/결제\s*총액(?:을|은|이|이란)?/g,'예산');
  }
  rest=rest.replace(/^(?:나머지\s*)?조건(?:은|는)?\s*그대로\s*두고\s*/,'')
    .replace(/^(?:처음|아까|이전(?:에)?)\s*찾던\s*[^,.!?]+?\s+대신\s+(?=.*(?:으로|로)\s*(?:바꿔|변경))/,'')
    .replace(new RegExp('(?:줄|드릴)\\s+(?=(?:'+WISH_WORDS+'))','g'),'')
    .replace(/원하는\s*건\s*/,'')
    .replace(/(?:배송비\s*포함\s*)?예산(?:은|는)?\s*그대로(?:야|예요|에요|입니다)?(?=[.!?\s]|$)/g,'');
  rest=rest.replace(new RegExp(`^(?:그거|그건|이거)\\s*말고\\s*(?=${RECIPIENTS})`),'');
  rest=rest.replace(/(\d+(?:\.\d+)?\s*(?:만\s*원|천\s*원|원))(?:은|는)?\s*그대로(?:\s*두고)?/g,'$1 ');
  // A named previous recipient followed by an explicit "this time" contrast is history,
  // not a request for two recipients. Other multiple-person statements still ask.
  rest=rest.replace(new RegExp(`^(?:그건|그거는|지난번엔|지난번에는)\\s*(?:${RECIPIENTS})\\s*(?:거였고|선물이었고|거였는데)\\s*이번(?:에는|엔|에)\\s*`),'');
  const patch={};
  const limitations=[];
  const answer=rest.replace(/[.!?~\s]+$/,'');
  // Replies to the question that was just asked.
  if (pendingQuestion===FRAGRANCE_SCOPE) {
    if (/^(?:향수만|향수|향\s*(?:나는|있는)\s*(?:것|거|제품)만)(?:\s*(?:빼줘|제외|요|이요))?$/.test(answer)) return {patch:{preferences:unique([...state.preferences,'avoid_fragrance'])},questions:[],unresolved:false,route:'rules'};
    if (/^(?:(?:뷰티|화장품)\s*)?(?:전체|전부|다)(?:\s*(?:를)?\s*(?:빼줘|제외|요))?$/.test(answer)) return {patch:{excluded_categories:unique([...state.excluded_categories,'beauty']),preferences:state.preferences.filter(p=>p!=='category:beauty')},questions:[],unresolved:false,route:'rules'};
  }
  if (/^(?:없어요|없어|없음|없습니다)$/.test(answer)) {
    if (/성분/.test(pendingQuestion)) return question('알레르기가 없으면 "알레르기 없어요"라고, 있으면 피해야 할 성분을 알려주세요.');
    if (/알레르기/.test(pendingQuestion)&&/있(?:나요|어요|습니까|을까요)|유무/.test(pendingQuestion)) return {patch:{excluded_ingredients:[]},questions:[],unresolved:false,route:'rules'};
  }
  // "저는 커피 좋아하는데 엄마는 차 좋아해요": the giver's own clause is set aside, never applied.
  rest=rest.replace(new RegExp(`^(?:${GIVER})\\s+[^,.!?]*?(?:는데|지만|고)[,\\s]+(?=.*(?:${RECIPIENTS}))`),'');
  if (/나는|저는|제가|내가|주는 사람/.test(rest)) return question('주는 사람과 받는 사람의 취향을 구분해서, 받는 사람의 조건만 알려주세요.');
  // "친구 말고 엄마한테": the negated recipient is dropped.
  rest=rest.replace(new RegExp(`(?:${RECIPIENTS})(?:는|은)?\\s*(?:말고|아니고|대신)\\s*(?=.*(?:${RECIPIENTS}))`,'g'),'');
  if (/최소|이상|하한|최대.*최소/.test(rest)) return question('적용할 예산 상한 하나를 알려주세요.');
  let amounts=moneyValues(rest);
  if (amounts.length>1) {
    // "예산 5만원. 아니, 7만원으로" / "5만원 말고 7만원": an explicit correction keeps the last amount.
    const money=[...rest.matchAll(/(\d+(?:\.\d+)?)\s*(만\s*원|천\s*원|원)/g)];
    const between=rest.slice(money[0].index,money.at(-1).index);
    const explicitPast=amounts.length===2&&amounts[0]===state.budget.amount_krw&&/^\s*(?:이었는데|였는데|이었지만|였지만)/.test(rest.slice(money[0].index+money[0][0].length))&&/낮춰|줄여|올려|늘려/.test(rest.slice(money.at(-1).index));
    if (!/아니|정정|말고|아니고|아니라|대신/.test(between)&&!explicitPast) return question('적용할 예산 상한 하나를 알려주세요.');
    for (const m of money.slice(0,-1)) rest=rest.replace(m[0],' ');
    if(explicitPast) rest=rest.replace(/이었는데|였는데|이었지만|였지만/,' ');
    rest=rest.replace(/(^|[\s,.])(?:아니요|아니라|아니고|아니|정정|말고|대신)(?=[\s,.]|$)/g,'$1 ');
    amounts=[amounts.at(-1)];
  }
  if (amounts.some(n=>!Number.isSafeInteger(n)||n<=0||n>1e9) || /-\s*\d+\s*(만|천|원)/.test(rest)) return question('예산 상한을 양의 정수 금액으로 알려주세요.');
  const positiveShipping=/배송비(?:도|를|는)?\s*포함(?!\s*(?:하지|안))|배송비\s*(?:까지|합쳐(?:서)?|합해서)/.test(rest);
  const negativeShipping=/배송비(?:는|은|도)?\s*(?:포함하지|포함\s*안|불포함|미포함|제외|별도|따로|빼)|상품값만/.test(rest);
  if (positiveShipping && negativeShipping) return question('배송비 포함 여부를 하나로 지정해 주세요.');
  if (/세트당|개당/.test(rest) && /총예산|총|전체\s*예산|합쳐/.test(rest)) return question('총예산인지 세트당 예산인지 하나로 지정해 주세요.');
  const shippingYes=/^(?:네|예|응|그래|좋아|좋아요|포함(?:해\s*(?:줘|주세요|요)|할게요?|이요|요)?|넣어\s*(?:줘|주세요))[.!?]?$/;
  const shippingNo=/^(?:아니|아니요|아뇨|빼(?:줘|주세요|고요|고)|제외(?:해\s*(?:줘|주세요))?|별도(?:요|로)?|따로(?:요)?|미포함|불포함|포함\s*안\s*(?:해|해요|할게요))[.!?]?$/;
  if ((shippingYes.test(rest)||shippingNo.test(rest)) && /배송비/.test(pendingQuestion)) {
    return {patch:{budget:{shipping_included:shippingYes.test(rest)}},questions:[],unresolved:false,route:'rules'};
  }
  const take=(re,fn)=>{rest=rest.replace(re,(...args)=>{fn?.(...args);return ' ';});};
  const occasions=[];
  const occasionOf=o=>{o=o.replace(/\s+/g,'');return /설날|추석|한가위/.test(o)?'명절':o==='생신'?'생일':/기념일/.test(o)?'기념일':/수능|수험/.test(o)?'수험':o==='개원'?'개업':o==='스승의날'?'스승의 날':o;};
  take(/(생신|생일|명절|기념일|환갑|칠순|졸업|입학|결혼|개업)(?:인데|이라서)(?=[\s,.!?]|$)/g,(_,occasion)=>occasions.push(occasionOf(occasion)));
  take(/(?<![가-힣])(생신|생일|명절|기념일|환갑|칠순|졸업|입학|결혼|개업)(?:\s*축하)?(?=[\s,.!?]|$)/g,(_,occasion)=>occasions.push(occasionOf(occasion)));
  // The occasion may come before the recipient or the product: "설날 부모님 선물", "수능 보는 조카",
  // "생신 꽃다발", "개업 축하 화분".
  take(new RegExp(`(명절|설날|추석|한가위|생일|생신|합격|결혼\\s*기념일|기념일|(?:수능|수험생|수험)(?:\\s*응원)?|개업|개원|졸업|입학|취업|승진|이직|퇴직|은퇴|집들이|결혼|출산|환갑|칠순|팔순|고희|돌잔치|어버이날|스승의\\s*날|크리스마스|발렌타인\\s*데이|화이트\\s*데이|빼빼로\\s*데이|(?<![가-힣])(?:${EXTRA_OCCASIONS}))(?:\\s*축하)?(?:\\s*기념)?(?:에|때|날에)?(?:\\s*(?:보는|치는|준비하는|앞둔|준비\\s*중인))?(?=\\s*(?:(?:${RECIPIENTS})(?:께|에게|한테|의)?\\s*)?(?:(?:드릴|줄|드리는|주는)\\s+)?선물|\\s*$|\\s+(?:${RECIPIENTS})|\\s*(?:${ALL_WORDS}))`,'g'),(_,occasion)=>occasions.push(occasionOf(occasion)));
  if (unique(occasions).length>1) return question('이번 선물은 어떤 상황에 주는 건가요?');
  if (occasions.length) patch.occasion=occasions[0];
  const recipients=[];
  take(new RegExp(`(?:(유아|초등학생|중학생|고등학생|성인|\\d+세)\\s*)?(${RECIPIENTS})(?:는|은|에게|한테|께|가|이)?`,'g'),(_,age,r)=>recipients.push(age?`${age} ${recipientName(r)}`:recipientName(r)));
  if (unique(recipients).length>1) return question('이번에 선물할 수령인 한 명을 지정해 주세요.');
  if (recipients.length) {
    patch.recipients=unique(recipients);
    if (state.recipients.length && JSON.stringify(patch.recipients)!==JSON.stringify(state.recipients)) state=initial();
  }
  take(/아까\s*(?:말한\s*)?무향\s*조건(?:은|는)?\s*가져가지\s*마/g,()=>{patch.preferences=(patch.preferences??state.preferences).filter(p=>p!=='avoid_fragrance');});
  // Persist the name-based fragrance rule without excluding whole categories.
  take(/향\s*(?:제품\s*)?(?:제외|조건)\s*(?:해제|취소)|향(?:이|은)?\s*(?:강한|센|진한)\s*(?:제품|상품|것)(?:은|는|도|을)?\s*(?:포함해도\s*돼|제외\s*(?:취소|해제))/g,()=>{patch.preferences=(patch.preferences??state.preferences).filter(p=>p!=='avoid_fragrance');});
  take(/향(?:이|은)?\s*(?:강한|센|진한)\s*(?:제품|상품|것|건|거)(?:은|는|도|을)?\s*(?:빼(?:줘|고|주세요)|빼\s*주세요|제외(?:해줘|하고|해)?|싫어(?:하세요|하셔요|하셔|해요|해))/g,()=>{patch.preferences=unique([...(patch.preferences??state.preferences),'avoid_fragrance']);});
  take(/(?:먹는\s*(?:것|거|건|걸)|음식|먹거리)(?:은|는|도|을)?\s*(?:빼(?:줘|고|주세요)|빼\s*주세요|제외(?:해줘|하고|해)?|싫어(?:하세요|해요|해)|말고)/g,()=>{
    const edible=['food','snack','coffee_tea','health'];
    patch.excluded_categories=unique([...state.excluded_categories,...edible]);
    patch.preferences=(patch.preferences??state.preferences).filter(p=>!edible.some(c=>p===`category:${c}`)&&!['type:tea','type:coffee'].includes(p));
  });
  // Excluding perfume means fragrance products, not the whole beauty category.
  take(/향수(?:는|은|도|를|류)?\s*(?:빼(?:줘|주세요|고)|빼\s*주세요|제외(?:해줘|하고|해)?|싫어(?:하세요|하셔|해요|해)?|별로)/g,()=>{patch.preferences=unique([...(patch.preferences??state.preferences),'avoid_fragrance']);});
  const followUps=[];
  take(/향수(?:는|은)?\s*말고/g,()=>followUps.push(FRAGRANCE_SCOPE));
  take(/음료(?:는|은)?\s*말고/g,()=>followUps.push('커피·차를 제외할까요? 그 밖의 음료는 피하고 싶은 상품 종류를 구체적으로 알려주세요.'));
  take(new RegExp(`와인(?:은|는|을)?\\s*(?:말고|${NOT_USE}|빼(?:줘|주세요|고)|제외(?:해줘|하고|해)?)`,'g'),()=>{patch.preferences=unique([...(patch.preferences??state.preferences),'avoid_wine']);});
  take(/(\d+(?:\.\d+)?)\s*(만\s*원|천\s*원|원)/g,()=>{patch.budget={...patch.budget,amount_krw:amounts[0]};});
  take(/배송비(?:는|은|도)?\s*(?:포함하지\s*않아|포함\s*안\s*해|불포함|미포함|제외(?:하고|해서)?|별도|따로|빼(?:줘|주세요|고)?)(?:요|로)?|상품값만/g,()=>{patch.budget={...patch.budget,shipping_included:false};});
  take(/배송비(?:도|를|는)?\s*포함(?:해줘|해요|해서)?|배송비\s*(?:까지(?:야)?|합쳐(?:서)?|합해서)(?:\s*(?:해서|포함해서))?/g,()=>{patch.budget={...patch.budget,shipping_included:true};});
  take(/세트당|개당|한\s*(?:세트|개)\s*예산/g,()=>{patch.budget={...patch.budget,scope:'per_set'};});
  take(/총예산|총|전체\s*예산|모두\s*합쳐서|합쳐서/g,()=>{patch.budget={...patch.budget,scope:'total'};});
  const quantities={한:1,하나:1,두:2,둘:2,세:3,셋:3,네:4,넷:4,다섯:5};
  take(/(하나|둘|셋|넷|다섯|한|두|세|네|\d+)\s*(?:세트|개)(?!당)/g,(_,n)=>{patch.quantity=quantities[n]??Number(n);if(patch.quantity===1)patch.same_product=true;});
  take(/서로\s*다른\s*상품|각각\s*다른\s*상품/g,()=>{patch.same_product=false;});
  take(/같은\s*상품|동일한\s*상품/g,()=>{patch.same_product=true;});
  take(/단맛\s*(?:상관없어|상관없음|조건\s*취소)/g,()=>{patch.preferences=state.preferences.filter(v=>!['less_sweet','unsweetened'].includes(v));});
  take(/단맛\s*없는|무가당|안\s*단|달지\s*않은/g,()=>{patch.preferences=unique([...(patch.preferences??state.preferences),'unsweetened']);});
  take(/(?:너무\s*)?단\s*(?:것|거|건|걸|음식|간식)(?:은|는|을)?\s*(?:싫어(?:하세요|하셔요|하셔|해요|해)?|별로(?:예요|에요|야)?|안\s*좋아(?:하세요|하셔|해요|해)?|피해\s*(?:줘|주세요)|빼\s*(?:줘|주세요)|말고)/g,()=>{patch.preferences=unique([...(patch.preferences??state.preferences),'less_sweet']);});
  take(/덜\s*단|덜\s*달게/g,()=>{patch.preferences=unique([...(patch.preferences??state.preferences),'less_sweet']);});
  const allergens=unique([...ALLERGEN_NAMES,'견과']).sort((a,b)=>b.length-a.length).join('|');
  const tagOf=name=>name==='견과'?'견과류':name;
  const listOf=group=>[...group.matchAll(new RegExp(allergens,'g'))].map(m=>tagOf(m[0]));
  const allergenList=`(?:${allergens})(?:\\s*(?:이랑|랑|하고|와|과|및|그리고|,)\\s*(?:${allergens}))*`;
  const removed=new Set();
  const added=new Set();
  let clearAll=false;
  const awaitingIngredient=/성분/.test(pendingQuestion);
  // "땅콩 알레르기 없어요" removes only that ingredient; a bare "알레르기 없어요" clears all.
  take(new RegExp(`(?<![가-힣])(${allergenList})(?:는|은|를|을|가|에|도)?\\s*알레르기(?:는|가|도)?\\s*(?:없어요|없어|없음|없습니다|없으세요|없으셔|없고|없으시고|없는데|아니에요)`,'g'),(_,group)=>listOf(group).forEach(name=>removed.add(name)));
  take(/알레르기\s*(?:없어요|없어|없음|없습니다|해제|취소)/g,()=>{clearAll=true;});
  take(new RegExp(`(?<![가-힣])(${allergenList})(?:는|은|를|을|가|에|도)?\\s*(?:제외\\s*취소|포함해도\\s*돼)`,'g'),
    (_,group)=>listOf(group).forEach(name=>removed.add(name)));
  const hasAllergen=/알레르기/.test(rest);
  const allergenRe=new RegExp(`(?<![가-힣])(${allergenList})(?:는|은|를|을|가|에|도|이)?(?:\\s*(?:들어간|들어있는|들어\\s*있는|든|함유된)\\s*(?:것|거|건|걸|제품|상품|음식)(?:은|는|도|을)?)?\\s*(?:알레르기(?:가|도)?\\s*(?:있어요|있어|있음|있으세요|있으셔|있습니다|있고|있으시고|있는데|있으신데)?|피해야\\s*해|피해줘|빼(?:줘|고|주세요)|빼\\s*주세요|제외(?:해\\s*주세요|해줘|하고|해)?|싫어(?:하세요|해요)?|안\\s*좋아해)`, 'g');
  take(allergenRe,(_,group)=>listOf(group).forEach(name=>added.add(name)));
  if (awaitingIngredient) take(new RegExp(`^\\s*(${allergenList})(?:이요|요)?[.!]?\\s*$`),
    (_,group)=>listOf(group).forEach(name=>added.add(name)));
  if ((clearAll&&added.size)||[...removed].some(name=>added.has(name))) return question('어떤 알레르기 성분을 제외할지 확인해 주세요.');
  if ((hasAllergen&&!added.size)||(awaitingIngredient&&!clearAll&&removed.size&&!added.size)) return question('피해야 할 알레르기 성분을 알려주세요.');
  if (clearAll||removed.size||added.size) {
    patch.excluded_ingredients=clearAll?[]:unique([...state.excluded_ingredients.filter(name=>!removed.has(name)),...added]);
  }
  const selectedCategories=new Set();
  const like=(cat,word)=>{
    selectedCategories.add(cat);
    const typed=cat==='coffee_tea'?(/커피/.test(word)?['type:coffee']:['type:tea']):cat==='stationery'&&/필기구|볼펜|만년필|샤프|형광펜|펜/.test(word)?['type:writing']:cat==='flower'&&/꽃다발/.test(word)?['type:bouquet']:[];
    patch.preferences=unique([...(patch.preferences??state.preferences),`category:${cat}`,...typed]);
  };
  // "커피 말고 차", "차 말고 커피로": the second item is wanted; the first is just not chosen, not excluded.
  take(new RegExp(`(${ALL_WORDS})(?:는|은)?\\s*말고\\s*(${ALL_WORDS})(?:\\s*쪽)?(?:으로|로|를|을)?(?:\\s*(?:${LIKE}))?(?=$|[\\s,.!?])`,'g'),(_,not,want)=>{
    const [cat]=wordsIn(want)[0];
    if (cat==='coffee_tea') patch.preferences=(patch.preferences??state.preferences).filter(x=>!['type:tea','type:coffee'].includes(x));
    like(cat,want);
  });
  for (const [category,words] of categories) {
    take(new RegExp(`(${words})(?:는|은|를|을|가)?\\s*(?:제외\\s*취소|포함해도\\s*돼)`,'g'),()=>{patch.excluded_categories=(patch.excluded_categories??state.excluded_categories).filter(x=>x!==category);});
    // "과자랑 초콜릿은 빼줘", "커피나 차 좋아해": the verb applies to every item of the list before it.
    take(new RegExp(`(${LIST})?(${words})(?:는|은|를|을|가|도)?\\s*(?:좋아하지\\s*않(?:아|으세요|으셔)|${NOT_USE}|싫어(?:하세요|하셔|해요)?|빼(?:줘|주세요|고)|빼\\s*주세요|제외(?:해\\s*(?:줘|주세요)|하고)?|말고|별로)`,'g'),(_,list,word)=>{
      for (const [cat] of [...wordsIn(list),[category,word]]) {
        patch.excluded_categories=unique([...(patch.excluded_categories??state.excluded_categories),cat]);
        patch.preferences=(patch.preferences??state.preferences).filter(x=>x!==`category:${cat}`&&!(cat==='coffee_tea'&&['type:tea','type:coffee'].includes(x)));
      }
    });
    take(new RegExp(`(${WISH_LIST})?(${wishWords(category,words)})(?:\\s*(?:선물\\s*세트|세트|제품|상품|종류|류))?(?:는|은|를|을|가|이|에|도|로|으로)?(?:\\s*(?:하는|하시는|마시는|드시는|듣는|쓰는|모으는|받는)\\s*(?:것|거|걸|건)?(?:을|를)?)?\\s*(?:${LIKE})`,'g'),(_,list,word)=>{
      for (const [cat,w] of [...wordsIn(list,true),[category,word]]) like(cat,w);
    });
  }
  // A bare product word is what they want: "이어폰 같은 거", "장난감", "목걸이 같은 액세서리" (first word wins).
  for (const [category,words] of categories) {
    take(new RegExp(`(${WISH_LIST})?(?<![가-힣])(${wishWords(category,words)})(?:(?:\\s*(?:같은|종류(?:의)?|쪽(?:으로)?|류(?:의)?|계열(?:의)?)(?:\\s*(?:거|것|걸|건|제품|상품|선물|[가-힣]{1,6}))?)|(?:\\s*(?:이나|나|이면|면)\\s*(?:좋겠어(?:요)?|좋아(?:요)?|괜찮아(?:요)?))|(?:\\s*(?:선물\\s*세트|선물|제품|상품|세트))(?:으로|로)?|(?:으로|로))?(?:은|는|이|가|을|를)?(?=$|[\\s,.!?])`,'g'),(_,list,word)=>{
      for (const [cat,w] of [...wordsIn(list,true),[category,word]]) if (!(patch.excluded_categories??state.excluded_categories).includes(cat)) like(cat,w);
    });
  }
  take(/브랜드\s*상관없어|브랜드\s*조건\s*취소/g,()=>{patch.brand=null;});
  take(/브랜드\s*["“]([^"”\n]{1,100})["”]/g,(_,brand)=>{patch.brand=brand;});
  take(/격식\s*있는\s*포장|격식\s*포장/g,()=>{patch.packaging='formal';});
  take(/기본\s*포장/g,()=>{patch.packaging='basic';});
  take(/포장\s*상관없어/g,()=>{patch.packaging=null;});
  take(/(\d{4})[-년]\s*(\d{1,2})[-월]\s*(\d{1,2})(?:일)?(?:까지)?/g,(_,y,m,d)=>{patch.delivery_by=`${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;});
  take(/배송일\s*조건\s*취소/g,()=>{patch.delivery_by=null;});
  rest=rest.replace(/(?:선물)?(?:을|를)?\s*(?:찾습니다|찾는\s*중(?:이야|이에요|입니다)?|찾고\s*있(?:습니다|어요))|(?:줄|드릴)\s*만한|(?:을|를)?\s*선물할\s*거(?:예요|에요|야)|있을까요|후보(?:를)?|한도(?:로)?|이하로|사려고\s*합니다|골라\s*주세요|도착할|변경해\s*주세요|같은\s*종류로|상한만|줄일게|생각이\s*바뀌어서|보고\s*싶어|쓸게|원하는\s*건|이고|입니다|까지예요|맞추고\s*싶어/g,' ');
  // Only recognized filler may disappear. Unconsumed text triggers the LLM/clarification route.
  rest=rest.replace(/(?:줄|드릴|할)\s*(?:거야|거예요|거에요|건데|게요)|안쪽(?:으로)?|안으로|내로|미만|정도|해\s*주세요|(?:(?:드릴|줄|드리는|주는)\s+)?선물(?:로)?|추천해주세요|추천해줘|추천|골라줘|찾아줘|상품|예산(?:은|이)?|이하|이내|상한|으로|에게|한테|께|그리고|해줘|주세요|해주세요|변경(?:해\s*(?:줘|주세요))?|(?:바꿔|줄여|낮춰|올려|늘려|맞춰)\s*(?:줘|주세요)|수정|까지|부탁(?:해요|해|드려요|드립니다)|(?:사려|하려|드리려|주려)(?:고|는데)|찾고\s*있어|찾는\s*중|고민\s*중|뭐가\s*좋을까|뭐\s*사지|어떤\s*게\s*좋을까|해\s*줘|요/g,'').replace(/[\s,.!?~]/g,'');
  // Words that carry no condition once the rest was understood: activity verbs after a product word
  // ("골프 치세요"), plain affect adjectives ("귀여운 인형") and soft endings ("6만원까지 괜찮아").
  if (Object.keys(patch).length) rest=rest.replace(/치세|치셔|치시고|들으세|들으셔|귀여운|예쁜|이쁜|멋진|올려서|늘려서|낮춰서|줄여서|괜찮아|괜찮|돼|보고싶어|하고싶어|싶어|바꿀게|할게|다시|해줘|하세|하셔|(?:바꿔|낮춰|줄여|올려|늘려|골라봐)(?=$|[\s,.!?])|다른(?:거|것|걸|상품|제품)(?:로|으로)?/g,'');
  if (rest) return unknown();
  if (!Object.keys(patch).length&&!limitations.length) return unknown();
  if (patch.delivery_by!==undefined && patch.delivery_by!==null) {
    const date=new Date(patch.delivery_by);
    if (!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==patch.delivery_by) return question('실제 수령 마감일을 YYYY-MM-DD 형식으로 알려주세요.');
  }
  if (patch.quantity!==undefined && (!Number.isSafeInteger(patch.quantity)||patch.quantity<1||patch.quantity>1000)) return question('수량을 1개 이상으로 알려주세요.');
  if(selectedCategories.size&&/(?:으로|로)\s*(?:바꿔|변경|보고\s*싶)|말고|보다는/.test(text)) {
    const typeCategory={'type:tea':'coffee_tea','type:coffee':'coffee_tea','type:writing':'stationery','type:bouquet':'flower'};
    patch.preferences=patch.preferences.filter(p=>p.startsWith('category:')?selectedCategories.has(p.slice(9)):typeCategory[p]?selectedCategories.has(typeCategory[p]):true);
  }
  const excluded=patch.excluded_categories??state.excluded_categories;
  if ((patch.preferences??[]).some(x=>x.startsWith('category:')&&excluded.includes(x.slice(9)))) return question('선호 상품군과 제외 상품군이 겹쳐요. 적용할 조건을 확인해 주세요.');
  return {patch,questions:followUps,unresolved:false,route:'rules',...(limitations.length?{limitations:unique(limitations)}:{})};
}

export function classifyIntent(text, state) {
  const normalized=normalizeMoney(text).trim();
  if (/^(?:다시\s*)?(?:추천|추천해줘|추천해주세요|선물\s*추천해줘|보여줘)[.!?]?$/.test(normalized)) return {kind:'view',intent:'recommend'};
  if (/^(?:왜|추천\s*이유|이유|설명)(?:\s*(?:추천했어|추천했어요|추천한\s*거야|알려줘|설명해줘|해줘))?[.!?]?$/.test(normalized)) return {kind:'view',intent:'explain'};
  // "왜 이게 1위야?", "1위는 왜 추천했어?", "왜 이걸 추천했어?": asking why the current result is what it is.
  if (/왜/.test(normalized) && !moneyValues(normalized).length && /^(?:(?:왜|이게|이거|이걸|이\s*상품(?:이|을)?|\d+\s*(?:위|등)(?:는|가|야|이야|예요|에요|인가요)?|추천(?:했어(?:요)?|한\s*거야|했나요)|골랐어(?:요)?|이렇게|나왔어(?:요)?)\s*)+[.!?]*$/.test(normalized)) return {kind:'view',intent:'explain'};
  if (/이라면|이면|올리면|늘리면|줄이면|낮추면|바꾸면|가정|비교/.test(normalized)) {
    const values=moneyValues(normalized);
    const rest=normalized.replace(/\d+(?:\.\d+)?\s*(만\s*원|천\s*원|원)/g,'').replace(/예산|상한|을|를|으로|로|에서|더|이라면|이면|올리면|늘리면|줄이면|낮추면|바꾸면|가정|비교|해줘|하면|어때|어떻게|뭐가|달라져|돼|요|[\s,.!?]/g,'');
    if (!rest&&values.length===1) {
      // "7만원으로 올리면" names the new amount; "3만원 (더) 올리면" names the change.
      const delta=/올리면|늘리면|줄이면|낮추면/.test(normalized)&&!/(?:만\s*원|천\s*원|원)\s*(?:으로|로)\s*(?:더\s*)?(?:올리면|늘리면|줄이면|낮추면)/.test(normalized);
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
