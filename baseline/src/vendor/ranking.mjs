// Explicit tea and coffee preferences share a catalog category.
const TYPE_PREFERENCES=['type:tea','type:coffee'];
export function isGiftSet(product) {
 return product.gift_set === true || /선물\s*(?:세트|박스)|\bgift[\s-]*set\b/i.test(`${product.name??''} ${product.name_en??''}`);
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
