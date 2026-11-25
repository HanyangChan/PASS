// Prototype session/response adapter. Model keys remain in the server Worker.
import { createAgent } from '../baseline/agents/a-router/index.mjs';
import { createSession, missingCondition } from '../baseline/src/index.mjs';
import { engineState, publicState, finishSingle } from '../lib/single-gift.mjs';
import { APP_RANKING, rankProducts } from '../lib/engine.mjs';
import { budgetAlternatives } from '../lib/counterfactual.mjs';
import { catalogLookupNeedsInterpretation, lookupIndexedCatalogItem, lookupRankedCatalogItem } from './catalog-item-lookup.mjs';
import { validateState } from '../lib/llm.mjs';
import { createSubagentInterpreter } from '../baseline/agents/a-router/subagents/interpreter.mjs';
import { FRAGRANCE_NOTICE, FRAGRANCE_TAG } from '../lib/fragrance.mjs';

function changedPatch(before, after) {
  const patch={};
  for (const key of Object.keys(before)) {
    if (key==='budget') {
      const budget={};
      for (const k of Object.keys(before.budget)) if (JSON.stringify(before.budget[k])!==JSON.stringify(after.budget[k])) budget[k]=after.budget[k];
      if (Object.keys(budget).length) patch.budget=budget;
    } else if (JSON.stringify(before[key])!==JSON.stringify(after[key])) patch[key]=after[key];
  }
  return patch;
}
export class RouterInterpretationError extends Error {
  constructor(routing) {super('router_interpretation_unavailable');this.routing=routing;}
}
const asinRequest=/^(?:(?:상품\s*)?ASIN\s*[:#]?\s*|https?:\/\/(?:[\w-]+\.)?amazon\.[a-z.]+\/dp\/)([A-Z0-9]{10})(?:\s*(?:상품|제품))?(?:\s*(?:찾아|보여)(?:\s*(?:줘|주세요|줄래))?)?[.!?\s]*$/i;
const ingredientIssue=q=>/성분|알레르기|알러지/.test(q);
const emptyView=(question,message)=>({
  question,result:{status:'reference',items:[],message,notice:null},
  comparison:{status:'no_alternative',alternatives:[],message:''},
});

export async function prototypeRouterTurn(input, products, {extract, apiKey, model, fetcher, llmMode='single', signal, ranking=APP_RANKING, ...providerOptions}) {
  const before=input.state;
  // Existing app intentionally exposes a ONE-gift state, not the multi-set core contract.
  const session={...createSession('prototype-request'),state:engineState(before)};
  const timings={lookupMs:0,modelMs:0,rankingMs:0,rankingRuns:0,recommendationRuns:0,responseMs:0};
  const asin=input.operation==='turn'?asinRequest.exec(input.text)?.[1]:null;
  const lookupStarted=performance.now();
  const matches=asin?lookupIndexedCatalogItem('ASIN '+asin,products):
    input.operation==='turn'?lookupRankedCatalogItem(input.text,products):null;
  const directLookup=asin || (matches!==null && !input.issues.length &&
    !catalogLookupNeedsInterpretation.test(input.text) &&
    !/(?:에게|한테|까지|한도|수량|합해|기준으로|이유)|\b(?:under|max(?:imum)?|by tomorrow|for my)\b/i.test(input.text));
  timings.lookupMs=performance.now()-lookupStarted;
  const candidates=matches===null?products:matches.length===1?matches:[];
  const rankingForTurn=!asin&&matches?.length===1?{...ranking,giftAware:false,strictGiftPreferences:false}:ranking;
  const catalog=candidates.every(p=>p.rating_count!=null)?candidates:candidates.map(p=>({...p,rating_count:p.rating_count??0}));
  const rank=(items,state,options)=>{
    const started=performance.now();
    timings.rankingRuns++;
    try { return rankProducts(items,state,options); }
    finally { timings.rankingMs+=performance.now()-started; }
  };
  const recommendations=new Map();
  const reuseRecommendation=(_items,state)=>{
    const key=JSON.stringify(state,(_,value)=>value && typeof value==='object' && !Array.isArray(value)
      ?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
    if(!recommendations.has(key)) {
      timings.recommendationRuns++;
      const result=rank(catalog,state,rankingForTurn);
      recommendations.set(key,{...result,items:result.items.slice(0,3)});
    }
    return recommendations.get(key);
  };
  const interpret=apiKey ? llmMode==='subagents' ? createSubagentInterpreter({llmOptions:{...providerOptions,apiKey,model,fetcher}}) : async ({text,state,history,signal:turnSignal}) => {
    const stateBefore=publicState(state);
    const turn=await extract({text,state:stateBefore,issues:input.issues,history,source:input.source??'typed'},products,{...providerOptions,reasoningEnabled:providerOptions.reasoningEnabled??(model?.startsWith('deepseek-')?false:undefined),apiKey,model,fetcher,signal:turnSignal,conditionsOnly:true,retainAllergens:false,additionalInstructions:'Only recipient-attributed facts may update gift conditions. Never apply giver preferences to the recipient. If ownership is unclear, ask a clarification question. When a recipient changes, do not copy prior recipient tastes or restrictions. Do not remove a hard exclusion from an unmentioned condition. A pending shipping question does not prevent accepting other explicit condition updates. Abstract practicality has no preference enum; do not invent one. Return no invented product or explanation.'});
    if(Object.hasOwn(turn,'patch')) return turn;
    validateState(turn.session?.state);
    if (!Array.isArray(turn.session.issues)||turn.session.issues.some(q=>typeof q!=='string'||q.length>400)) throw Error('invalid_extraction');
    return {patch:changedPatch(stateBefore,turn.session.state),questions:turn.session.issues,unresolved:turn.session.issues.length>0};
  } : undefined;
  const agent=createAgent({singleGift:true,ranking:rankingForTurn,recommendProducts:reuseRecommendation,...(interpret?{interpret:async args=>{
    const started=performance.now();
    try { return await interpret(args); }
    finally { timings.modelMs+=performance.now()-started; }
  }}:{})});
  const request={expectedVersion:0,...(directLookup?{kind:'view'}:input.operation==='turn'?{kind:'message',text:input.text}:input.operation==='conditions'?{kind:'patch',patch:input.routerPatch??input.patch}:{kind:'view'})};
  const pending=input.issues.find(ingredientIssue)??input.issues[0]??'';
  const output=await agent.runTurn({session,request,products:catalog,pendingQuestion:pending,history:input.history??[],signal});
  const responseStarted=performance.now();
  const rankingBeforeResponse=timings.rankingMs;
  const routing={...output.routing,timings};
  if (output.routing.route==='llm_error') throw new RouterInterpretationError(output.routing);
  // The prototype does not support multi-gift output or changing its budget scope.
  if (output.session.state.quantity!==1||output.session.state.same_product!==true||output.session.state.budget.scope!=='per_set') {
    const turn=finishSingle(before,before,['현재 앱은 선물 하나 기준입니다. 선물 하나의 예산과 조건을 알려주세요.'],catalog,ranking,reuseRecommendation);
    return {...turn,view:emptyView(turn.question,turn.message),mode:'rules',agent:'a-router',routing:{...routing,route:'clarification'}};
  }
  const state=publicState(output.session.state);
  let issues=output.kind==='question' && missingCondition(output.session.state)!==output.question?[output.question]:[];
  if (input.operation==='conditions' && input.clearIssues===false) issues=input.issues;
  // A missing allergy ingredient is blocking until an ingredient or explicit cancellation arrives.
  if (JSON.stringify(state.recipients)===JSON.stringify(before.recipients) && ingredientIssue(pending) && !/알레르기\s*(없|해제|취소)/.test(input.text??'') && JSON.stringify(state.excluded_ingredients)===JSON.stringify(before.excluded_ingredients)) issues=ingredientIssue(issues[0]??'')?issues:[pending,...input.issues.filter(issue=>issue!==pending)];
  if (matches && matches.length!==1 && (asin?!issues.some(ingredientIssue):output.kind!=='question'&&!issues.length)) {
    issues=[asin?(matches.length?'같은 ASIN의 상품이 여럿 있어요. 상품 링크를 확인해 주세요.':'카탈로그에서 이 ASIN의 상품을 찾지 못했어요.'):
      (matches.length?'일치하는 상품이 여러 개예요. 색상이나 정확한 모델명을 알려주세요.':'카탈로그에서 상품을 찾지 못했어요. 정확한 모델명이나 ASIN을 알려주세요.')];
    routing.stopReason=matches.length?'ambiguous_product':'product_not_found';
  }
  const turn=finishSingle(before,state,issues,catalog,rankingForTurn,reuseRecommendation);
  let message=turn.message;
  if (output.kind==='comparison' && !issues.length) {
    const amount=output.evaluatedState.budget.amount_krw;
    const summary=output.result.cards.length?output.result.cards.map(p=>`${p.rank}위 ${p.name} (${p.budget_cost_krw.toLocaleString('ko-KR')}원)`).join(', '):'조건에 맞는 상품이 없습니다.';
    message=`예산을 ${amount.toLocaleString('ko-KR')}원으로 가정해 다시 계산했어요. ${summary}\n현재 예산은 그대로입니다. 적용하려면 조건에서 예산을 변경해 주세요.`;
  } else if (output.routing.intent==='explain' && output.result && !issues.length) {
    message=output.result.message;
  }
  if (output.kind==='comparison' && output.result?.notice) message+=`\n${output.result.notice}`;
  if(state.preferences.includes(FRAGRANCE_TAG)&&!message.includes(FRAGRANCE_NOTICE))message+='\n'+FRAGRANCE_NOTICE;
  const blocked=issues.some(ingredientIssue) || (matches && (matches.length!==1 || (!asin && turn.question.key)));
  const applied=engineState(state);
  const result=blocked?null:reuseRecommendation(catalog,applied);
  const view=blocked?emptyView(turn.question,message):{question:turn.question,result,comparison:budgetAlternatives(catalog,applied,rankingForTurn,{baseline:result,rank})};
  timings.responseMs=Math.max(0,performance.now()-responseStarted-(timings.rankingMs-rankingBeforeResponse));
  return {...turn,message,view,mode:output.routing.llmCalls?'llm':input.source==='quick_reply'?'rules_fast':'rules',agent:'a-router',routing};
}
