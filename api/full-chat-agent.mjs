import { createAgent, FullChatError, isIngredientQuestion } from '../baseline/agents/full-chat/index.mjs';
import { createSession, runTurn as coreTurn } from '../baseline/src/index.mjs';
import { engineState, publicState, finishSingle, singleQuestion } from '../lib/single-gift.mjs';
import { APP_RANKING, recommend } from '../lib/engine.mjs';
import { budgetAlternatives } from '../lib/counterfactual.mjs';
import { FRAGRANCE_NOTICE, FRAGRANCE_TAG } from '../lib/fragrance.mjs';
import { lookupCatalogItem } from './catalog-item-lookup.mjs';
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
  const before=input.state;
  const matches=input.operation==='turn'?lookupCatalogItem(input.text,products):null;
  const candidates=matches===null?products:matches.length===1?matches:[];
  const catalog=candidates.map(p=>({...p,rating_count:p.rating_count??0}));
  const session={...createSession('prototype-request'),state:engineState(before)};
  const request={expectedVersion:0,...(input.operation==='turn'?{kind:'message',text:input.text}:input.operation==='conditions'?{kind:'patch',patch:input.routerPatch??input.patch}:{kind:'view'})};
  const pending=singleQuestion({state:before,issues:input.issues});
  let output;
  try {
    const pendingQuestion=input.issues.find(isIngredientQuestion)??input.issues[0]??(pending.key?pending.text:'');
    output=await agentFactory({env,fetcher,decide,ranking,...limits}).runTurn({session,request,products:catalog,pendingQuestion,history:input.history??[],signal});
  } catch(error) {
    const reason=error.routing?.failureCode??error.code;
    if(input.operation!=='turn'||signal?.aborted||!(error instanceof FullChatError)||!recoverableModelErrors.has(reason))throw error;
    const message='이번 요청을 마치지 못했어요. 조건은 그대로예요. 다시 시도하거나 조건을 직접 바꿔주세요.';
    return {session:{state:before,issues:input.issues},changes:[],question:noQuestion,message,view:emptyView(noQuestion,message),
      agent:agent??error.routing.agent,mode:error.routing.llmCalls?'llm':'rules',routing:{...error.routing,agent:agent??error.routing.agent,route:'fallback',stopReason:reason}};
  }
  const activeAgent=agent??output.routing.agent;
  const routing={...output.routing,agent:activeAgent};
  if(output.kind==='closed') {
    const message='여기서 마칠게요.';
    return {session:{state:before,issues:input.issues},changes:[],question:noQuestion,message,view:emptyView(noQuestion,message),agent:activeAgent,mode:'rules',routing};
  }
  const state=publicState(output.session.state);
  let issues=[];
  if(output.kind==='question') {
    const missing=await coreTurn({session:output.session,products:catalog,request:{kind:'view',expectedVersion:output.session.version}});
    if(missing.kind!=='question'||missing.question!==output.question) issues=[output.question];
  }
  if(input.operation==='conditions'&&input.clearIssues===false) issues=input.issues;
  if(output.kind==='conversation') issues=input.issues;
  const turn=finishSingle(before,state,issues,candidates,ranking);
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
      return {...turn,message,question,view:emptyView(question,message),mode:routing.llmCalls?'llm':'rules',agent:activeAgent,
        routing:{...routing,stopReason:matches.length?'ambiguous_product':'product_not_found'}};
    } else {
      const applied=engineState(state);
      view={question:turn.question,result:recommend(candidates,applied,ranking),comparison:budgetAlternatives(candidates,applied,ranking)};
    }
  }
  return {...turn,message,...(view?{view}:{}),mode:routing.llmCalls?'llm':'rules',agent:activeAgent,routing};
}
