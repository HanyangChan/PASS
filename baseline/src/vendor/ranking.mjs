// Explicit tea and coffee preferences share a catalog category.
const TYPE_PREFERENCES=['type:tea','type:coffee','type:writing','type:bouquet'];
export function isGiftSet(product) {
 return product.gift_set === true || /선물\s*(?:세트|박스)|\bgift[\s-]*set\b/i.test(`${product.name??''} ${product.name_en??''}`);
}
const nameOf=product=>`${product.name??''} ${product.name_en??''}`;
// Items labelled for one gender. Korean listing titles also stuff recipient words ("남자친구 부모님
// 선물"), so "남자친구/여자친구" are not labels, and a title naming both genders is unisex.
const FOR_WOMEN=/여성|여자(?!\s*친구)|우먼|레이디|숙녀|걸스|\bwom[ae]n'?s?\b|\bladies\b|\bgirls?\b|\bher\b/i;
const FOR_MEN=/남성|남자(?!\s*친구)|맨즈|\bmen'?s?\b|\bboys?\b|\bhis\b|수염|면도|\bbeard\b|\bshav(?:er|ing)\b/i;
export function genderMismatch(product,gender) {
 const name=nameOf(product);
 if(!gender||/unisex|남녀\s*공용|유니섹스|커플/i.test(name)||(FOR_WOMEN.test(name)&&FOR_MEN.test(name)))return false;
 return (gender==='male'?FOR_WOMEN:FOR_MEN).test(name);
}
// Baby/kid products for adults, and school-exam items for parents and grandparents.
const FOR_KIDS=/아기|신생아|유아|베이비|\bbaby\b|\binfant\b|\btoddler\b|키즈|\bkids?\b|어린이|아동|유치원/i;
const FOR_STUDENTS=/수능|수험생|고등\s*학생|중학생|초등학생|학생용/;
export function ageMismatch(product,age) {
 const name=nameOf(product);
 if(age==='child')return false;
 if(age==='teen'&&/초등|유치원|어린이날|아동용/.test(name))return true;
 if(age==='elder'&&FOR_STUDENTS.test(name))return true;
 return Boolean(age)&&FOR_KIDS.test(name);
}
// Occasion words → occasion tags carried by the Korean web catalog.
const OCCASION_TAGS={명절:'holiday',설:'holiday',추석:'holiday',생일:'birthday',수험:'exam'};
export const occasionFit=(product,occasion)=>Boolean(occasion&&product.occasions?.includes(OCCASION_TAGS[occasion]));
// Items whose title ties them to one occasion (opening-day plants, exam-luck sweets) do not suit another.
const SPECIFIC_OCCASIONS=[[/개업|개원|오픈\s*축하/,['개업']],[/승진|영전|취임/,['승진']],[/수능|수험생|합격\s*(?:엿|기원)|합격의\s*맛|시험\s*응원/,['수험','합격']]];
export const occasionClash=(product,occasion)=>SPECIFIC_OCCASIONS.some(([re,fits])=>re.test(nameOf(product))&&!fits.includes(occasion));
// Contextual gift fit, not a medical suitability claim or inferred recipient taste.
export function recipientGiftFit(product,state,age) {
 const name=nameOf(product);
 let score=0;
 if(age==='elder'&&product.category==='health') {
  if(/찜질기|찜질팩|안마기|마사지기/.test(name))score++;
  if(/웨이|프로틴|BCAA|크레아틴|whey|protein|creatine|mass\s*gainer/i.test(name))score-=2;
 }
 if(state.recipients.some(r=>/상사|직장|동료|교수|선생/.test(r))&&/여성.*양말|여성.*잠옷|여성.*속옷|남성.*속옷/.test(name))score--;
 if(state.excluded_categories.includes('liquor')&&/와인잔|와인\s*오프너|소주잔|맥주잔|위스키잔|wine\s*(?:glass|opener)/i.test(name))score-=2;
 if(state.occasion==='생일'&&/졸업(?:식)?/.test(name)&&!(/생일|생신|birthday/i.test(name)))score--;
 return score;
}
// How much a product reads as a gift: sets and gift boxes up, pantry staples and device parts down.
// ponytail: name keywords only; replace with a curated gift flag in the catalog when one exists.
export function giftFit(product) {
 const name=nameOf(product);
 // Listing titles say "perfect gift" for anything, so only real sets, boxes and hampers count.
 if(isGiftSet(product)||/선물\s*(?:세트|박스|상자|바구니)|기프트\s*(?:박스|세트)|\bgift\s*(?:box|hamper|basket)\b|\bhamper\b/i.test(name))return 1;
 if(/감미료|sweetener|(?<![가-힣])기\s*\d|\bghee\b|밀가루|\bflour\b|\batta\b|설탕|소금|식용유|cooking oil|코코넛\s*오일|coconut oil|풍선|balloon|베이킹\s*매트|baking mat|쿡탑|cooktop|가스\s*(?:레인지|스토브)|\bstove\b|압력솥|pressure cooker|이들리|\bidli\b|파니야라캄|paniyaram|패치|\bpatch(?:es)?\b|트리머\s*벨트|waist trimmer|케이스|\bcase\b|스트랩|\bstrap\b|충전기|charger|케이블|\bcable\b|리필|refill|디스플레이\s*케이스|연장\s*(?:줄|체인)|교체용|부품|파우치|\bpouch\b/i.test(name))return -2;
 return 0;
}
// Sweet by tag or by name; "no added sugar" style labels are not sweet.
export function looksSweet(product) {
 if(product.sweetness==='sweet')return true;
 const name=nameOf(product);
 if(/무설탕|무가당|unsweetened|no added sugar|sugar[- ]free|zero sugar/i.test(name))return false;
 return /초콜릿|chocolate|캔디|\bcand(?:y|ies)\b|사탕|쿠키|\bcookies?\b|케이크|\bcakes?\b|젤리|\bjelly\b|gumm(?:y|ies)|캐러멜|caramel|마시멜로|marshmallow|도넛|donut|와플|waffle|\bsweets\b|디저트|dessert|(?<![가-힣])꿀|\bhoney\b|(?<![가-힣])잼|\bjam\b|라두|\bladdoo\b|바르피|\bbarfi\b/i.test(name);
}
export function productTypes(product) {
 if(product.category==='stationery')return /필기구|볼펜|만년필|샤프|형광펜|(?<![가-힣])펜|\b(?:pen|pens|pencil|pencils|highlighter)\b/i.test(nameOf(product))?['type:writing']:[];
 if(product.category==='flower')return /꽃다발|bouquet/i.test(nameOf(product))?['type:bouquet']:[];
 if(product.category!=='coffee_tea')return [];
 const name=`${product.name??''} ${product.name_en??''}`;
 const types=[];
 const coffee=/coffee|espresso|cappuccino|커피|에스프레소|카푸치노|원두/i.test(name);
 if(/\btea\b|matcha|oolong|sencha|rooibos|홍차|녹차|우롱|말차|보이차|허브차|전통차|차\s*(?:선물|세트)/i.test(name)||(!coffee&&/티백/.test(name)))types.push('type:tea');
 if(coffee)types.push('type:coffee');
 return types;
}
export function matchesRequestedGift(product,state) {
 const explicitCategories=state.preferences.filter(p=>p.startsWith('category:')).map(p=>p.slice(9));
 const implied={'type:tea':'coffee_tea','type:coffee':'coffee_tea','type:writing':'stationery','type:bouquet':'flower'};
 const categories=explicitCategories.length?explicitCategories:state.preferences.filter(p=>implied[p]).map(p=>implied[p]);
 if(categories.length&&!categories.includes(product.category))return false;
 const wanted=state.preferences.filter(p=>TYPE_PREFERENCES.includes(p));
 const relevant=wanted.filter(p=>product.category==='coffee_tea'?['type:tea','type:coffee'].includes(p):product.category==='stationery'?p==='type:writing':product.category==='flower'?p==='type:bouquet':false);
 if(!relevant.length)return true;
 const types=productTypes(product);
 if(relevant.length&&!relevant.some(p=>types.includes(p)))return false;
 if(relevant.length===1&&product.category==='coffee_tea'&&types.some(p=>p!==relevant[0]))return false;
 return true;
}
export function typeScore(product,state) {
 const wanted=state.preferences.filter(p=>TYPE_PREFERENCES.includes(p));
 return wanted.length&&productTypes(product).some(p=>wanted.includes(p))?3:0;
}
