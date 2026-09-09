import {apply, budgetCost, rankProducts} from './engine.mjs';

const won = value => `${value.toLocaleString('ko-KR')}원`;
const packing = {formal:'격식 있는 포장',basic:'기본 포장'};
const sweetness = {unsweetened:'단맛 없음',naturally_sweet:'자연 단맛',sweet:'단맛 있음'};
const scopeLabel = state => state.budget.scope === 'total' ? '총예산' : '세트당 예산';

// This is a what-if query of this recommender, not a causal claim about people.
// Every alternative changes only the budget cap and is actually re-ranked.
export function budgetAlternatives(products, state) {
 const baseline = rankProducts(products, state);
 if (['needs_clarification','insufficient_product_info'].includes(baseline.status))
  return {status:baseline.status,message:baseline.message,alternatives:[]};
 if (!Number.isSafeInteger(state.budget.amount_krw) || state.budget.amount_krw <= 0 || !['per_set','total'].includes(state.budget.scope))
  return {status:'needs_budget',message:'예산 상한을 정하면, 얼마를 바꿀 때 어떤 후보가 추가되는지 비교할 수 있어요.',alternatives:[]};
 if (!Number.isSafeInteger(state.quantity) || state.quantity < 1 || state.budget.shipping_included === null)
  return {status:'needs_clarification',message:'정확한 비교를 위해 세트 수와 배송비 포함 여부를 알려주세요. 예: “한 세트, 상품값 5만 원 이하”.',alternatives:[]};
 const relaxed = apply(state,{budget:{amount_krw:null}});
 const available = rankProducts(products,relaxed).items;
 const thresholds = [...new Set(available.map(p=>budgetCost(p,state)).filter(n=>Number.isSafeInteger(n)&&n>state.budget.amount_krw))].sort((a,b)=>a-b);
 const originalIds = baseline.items.slice(0,3).map(p=>p.id);
 const current = baseline.items[0] || null;
 const alternatives = thresholds.slice(0,2).map(amount=>{
  const nextState=apply(state,{budget:{amount_krw:amount}});
  const ranked=rankProducts(products,nextState).items;
  // Best-ranked newly eligible item at this exact threshold.
  const target=ranked.find(p=>budgetCost(p,state)===amount);
  const targetRank=ranked.findIndex(p=>p.id===target.id)+1;
  const topIds=ranked.slice(0,3).map(p=>p.id);
  const changed=JSON.stringify(originalIds)!==JSON.stringify(topIds);
  const effect=!current?'first_match':targetRank===1?'top_changed':changed?'top_three_changed':'eligible_only';
  const effectText={first_match:'추천 가능한 상품이 생겨요.',top_changed:'첫 번째 추천이 바뀌어요.',top_three_changed:'추천 3개 구성이 바뀌어요.',eligible_only:'추천 상위 3개는 유지되고, 선택 가능한 후보가 늘어요.'}[effect];
  const facts=[];
  if(current){
   if(current.packaging!==target.packaging)facts.push(`포장: ${packing[current.packaging]} → ${packing[target.packaging]}`);
   if(current.sweetness!==target.sweetness)facts.push(`단맛: ${sweetness[current.sweetness]} → ${sweetness[target.sweetness]}`);
   if(current.arrival_date!==target.arrival_date)facts.push(`모의 도착일: ${current.arrival_date} → ${target.arrival_date}`);
  }
  const rankingReason = !current ? '현재 예산에서는 추천 가능한 상품이 없어요.' : target.score>current.score ? '이 후보는 현재 선호에 더 잘 맞지만, 지금은 예산 상한을 넘어서 제외됐어요.' : target.score===current.score ? (target.price_krw > current.price_krw ? '선호 적합도는 같고 현재 추천의 상품값이 더 낮아요. 예산을 올려도 비싼 상품을 우선하지 않아요.' : target.price_krw < current.price_krw ? '이 후보의 상품값은 더 낮지만 배송비를 포함한 비용이 현재 예산을 넘어요.' : '선호 적합도와 상품값은 같아요. 비용 조건을 통과한 뒤에는 정해진 상품 순서로 정렬해요.') : '현재 추천이 선호에 더 잘 맞아요. 이 후보가 예산 안에 들어와도 첫 번째 추천이 되지는 않아요.';
  return {
   id:`budget-${amount}`,patch:{budget:{amount_krw:amount}},amount,delta:amount-state.budget.amount_krw,
   scope:state.budget.scope,shippingIncluded:state.budget.shipping_included,quantity:state.quantity,
   current,target,targetRank,topIds,effect,effectText,facts,rankingReason,
   title:`${scopeLabel(state)}을 ${won(amount-state.budget.amount_krw)} 올리면`,
   exclusionReason:`${target.name}은 ${scopeLabel(state)} 기준 ${won(amount)}이 필요해 현재 상한보다 ${won(amount-state.budget.amount_krw)} 초과해요.`,
  };
 });
 return {status:alternatives.length?'ready':'no_alternative',message:alternatives.length?'현재 예산은 그대로예요. 예산 상한만 바꿔 다시 계산한 결과입니다.':'다른 조건을 유지하면, 예산만 올려 새로 추가되는 후보가 없어요.',alternatives};
}
