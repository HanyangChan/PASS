import { createAgent, FullChatError, isIngredientQuestion, requiredQuestion } from '../baseline/agents/full-chat/index.mjs';
import { createSession, runTurn as coreTurn } from '../baseline/src/index.mjs';
import { engineState, publicState, finishSingle, singleQuestion } from '../lib/single-gift.mjs';
import { APP_RANKING, rankProducts, recommend } from '../lib/engine.mjs';
import { budgetAlternatives } from '../lib/counterfactual.mjs';
import { FRAGRANCE_NOTICE, FRAGRANCE_TAG } from '../lib/fragrance.mjs';
import { lookupCatalogItem, lookupIndexedCatalogItem } from './catalog-item-lookup.mjs';
import { auditCResult } from './c-result-audit.mjs';
export { FullChatError, isEndRequest } from '../baseline/agents/full-chat/index.mjs';

const recoverableModelErrors=new Set(['invalid_input','invalid_response','timeout','network_error','auth_failed','quota_exceeded','endpoint_or_model_not_found','provider_unavailable','request_rejected']);
const emptyView=(question,message)=>({
  question,
  result:{status:'reference',items:[],message,notice:null},
  comparison:{status:'no_alternative',alternatives:[],message:''},
});
const noQuestion={key:null,text:'',choices:[]};

const conversation={
  greeting:'안녕하세요! 받는 분과 예산을 알려주시면 선물을 함께 골라드릴게요.',
  thanks:'도움이 되었다니 기뻐요. 더 비교하거나 바꾸고 싶은 조건이 있으면 알려주세요.',
  help:'받는 분·예산·취향·제외 조건을 알려주세요. 상품 추천, 추천 이유 설명, 가상 예산 비교를 도와드릴 수 있어요.',
  acknowledge:'네, 이어서 궁금한 점이나 바꾸고 싶은 선물 조건을 알려주세요.',
};
export async function prototypeFullChatTurn(input,products,{env,fetcher,signal,decide,agent,agentFactory=createAgent,ranking=APP_RANKING,...limits}={}) {
  const started=performance.now();
  const before=input.state;
  const isB=agentFactory===createAgent && (agent===undefined || agent==='full-chat');
  const isC=agentFactory!==createAgent && /^full-chat-feedback-[12]$/.test(agent??'');
  const reuseRanking=isB||isC;
  const timings={lookupMs:0,modelMs:0,rankingMs:0,rankingRuns:0,recommendationRuns:0,responseMs:0};
  const lookupStarted=performance.now();
  const matches=input.operation!=='turn'?null:reuseRanking
    ?lookupIndexedCatalogItem(input.text,products,{matchNameWords:isC})
    :lookupCatalogItem(input.text,products);
  timings.lookupMs=performance.now()-lookupStarted;
  const candidates=matches===null?products:matches.length===1?matches:[];
  const rankingForTurn=isC&&matches?.length===1?{...ranking,giftAware:false,strictGiftPreferences:false}:ranking;
  const catalog=reuseRanking && candidates.every(p=>p.rating_count!=null)?candidates:candidates.map(p=>({...p,rating_count:p.rating_count??0}));
  const rank=(items,state,options)=>{
    const started=performance.now();
    timings.rankingRuns++;
    try { return rankProducts(items,state,options); }
    finally { timings.rankingMs+=performance.now()-started; }
  };
  const memo=new Map();
  // Each turn binds the same candidate list and ranking options throughout.
  const reuseRecommendation=(_items,state)=>{
    const key=JSON.stringify(state,(_,value)=>value && typeof value==='object' && !Array.isArray(value)
      ?Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b))):value);
    if(!memo.has(key)) {
      timings.recommendationRuns++;
      const result=rank(catalog,state,rankingForTurn);
      memo.set(key,{...result,items:result.items.slice(0,3)});
    }
    return memo.get(key);
  };
  const session={...createSession('prototype-request'),state:engineState(before)};
  const directLookup=isC&&matches!==null&&!input.issues.length&&
    !/알레르|알러지|성분|피해야|배송|예산|\d\s*(?:만\s*원|천\s*원|원)|(?:개|세트)\s*(?:합쳐|합산)|빼|변경|바꿔|설명|추천\s*이유/.test(input.text);
  const request={expectedVersion:0,...(input.operation==='turn'&&!directLookup?{kind:'message',text:input.text}:input.operation==='conditions'?{kind:'patch',patch:input.routerPatch??input.patch}:{kind:'view'})};
  const pending=singleQuestion({state:before,issues:input.issues});
  let output;
  try {
    const pendingQuestion=input.issues.find(isIngredientQuestion)??input.issues[0]??(pending.key?pending.text:'');
    output=await agentFactory({env,fetcher,decide,ranking:rankingForTurn,...limits,...(reuseRanking?{
      recommendProducts:reuseRecommendation,
      recordModelTime:ms=>{timings.modelMs+=ms;},
    }:{})}).runTurn({session,request,products:catalog,pendingQuestion,history:input.history??[],signal});
  } catch(error) {
    const reason=error.routing?.failureCode??error.code;
    if(input.operation!=='turn'||signal?.aborted||!(error instanceof FullChatError)||!recoverableModelErrors.has(reason))throw error;
    const message='이번 요청을 마치지 못했어요. 조건은 그대로예요. 다시 시도하거나 조건을 직접 바꿔주세요.';
    return {session:{state:before,issues:input.issues},changes:[],question:noQuestion,message,view:emptyView(noQuestion,message),
      agent:agent??error.routing.agent,mode:error.routing.llmCalls?'llm':'rules',routing:{...error.routing,agent:agent??error.routing.agent,route:'fallback',stopReason:reason,...(reuseRanking?{timings}:{})}};
  }
  const responseStarted=performance.now();
  const rankingBeforeResponse=timings.rankingMs;
  const activeAgent=agent??output.routing.agent;
  const routing={...output.routing,agent:activeAgent,...(reuseRanking?{timings}:{})};
  if(output.kind==='closed') {
    const message='여기서 마칠게요.';
    return {session:{state:before,issues:input.issues},changes:[],question:noQuestion,message,view:emptyView(noQuestion,message),agent:activeAgent,mode:'rules',routing};
  }
  const state=publicState(output.session.state);
  let issues=[];
  if(output.kind==='question') {
    if(reuseRanking) {
      if(requiredQuestion(output.session.state)!==output.question) issues=[output.question];
    } else {
      const missing=await coreTurn({session:output.session,products:catalog,request:{kind:'view',expectedVersion:output.session.version}});
      if(missing.kind!=='question'||missing.question!==output.question) issues=[output.question];
    }
  }
  if(input.operation==='conditions'&&input.clearIssues===false) issues=input.issues;
  if(output.kind==='conversation') issues=input.issues;
  const turn=finishSingle(before,state,issues,candidates,rankingForTurn,reuseRanking?reuseRecommendation:recommend);
  let message=turn.message;
  if(output.kind==='conversation') message=conversation[output.responseType];
  else if(output.kind==='comparison') {
    const amount=output.evaluatedState.budget.amount_krw;
    const summary=output.result.cards.length?output.result.cards.map(p=>`${p.rank}위 ${p.name} (${p.budget_cost_krw.toLocaleString('ko-KR')}원)`).join(', '):'조건에 맞는 상품이 없습니다.';
    message=`예산을 ${amount.toLocaleString('ko-KR')}원으로 가정해 비교했어요. ${summary}\n현재 예산은 그대로입니다. 적용하려면 예산을 변경해 달라고 알려주세요.`;
  } else if(output.intent==='explain'&&output.result) {
    message=output.result.cards.length?output.result.cards.map(p=>`${p.rank}위 ${p.explanation} 선호 점수 ${p.score}점입니다.`).join('\n')+'\n선호가 같으면 명절에는 선물세트를 우선해요. 그 안에서 예산에 가까운 가격대, 받는 분에게 어울리는 상품군, 리뷰 수를 비교해요.':output.result.message;
  }
  if((output.kind==='comparison'||output.intent==='explain')&&output.result?.notice) message+=`\n${output.result.notice}`;
  if(state.preferences.includes(FRAGRANCE_TAG)) {
    if(!message.includes(FRAGRANCE_NOTICE))message+='\n'+FRAGRANCE_NOTICE;
  } else if(output.limitations?.includes('scent_strength')) message+='\n향 강도 정보가 없어 ‘향이 강한 제품 제외’는 확인·적용하지 못했어요. 나머지 조건으로 조회한 결과이며, 향은 상품 상세 정보에서 확인해 주세요.';
  const blocked=output.kind==='question'&&(routing.route==='limit'||routing.stopReason==='unsupported_quantity'||isIngredientQuestion(output.question));
  let view=blocked?emptyView(turn.question,message):undefined;
  if (matches && !blocked) {
    if (output.kind==='question') view=emptyView(turn.question,message);
    else if (matches.length!==1) {
      message=matches.length?'같은 이름의 상품이 여럿 있어요. 색상이나 정확한 ASIN을 알려주세요.':'카탈로그에서 이 상품을 찾지 못했어요. 정확한 모델명이나 ASIN을 알려주세요.';
      const question={key:'issue',text:message,choices:[]};
      view=emptyView(question,message);
      routing.stopReason=matches.length?'ambiguous_product':'product_not_found';
      turn.question=question;
    } else if (!reuseRanking) {
      const applied=engineState(state);
      view={question:turn.question,result:recommend(candidates,applied,ranking),comparison:budgetAlternatives(candidates,applied,ranking)};
    }
  }
  if(reuseRanking && !view) {
    const applied=engineState(state);
    const result=reuseRecommendation(catalog,applied);
    view={question:turn.question,result,comparison:budgetAlternatives(catalog,applied,rankingForTurn,{baseline:result,rank})};
  }
  timings.responseMs=Math.max(0,performance.now()-responseStarted-(timings.rankingMs-rankingBeforeResponse));
  const remainingMs=Math.floor((limits.timeoutMs??20000)-(performance.now()-started));
  if(agent==='full-chat-feedback-2'&&input.operation==='turn'&&!blocked&&view&&
      (output.kind==='recommendation'||matches!==null)&&routing.llmCalls+2<=(limits.maxCalls??10)&&remainingMs>0) {
    const auditStarted=performance.now();
    const {info,items}=await auditCResult({env,fetcher,signal,timeoutMs:remainingMs,input,state,view,matches});
    timings.modelMs+=performance.now()-auditStarted;
    routing.resultAudit=info;
    routing.llmCalls+=info.calls;
    routing.httpAttempts+=info.httpAttempts;
    for(const key of Object.keys(info.usage)) routing.usage[key]=(routing.usage[key]??0)+info.usage[key];
    if(info.confirmedRequestConflict && view.result.items.length) {
      message='추천에 적용된 조건을 다시 확인해야 해요. 예산이나 배송 조건을 확인해 주세요.';
      const question={key:'issue',text:message,choices:[]};
      return {session:{state:before,issues:[...input.issues,message]},changes:[],question,message,view:emptyView(question,message),
        agent:activeAgent,mode:'llm',routing:{...routing,stopReason:'result_condition_mismatch'}};
    }
    if(info.removedCards) {
      // Hide the old budget alternatives as they refer to the pre-audit candidate cards.
      if(!items.length) message='요청과 상품 정보가 일치하는 후보를 확인하지 못했어요.';
      view={...emptyView(turn.question,message),
        result:{...view.result,...(!items.length?{status:'no_match',message}:{}),items}};
    }
  }
  return {...turn,message,...(view?{view}:{}),mode:routing.llmCalls?'llm':'rules',agent:activeAgent,routing};
}
