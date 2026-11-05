// Shared deterministic recommendation policy; budget remains an upper bound, never a price floor.
export const RANKING_POLICY='gift-budget-diversity-v2';
export const TYPE_PREFERENCES=['type:tea','type:coffee'];
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
export function rankingFacts(product,state,cost) {
 const cap=state.budget.amount_krw;
 const ratio=Number.isSafeInteger(cap)&&cap>0?cost/cap:null;
 const budgetFit=ratio===null?0:Math.max(0,1-Math.abs(ratio-0.8)/0.8);
 // Log reviews stop a blockbuster SKU from overwhelming every other signal.
 const reviewConfidence=Math.min(1,Math.log1p(Math.max(0,product.rating_count??0))/Math.log1p(10000));
 return {budget_ratio:ratio,budget_fit:budgetFit,ranking_utility:ratio===null?reviewConfidence:0.7*budgetFit+0.3*reviewConfidence,ranking_policy:RANKING_POLICY};
}
export function productFamily(product) {
 return `${product.category}:${(product.name_en||product.name||product.id).toLowerCase().normalize('NFKC').replace(/\([^)]*\)|\[[^\]]*\]/g,' ').replace(/\b\d+(?:\.\d+)?\s*(?:kg|g|mg|ml|l|pack|packs|pcs|pieces|count)\b/g,' ').replace(/\d+/g,' ').replace(/[^\p{L}]+/gu,' ').trim()}`;
}
export function diversify(items) {
 const remaining=[...items],ranked=[],selected=[];
 // Reorder only the recommendation slots; retain the whole eligible pool for truthful comparisons.
 while(remaining.length&&selected.length<3) {
  const bestScore=remaining[0].score;
  const peers=remaining.filter(p=>p.score===bestScore);
  const first=peers[0];
  let best=first,bestUtility=-Infinity;
  for(const p of peers) {
   // Never replace a far better budget fit simply to get a different logo/category.
   if(p.ranking_utility<first.ranking_utility-0.3)continue;
   const duplicateFamily=selected.some(x=>productFamily(x)===productFamily(p));
   const duplicateBrand=Boolean(p.brand)&&selected.some(x=>x.brand&&x.brand.toLowerCase()===p.brand.toLowerCase());
   const duplicateCategory=selected.some(x=>x.category===p.category);
   const utility=p.ranking_utility-(duplicateFamily?0.5:0)-(duplicateBrand?0.15:0)-(duplicateCategory?0.06:0);
   if(utility>bestUtility){best=p;bestUtility=utility;}
  }
  const index=remaining.indexOf(best);remaining.splice(index,1);ranked.push(best);selected.push(best);
 }
 return [...ranked,...remaining];
}
