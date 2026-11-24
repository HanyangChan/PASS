import { runTurn as coreTurn } from '../../src/index.mjs';
import { BaselineError, checkedPatch, validateSession, validateCatalog } from '../../src/contracts.mjs';
import { CATEGORIES, PREFERENCE_TAGS } from '../../src/vendor/catalog.mjs';
import { ALLERGEN_NAMES, mentionedAllergens } from '../../src/vendor/allergens.mjs';
import { FRAGRANCE_TAG } from '../../src/vendor/fragrance.mjs';
import { createLlmFromEnv } from '../../llm/index.mjs';
import { B_SYSTEM } from './prompts.mjs';
import { capabilityIssue } from './capabilities.mjs';
import { explicitShoppingConditions, applyExplicitConditions } from './explicit-conditions.mjs';

const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const keys = (v, allowed) => plain(v) && Object.keys(v).every(k => allowed.includes(k));
const text = v => typeof v === 'string' && v.trim().length > 0 && v.length <= 400;
const terminalTypes = ['result','greeting','thanks','help','acknowledge'];
const endRequests = [
  /^(?:추천(?:은|을)\s*)?(?:그만(?:(?:\s*추천)?해\s*(?:줘|주세요)|할게요?|할래요?)?|멈춰(?:\s*(?:줘|주세요))?)$/,
  /^(?:추천은\s*)?여기까지(?:만)?(?:\s*(?:할게요?|해\s*(?:줘|주세요)))?$/,
  /^(?:(?:대화\s*)?종료(?:해\s*(?:줘|주세요))?|이제\s*(?:됐어(?:요)?|충분해(?:요)?|그만|끝낼게요?)|stop|end (?:the )?chat)$/i,
];
export function isEndRequest(text) {
  const command=text.trim().replace(/^(?:고마워(?:요)?|감사합니다)[,.!\s]+/,'').replace(/[.!?。！\s]+$/,'');
  return endRequests.some(pattern=>pattern.test(command));
}
const extraActionRequest = /비교|차이가|이유|설명|왜\s*(?:이|그|추천|골랐)|\b(?:compare|explain|why)\b/i;
const scentRequest = /향(?:이)?\s*강|강한\s*향|scent strength/i;
const affirmative = /^(?:어|응|네|예|그래)[.!?\s]*$/;
const allergyQuestion = '피해야 할 알레르기 성분을 알려주세요.';
const allergyMention = /알레르기|알러지/;
const allergyCancellation = /(?:알레르기|알러지)\s*(?:없어요|없어|없음|없습니다|해제|취소)\s*[.!?]?$/;
const ingredientUncertainty = /(?:어떤|무슨|어느|특정)\s*(?:성분|재료)(?:인지는|인지|은|는)?\s*(?:아직\s*)?(?:몰라|모르|듣지 못)|(?:성분|재료)(?:은|는|도)?\s*(?:아직\s*)?(?:미확인|확인하지 못|안 알려)/;
const multipleGiftTotal = /(?:두|세|네|다섯|[2-9]|[1-9]\d+)\s*(?:개|세트)\s*(?:를\s*)?(?:합쳐|모두 합해|합산)/;
export const isIngredientQuestion = question => /성분|알레르기|알러지/.test(question);
function namedIngredients(text) {
  const names=mentionedAllergens(text);
  if (/달걀|계란/.test(text)) names.push('알류');
  if (/유제품/.test(text)) names.push('우유');
  if (/견과/.test(text)) names.push('견과류');
  return names;
}
function unknownAllergy(text) {
  if (!allergyMention.test(text) || allergyCancellation.test(text)) return false;
  return ingredientUncertainty.test(text) || !namedIngredients(text).length;
}
function promptState(state) {
  const {quantity,same_product,budget,...rest}=state;
  const {scope,...publicBudget}=budget;
  return {...structuredClone(rest),budget:structuredClone(publicBudget)};
}
export function requiredQuestion(state) {
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
export function createAgent({env={},decide,fetcher=fetch,maxLlmCalls=6,maxToolCalls=5,timeoutMs=20000,ranking,recommendProducts,recordModelTime}={}) {
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
      const out=await coreTurn({session,products,ranking,recommendProducts,request:{...request,...(patch?{patch}:{})}});
      if (isIngredientQuestion(pendingQuestion) && !Object.hasOwn(patch??{},'excluded_ingredients') && same(out.session.state.recipients,session.state.recipients)) return {...out,kind:'question',question:pendingQuestion,routing:{...routing,route:'host'}};
      return {...out,routing:{...routing,route:'host'}};
    }
    if (typeof request.text!=='string'||!request.text.trim()||request.text.length>4000) throw new BaselineError('invalid_request');
    if (isEndRequest(request.text)) return {session,kind:'closed',routing:{...routing,route:'host',stopReason:'user_stop'}};
    if (unknownAllergy(request.text)) return {session,kind:'question',question:allergyQuestion,trace:[],routing:{...routing,route:'host',stopReason:'missing_ingredient'}};
    if (multipleGiftTotal.test(request.text)) return {session,kind:'question',question:'현재는 선물 하나 기준으로 추천해요. 한 개에 쓸 예산을 알려주세요.',trace:[],routing:{...routing,route:'host',stopReason:'unsupported_quantity'}};
    let choose=decide;
    if (!choose) {
      try {
        if(env.LLM_RESPONSE_FORMAT && !['json_object','text'].includes(env.LLM_RESPONSE_FORMAT)) throw Error();
        const llm=createLlmFromEnv(env,{fetcher:(...args)=>{routing.httpAttempts++;return fetcher(...args);}});
        if (!llm.configured) throw Error();
        choose=async (input,{signal}) => {
          const result=await llm.completeJson({messages:[{role:'system',content:B_SYSTEM},{role:'user',content:JSON.stringify(input)}],responseFormat:env.LLM_RESPONSE_FORMAT||'json_object',validate:validAction,maxTokens:900,signal,...(env.LLM_REASONING_ENABLED==='true'?{reasoningEnabled:true}:env.LLM_REASONING_ENABLED==='false'||llm.model.startsWith('deepseek-')?{reasoningEnabled:false}:{})});
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
      let ingredientBlocked=isIngredientQuestion(pendingQuestion);
      const explicit=explicitShoppingConditions(request.text,session.state);
      let repaired=false;
      const observations=[],seen=new Set();
      const complete=(limitations=[])=>({...last,session:staged,limitations,routing:{...routing,intent:last.kind==='comparison'?'compare_budget':last.intent??'recommend',stopReason:'complete'}});
      const repair=(code,feedback)=>{
        if(repaired || routing.llmCalls>=maxLlmCalls)throw new FullChatError(code,{...routing,failureCode:code});
        repaired=true;
        capabilityFeedback=feedback;
      };
      // A limit or invalid sequence never commits partially staged changes.
      const stop=reason=>({session:structuredClone(session),kind:'question',question:'요청을 끝까지 확인하지 못했어요. 조건은 유지했어요. 요청을 나누어 다시 알려주세요.',trace:[],routing:{...routing,route:'limit',stopReason:reason}});
      while (routing.llmCalls < maxLlmCalls) {
        if(controller.signal.aborted) throw new FullChatError('aborted',routing);
        routing.llmCalls++;
        const context={text:request.text,history:structuredClone(history),state:promptState(staged.state),currentQuestion:ingredientBlocked?pendingQuestion:observations.length?requiredQuestion(staged.state):pendingQuestion||requiredQuestion(staged.state),observations:structuredClone(observations),...(capabilityFeedback?{capabilityFeedback}:{}),remaining:{llmCalls:maxLlmCalls-routing.llmCalls,toolCalls:maxToolCalls-routing.toolCalls}};
        const normalizeAction=action=>!ingredientBlocked&&!observations.length?applyExplicitConditions(action,explicit,staged.state):action;
        let decision;
        const modelStarted=performance.now();
        try {
          decision=await choose(context,{signal:controller.signal,normalizeAction});
          if(!validAction(decision))throw new FullChatError('invalid_response',routing);
        } catch(error) {
          if(error?.code!=='invalid_response' || controller.signal.aborted)throw error;
          repair('invalid_response','The previous decision was not valid JSON for a listed action. Return one valid action only.');
          continue;
        } finally {
          recordModelTime?.(performance.now()-modelStarted);
        }
        if(controller.signal.aborted) throw new FullChatError('aborted',routing);
        decision=normalizeAction(decision);
        routing.steps.push({action:decision.action,...(decision.type?{type:decision.type}:{})});
        capabilityFeedback=capabilityIssue(context,decision);
        if(capabilityFeedback) continue;
        if(decision.action==='clarify') {
          const question=ingredientBlocked&&!isIngredientQuestion(decision.question)?pendingQuestion:decision.question;
          return {session:structuredClone(session),kind:'question',question,trace:[],routing:{...routing,stopReason:'clarification'}};
        }
        if(decision.action==='respond') {
          if(decision.type==='result') {
            if(ingredientBlocked) return {session:structuredClone(session),kind:'question',question:pendingQuestion,trace:[],routing};
            if(!last) return stop('missing_result');
            return complete(decision.limitations);
          }
          if(observations.length) return stop('unfinished_tools');
          return {session:structuredClone(session),kind:'conversation',responseType:decision.type,trace:[],routing:{...routing,intent:'conversation',stopReason:'complete'}};
        }
        if(routing.toolCalls>=maxToolCalls) return stop('tool_limit');
        const signature=JSON.stringify({state:staged.state,decision});
        if(seen.has(signature)) return stop('no_progress');
        const action=decision.action;
        let patch;
        if(action==='update_conditions') {
          try {
            patch=preparePatch(staged.state,decision.patch,request.text);
          } catch(error) {
            if(!(error instanceof BaselineError) || error.code!=='invalid_input')throw error;
            repair('invalid_input','The proposed condition update was rejected by the server. Use only allowed single-gift fields and values, preserve explicit exclusions, or ask a concrete question.');
            continue;
          }
        }
        seen.add(signature);routing.toolCalls++;
        if(action==='update_conditions') {
          const out=await coreTurn({session:staged,products,ranking,recommendProducts,request:{kind:'patch',expectedVersion:staged.version,patch}});
          const named=ingredientBlocked?namedIngredients(request.text):[];
          const ingredientsResolved=patch.excluded_ingredients && named.length>0 &&
            named.every(ingredient=>out.session.state.excluded_ingredients.includes(ingredient));
          if(!same(out.session.state.recipients,staged.state.recipients) || ingredientsResolved ||
            (Object.hasOwn(patch,'excluded_ingredients') && allergyCancellation.test(request.text))) ingredientBlocked=false;
          staged=out.session;last=out;
        } else {
          if(ingredientBlocked) return {session:structuredClone(session),kind:'question',question:pendingQuestion,trace:[],routing};
          last=await coreTurn({session:staged,products,ranking,recommendProducts,request:{kind:action==='compare_budget'?'what_if_budget':'view',expectedVersion:staged.version,...(action==='compare_budget'?{amount_krw:decision.amount_krw}:{})}});
          if(action==='explain_recommendation') last={...last,intent:'explain'};
        }
        if(ingredientBlocked) return {session:structuredClone(session),kind:'question',question:pendingQuestion,trace:[],routing:{...routing,stopReason:'missing_ingredient'}};
        // A missing required field ends this execution immediately, without guessing the answer.
        if(last.kind==='question') return {...last,session:staged,routing:{...routing,stopReason:'missing_condition'}};
        const pendingScent=scentRequest.test(request.text) || (affirmative.test(request.text.trim()) && scentRequest.test(pendingQuestion));
        if(action==='compare_budget' || action==='explain_recommendation' ||
          (!extraActionRequest.test(request.text) && (!pendingScent || staged.state.preferences.includes(FRAGRANCE_TAG)))) return complete();
        observations.push({action,stateVersion:staged.version,kind:last.kind,...(last.result?{result:last.result}:{}),...(last.evaluatedState?{evaluatedState:promptState(last.evaluatedState)}:{})});
      }
      return stop('llm_limit');
    };
    try { return await Promise.race([execute(),stopped]); }
    catch(error) { if(error instanceof FullChatError) throw error; throw new FullChatError('agent_unavailable',{...routing,failureCode:['invalid_input','invalid_response','timeout','network_error','aborted','auth_failed','quota_exceeded','endpoint_or_model_not_found','provider_unavailable','request_rejected'].includes(error?.code)?error.code:'unavailable'}); }
    finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);controller.abort();}
  }};
}
