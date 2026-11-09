// Prototype session/response adapter. Model keys remain in the server Worker.
import { createAgent } from '../baseline/agents/a-router/index.mjs';
import { createSession } from '../baseline/src/index.mjs';
import { runTurn as coreTurn } from '../baseline/src/index.mjs';
import { engineState, publicState, finishSingle } from '../lib/single-gift.mjs';
import { APP_RANKING } from '../lib/engine.mjs';
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
export async function prototypeRouterTurn(input, products, {extract, apiKey, model, fetcher, llmMode='single', signal, ...providerOptions}) {
  const before=input.state;
  // Existing app intentionally exposes a ONE-gift state, not the multi-set core contract.
  const session={...createSession('prototype-request'),state:engineState(before)};
  const catalog=products.map(p=>({...p,rating_count:p.rating_count??0}));
  const interpret=apiKey ? llmMode==='subagents' ? createSubagentInterpreter({llmOptions:{...providerOptions,apiKey,model,fetcher}}) : async ({text,state,history}) => {
    const stateBefore=publicState(state);
    const turn=await extract({text,state:stateBefore,issues:input.issues,history,source:input.source??'typed'},products,{...providerOptions,reasoningEnabled:providerOptions.reasoningEnabled??(model?.startsWith('deepseek-')?false:undefined),apiKey,model,fetcher,retainAllergens:false,additionalInstructions:'Only recipient-attributed facts may update gift conditions. Never apply giver preferences to the recipient. If ownership is unclear, ask a clarification question. When a recipient changes, do not copy prior recipient tastes or restrictions. Do not remove a hard exclusion from an unmentioned condition. A pending shipping question does not prevent accepting other explicit condition updates. Abstract practicality has no preference enum; do not invent one. Return no invented product or explanation.'});
    validateState(turn.session?.state);
    if (!Array.isArray(turn.session.issues)||turn.session.issues.some(q=>typeof q!=='string'||q.length>400)) throw Error('invalid_extraction');
    return {patch:changedPatch(stateBefore,turn.session.state),questions:turn.session.issues,unresolved:turn.session.issues.length>0};
  } : undefined;
  const agent=createAgent({interpret,singleGift:true,ranking:APP_RANKING});
  const request={expectedVersion:0,...(input.operation==='turn'?{kind:'message',text:input.text}:input.operation==='conditions'?{kind:'patch',patch:input.routerPatch??input.patch}:{kind:'view'})};
  const output=await agent.runTurn({session,request,products:catalog,pendingQuestion:input.issues[0]??'',history:input.history??[],signal});
  if (output.routing.route==='llm_error') throw new RouterInterpretationError(output.routing);
  // The prototype does not support multi-gift output or changing its budget scope.
  if (output.session.state.quantity!==1||output.session.state.same_product!==true||output.session.state.budget.scope!=='per_set') {
    const turn=finishSingle(before,before,['현재 앱은 선물 하나 기준입니다. 선물 하나의 예산과 조건을 알려주세요.'],products);
    return {...turn,mode:'rules',agent:'a-router',routing:{...output.routing,route:'clarification'}};
  }
  const state=publicState(output.session.state);
  const missing=await coreTurn({session:output.session,products:catalog,request:{kind:'view',expectedVersion:output.session.version}});
  let issues=output.kind==='question' && (missing.kind!=='question'||missing.question!==output.question)?[output.question]:[];
  if (input.operation==='conditions' && input.clearIssues===false) issues=input.issues;
  // A missing allergy ingredient is blocking until an ingredient or explicit cancellation arrives.
  if (JSON.stringify(state.recipients)===JSON.stringify(before.recipients) && input.issues.some(q=>q.includes('성분')) && !/알레르기\s*(없|해제|취소)/.test(input.text??'') && JSON.stringify(state.excluded_ingredients)===JSON.stringify(before.excluded_ingredients)) issues=input.issues;
  const turn=finishSingle(before,state,issues,products);
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
  return {...turn,message,mode:output.routing.llmCalls?'llm':input.source==='quick_reply'?'rules_fast':'rules',agent:'a-router',routing:output.routing};
}
