import { runTurn as coreTurn } from '../../src/index.mjs';
import { BaselineError, checkedPatch, validateSession, validateCatalog } from '../../src/contracts.mjs';
import { CATEGORIES, PREFERENCE_TAGS } from '../../src/vendor/catalog.mjs';
import { ALLERGEN_NAMES } from '../../src/vendor/allergens.mjs';
import { createLlmFromEnv } from '../../llm/index.mjs';
import { SYSTEM } from './prompts.mjs';
import { capabilityIssue } from './capabilities.mjs';

const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const keys = (v, allowed) => plain(v) && Object.keys(v).every(k => allowed.includes(k));
const text = v => typeof v === 'string' && v.trim().length > 0 && v.length <= 400;
const terminalTypes = ['result','greeting','thanks','help','acknowledge'];
function promptState(state) {
  const {quantity,same_product,budget,...rest}=state;
  const {scope,...publicBudget}=budget;
  return {...structuredClone(rest),budget:structuredClone(publicBudget)};
}
function requiredQuestion(state) {
  if(!state.recipients.length)return '받는 사람을 알려주세요.';
  if(state.budget.amount_krw===null)return '예산 상한을 알려주세요.';
  if(!state.quantity)return '선물 수량을 알려주세요.';
  if(!state.budget.scope)return '총예산인지 세트당 예산인지 알려주세요.';
  if(state.budget.shipping_included===null)return '예산에 배송비를 포함할까요?';
  if(state.quantity>1&&state.same_product!==true)return '여러 명에게 같은 상품을 보낼지 확인해 주세요.';
  return null;
}
export function validAction(v) {
  if (!plain(v)) return false;
  switch (v.action) {
    case 'update_conditions': return keys(v,['action','patch']) && plain(v.patch) && Object.keys(v.patch).length > 0;
    case 'search_products': case 'explain_recommendation': return keys(v,['action']);
    case 'compare_budget': return keys(v,['action','amount_krw']) && Number.isSafeInteger(v.amount_krw) && v.amount_krw > 0 && v.amount_krw <= 1e9;
    case 'clarify': return keys(v,['action','question']) && text(v.question);
    case 'respond': return keys(v,['action','type','limitations']) && terminalTypes.includes(v.type) && (v.limitations===undefined || v.type==='result' && Array.isArray(v.limitations) && v.limitations.length===1 && v.limitations[0]==='scent_strength');
    default: return false;
  }
}
export class FullChatError extends Error {
  constructor(code,routing) { super(code); this.code=code; this.routing=routing; }
}
function preparePatch(state, patch, userText) {
  if (!keys(patch,['occasion','recipients','budget','preferences','excluded_categories','excluded_ingredients','brand','delivery_by','packaging']) || (patch.budget !== undefined && !keys(patch.budget,['amount_krw','shipping_included']))) throw new BaselineError('invalid_input');
  const candidate=checkedPatch(state,patch);
  if (candidate.preferences.some(v=>!PREFERENCE_TAGS.includes(v)) || candidate.excluded_categories.some(v=>!CATEGORIES.includes(v)) || candidate.excluded_ingredients.some(v=>!ALLERGEN_NAMES.includes(v)) || ![null,'basic','formal'].includes(candidate.packaging)) throw new BaselineError('invalid_input');
  const changedRecipient=patch.recipients?.length && !same(patch.recipients,state.recipients);
  if (userText !== null && !changedRecipient && state.excluded_ingredients.some(v=>!candidate.excluded_ingredients.includes(v))) {
    // Hard exclusions can only be removed through an explicit cancellation in this turn.
    const all=/알레르기\s*(?:없음|없어|없어요|해제|취소)/.test(userText);
    for (const ingredient of state.excluded_ingredients.filter(v=>!candidate.excluded_ingredients.includes(v))) {
      const named=new RegExp(`${ingredient}(?:는|은|를|을)?\\s*(?:포함해도|먹어도|제외\\s*(?:해제|취소))`).test(userText);
      if (!all && !named) throw new BaselineError('invalid_input');
    }
  }
  if (changedRecipient) {
    // Match the one-gift host contract, preserving earlier conditions on first identification only.
    return {...(!state.recipients.length?structuredClone(state):{}),...patch,quantity:1,same_product:true,budget:{...(!state.recipients.length?state.budget:{}),...patch.budget,scope:'per_set'}};
  }
  return patch;
}

/** B: a single model-driven action/observation loop; no rule intent router or critic. */
export function createAgent({env={},decide,fetcher=fetch,maxLlmCalls=6,maxToolCalls=5,timeoutMs=20000,ranking}={}) {
  for (const [value,max] of [[maxLlmCalls,10],[maxToolCalls,5],[timeoutMs,30000]]) if (!Number.isSafeInteger(value)||value<1||value>max) throw new TypeError('Invalid full-chat limit');
  if (decide!==undefined && typeof decide!=='function') throw new TypeError('Invalid decision function');
  return {id:'full-chat',async runTurn({session,request,products,history=[],pendingQuestion='',signal}) {
    validateSession(session);validateCatalog(products);
    if (!request || !['message','patch','view'].includes(request.kind) || request.expectedVersion!==session.version) throw new BaselineError(request?.expectedVersion!==session.version?'version_conflict':'invalid_request');
    if (!Array.isArray(history)||history.length>6||history.some(m=>!['user','assistant'].includes(m?.role)||typeof m.text!=='string'||m.text.length>1200)||typeof pendingQuestion!=='string'||pendingQuestion.length>400) throw new BaselineError('invalid_request');
    if (signal!==undefined && !(signal instanceof AbortSignal)) throw new BaselineError('invalid_request');
    if (signal?.aborted) throw new BaselineError('aborted');
    const routing={agent:'full-chat',route:'agent',llmCalls:0,toolCalls:0,httpAttempts:0,usage:{prompt_tokens:0,completion_tokens:0,total_tokens:0},steps:[]};
    if (request.kind!=='message') {
      const patch=request.kind==='patch'?preparePatch(session.state,request.patch,null):undefined;
      const out=await coreTurn({session,products,ranking,request:{...request,...(patch?{patch}:{})}});
      if (/성분/.test(pendingQuestion) && !Object.hasOwn(patch??{},'excluded_ingredients') && same(out.session.state.recipients,session.state.recipients)) return {...out,kind:'question',question:pendingQuestion,routing:{...routing,route:'host'}};
      return {...out,routing:{...routing,route:'host'}};
    }
    if (typeof request.text!=='string'||!request.text.trim()||request.text.length>4000) throw new BaselineError('invalid_request');
    let choose=decide;
    if (!choose) {
      try {
        if(env.LLM_RESPONSE_FORMAT && !['json_object','text'].includes(env.LLM_RESPONSE_FORMAT)) throw Error();
        const llm=createLlmFromEnv(env,{fetcher:(...args)=>{routing.httpAttempts++;return fetcher(...args);}});
        if (!llm.configured) throw Error();
        choose=async (input,{signal}) => {
          const result=await llm.completeJson({messages:[{role:'system',content:SYSTEM},{role:'user',content:JSON.stringify(input)}],responseFormat:env.LLM_RESPONSE_FORMAT||'json_object',validate:validAction,maxTokens:900,signal,...(env.LLM_REASONING_ENABLED==='true'?{reasoningEnabled:true}:env.LLM_REASONING_ENABLED==='false'||llm.model.startsWith('deepseek-')?{reasoningEnabled:false}:{})});
          for(const key of Object.keys(routing.usage))routing.usage[key]+=result.usage[key]??0;
          return result.data;
        };
      } catch { throw new FullChatError('configuration',routing); }
    }
    const controller=new AbortController();
    let timer,abort;
    const stopped=new Promise((_,reject)=>{
      abort=()=>{controller.abort();reject(new FullChatError('aborted',routing));};
      signal?.addEventListener('abort',abort,{once:true});
      if(signal?.aborted)abort();
      timer=setTimeout(()=>{controller.abort();reject(new FullChatError('timeout',routing));},timeoutMs);
    });
    const execute=async()=>{
      let staged=structuredClone(session), last=null, capabilityFeedback=null;
      let ingredientBlocked=/성분/.test(pendingQuestion);
      const observations=[],seen=new Set();
      // A limit or invalid sequence never commits partially staged changes.
      const stop=reason=>({session:structuredClone(session),kind:'question',question:'요청을 끝까지 확인하지 못했어요. 조건은 유지했어요. 요청을 나누어 다시 알려주세요.',trace:[],routing:{...routing,route:'limit',stopReason:reason}});
      while (routing.llmCalls < maxLlmCalls) {
        if(controller.signal.aborted) throw new FullChatError('aborted',routing);
        routing.llmCalls++;
        const context={text:request.text,history:structuredClone(history),state:promptState(staged.state),currentQuestion:ingredientBlocked?pendingQuestion:observations.length?requiredQuestion(staged.state):pendingQuestion||requiredQuestion(staged.state),observations:structuredClone(observations),...(capabilityFeedback?{capabilityFeedback}:{}),remaining:{llmCalls:maxLlmCalls-routing.llmCalls,toolCalls:maxToolCalls-routing.toolCalls}};
        const decision=await choose(context,{signal:controller.signal});
        if(controller.signal.aborted) throw new FullChatError('aborted',routing);
        if(!validAction(decision)) throw new FullChatError('invalid_response',routing);
        routing.steps.push({action:decision.action,...(decision.type?{type:decision.type}:{})});
        capabilityFeedback=capabilityIssue(context,decision);
        if(capabilityFeedback) continue;
        if(decision.action==='clarify') return {session:structuredClone(session),kind:'question',question:decision.question,trace:[],routing:{...routing,stopReason:'clarification'}};
        if(decision.action==='respond') {
          if(decision.type==='result') {
            if(ingredientBlocked) return {session:structuredClone(session),kind:'question',question:pendingQuestion,trace:[],routing};
            if(!last) return stop('missing_result');
            return {...last,session:staged,limitations:decision.limitations??[],routing:{...routing,intent:last.kind==='comparison'?'compare_budget':last.intent??'recommend',stopReason:'complete'}};
          }
          if(observations.length) return stop('unfinished_tools');
          return {session:structuredClone(session),kind:'conversation',responseType:decision.type,trace:[],routing:{...routing,intent:'conversation',stopReason:'complete'}};
        }
        if(routing.toolCalls>=maxToolCalls) return stop('tool_limit');
        const signature=JSON.stringify({state:staged.state,decision});
        if(seen.has(signature)) return stop('no_progress');
        seen.add(signature);routing.toolCalls++;
        const action=decision.action;
        if(action==='update_conditions') {
          const patch=preparePatch(staged.state,decision.patch,request.text);
          const out=await coreTurn({session:staged,products,ranking,request:{kind:'patch',expectedVersion:staged.version,patch}});
          if(!same(out.session.state.recipients,staged.state.recipients) || patch.excluded_ingredients?.length || /알레르기\s*(?:없음|없어|없어요|해제|취소)/.test(request.text)) ingredientBlocked=false;
          staged=out.session;last=out;
        } else {
          if(ingredientBlocked) return {session:structuredClone(session),kind:'question',question:pendingQuestion,trace:[],routing};
          last=await coreTurn({session:staged,products,ranking,request:{kind:action==='compare_budget'?'what_if_budget':'view',expectedVersion:staged.version,...(action==='compare_budget'?{amount_krw:decision.amount_krw}:{})}});
          if(action==='explain_recommendation') last={...last,intent:'explain'};
        }
        if(ingredientBlocked) return {session:structuredClone(session),kind:'question',question:pendingQuestion,trace:[],routing:{...routing,stopReason:'missing_ingredient'}};
        // A missing required field ends this execution immediately, without guessing the answer.
        if(last.kind==='question') return {...last,session:staged,routing:{...routing,stopReason:'missing_condition'}};
        observations.push({action,stateVersion:staged.version,kind:last.kind,...(last.result?{result:last.result}:{}),...(last.evaluatedState?{evaluatedState:promptState(last.evaluatedState)}:{})});
      }
      return stop('llm_limit');
    };
    try { return await Promise.race([execute(),stopped]); }
    catch(error) { if(error instanceof FullChatError) throw error; throw new FullChatError('agent_unavailable',{...routing,failureCode:['invalid_input','invalid_response','timeout','network_error','aborted','auth_failed','quota_exceeded'].includes(error?.code)?error.code:'unavailable'}); }
    finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();}
  }};
}
