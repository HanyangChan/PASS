// Explicit tea and coffee preferences share a catalog category.
const TYPE_PREFERENCES=['type:tea','type:coffee'];
export function isGiftSet(product) {
 return product.gift_set === true || /선물\s*(?:세트|박스)|\bgift[\s-]*set\b/i.test(`${product.name??''} ${product.name_en??''}`);
}
const nameOf=product=>`${product.name??''} ${product.name_en??''}`;
// Items labelled for the other gender are not offered to a recipient whose gender is known.
export function genderMismatch(product,gender) {
 if(!gender||/unisex|남녀\s*공용|유니섹스/i.test(nameOf(product)))return false;
 const name=nameOf(product);
 if(gender==='male')return /여성|여자|레이디|숙녀|걸스|\bwom[ae]n'?s?\b|\bladies\b|\bgirls?\b|\bher\b/i.test(name);
 return /남성|남자|맨즈|\bmen'?s?\b|\bboys?\b|\bhis\b|수염|면도|\bbeard\b|\bshav(?:er|ing)\b/i.test(name);
}
// How much a product reads as a gift: sets and gift boxes up, pantry staples and device parts down.
// ponytail: name keywords only; replace with a curated gift flag in the catalog when one exists.
export function giftFit(product) {
 const name=nameOf(product);
 // Listing titles say "perfect gift" for anything, so only real sets, boxes and hampers count.
 if(isGiftSet(product)||/선물\s*(?:세트|박스|상자|바구니)|기프트\s*(?:박스|세트)|\bgift\s*(?:box|hamper|basket)\b|\bhamper\b/i.test(name))return 1;
 if(/감미료|sweetener|(?<![가-힣])기\s*\d|\bghee\b|밀가루|\bflour\b|\batta\b|설탕|소금|식용유|cooking oil|코코넛\s*오일|coconut oil|풍선|balloon|베이킹\s*매트|baking mat|쿡탑|cooktop|가스\s*(?:레인지|스토브)|\bstove\b|압력솥|pressure cooker|이들리|\bidli\b|파니야라캄|paniyaram|패치|\bpatch(?:es)?\b|트리머\s*벨트|waist trimmer|케이스|\bcase\b|스트랩|\bstrap\b|충전기|charger|케이블|\bcable\b|리필|refill|디스플레이\s*케이스/i.test(name))return -2;
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
 if(product.category!=='coffee_tea')return [];
 const name=`${product.name??''} ${product.name_en??''}`;
 const types=[];
 if(/\btea\b|matcha|oolong|sencha|rooibos|홍차|녹차|우롱|말차|보이차|허브차|전통차|티백|차\s*(?:선물|세트)/i.test(name))types.push('type:tea');
 if(/coffee|espresso|cappuccino|커피|에스프레소|카푸치노|원두/i.test(name))types.push('type:coffee');
 return types;
}
export function typeScore(product,state) {
 const wanted=state.preferences.filter(p=>TYPE_PREFERENCES.includes(p));
 return wanted.length&&productTypes(product).some(p=>wanted.includes(p))?3:0;
}
