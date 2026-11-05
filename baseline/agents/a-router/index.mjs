import { runTurn as runCoreTurn } from '../../src/index.mjs';
import { BaselineError, checkedPatch, validateSession, validateCatalog } from '../../src/contracts.mjs';
import { CATEGORIES } from '../../src/vendor/catalog.mjs';
import { ALLERGEN_NAMES } from '../../src/vendor/allergens.mjs';
import { parseConditions, classifyIntent } from './parser.mjs';

export async function interpretMessage({ text, state, pendingQuestion }) {
  return parseConditions(text, state, { pendingQuestion });
}
const preferences=new Set(['unsweetened','less_sweet',...CATEGORIES.map(c=>`category:${c}`)]);
function validateInterpretation(value, state) {
  if (!value || typeof value.unresolved!=='boolean' || !Array.isArray(value.questions) || value.questions.length>12 || value.questions.some(q=>typeof q!=='string'||!q.trim()||q.length>400)) throw new BaselineError('invalid_interpretation');
  const next=checkedPatch(state,value.patch);
  if (next.preferences.some(p=>!preferences.has(p)) || next.excluded_categories.some(c=>!CATEGORIES.includes(c)) || next.excluded_ingredients.some(a=>!ALLERGEN_NAMES.includes(a)) || ![null,'basic','formal'].includes(next.packaging)) throw new BaselineError('invalid_interpretation');
  return value;
}
function deadlineCall(interpret, input, timeoutMs) {
  const controller=new AbortController(); let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('interpreter_timeout'));},timeoutMs);});
  return Promise.race([Promise.resolve().then(()=>interpret({...input,signal:controller.signal})),timeout]).finally(()=>{clearTimeout(timer);controller.abort();});
}
function annotate(out, {intent,route,llmCalls=0}) {
  return {...out, routing:{agent:'a-router',intent,route,llmCalls}};
}

/** Server-controlled routing; only unresolved language may invoke interpret once. */
export function createAgent({ interpret, timeoutMs=18000, singleGift=false } = {}) {
  if (typeof singleGift!=='boolean') throw new TypeError('singleGift must be a boolean');
  const preparePatch=(state,patch)=>{
    // First identification is not a recipient switch: keep conditions supplied earlier.
    if (patch?.recipients?.length && !state.recipients.length) patch={...structuredClone(state),...patch,budget:{...state.budget,...patch.budget}};
    return singleGift && patch?.recipients && JSON.stringify(patch.recipients)!==JSON.stringify(state.recipients)
      ? {...patch,quantity:patch.quantity??1,same_product:patch.same_product??true,budget:{...patch.budget,scope:patch.budget?.scope??'per_set'}} : patch;
  };
  if (interpret!==undefined && typeof interpret!=='function') throw new TypeError('interpret must be a function');
  if (!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>18000) throw new TypeError('timeoutMs must be between 1 and 18000');
  return {
    id:'a-router',
    async runTurn({session,request,products,pendingQuestion='',history=[]}) {
      validateSession(session);validateCatalog(products);
      if (!request || !['message','patch','view','what_if_budget'].includes(request.kind) || !Number.isSafeInteger(request.expectedVersion)) throw new BaselineError('invalid_request');
      if (request.expectedVersion!==session.version) throw new BaselineError('version_conflict');
      if (typeof pendingQuestion!=='string'||pendingQuestion.length>400 || !Array.isArray(history)||history.length>6||history.some(m=>!['user','assistant'].includes(m?.role)||typeof m.text!=='string'||m.text.length>1200)) throw new BaselineError('invalid_request');
      if (['view','what_if_budget'].includes(request.kind) && /성분/.test(pendingQuestion)) return annotate({session:structuredClone(session),kind:'question',question:pendingQuestion,trace:[]},{intent:request.kind,route:'clarification'});
      if (request.kind!=='message') {
        const out=await runCoreTurn({session,request:request.kind==='patch'?{...request,patch:preparePatch(session.state,request.patch)}:request,products});
        if (/성분/.test(pendingQuestion) && !Object.hasOwn(request.patch??{},'excluded_ingredients') && JSON.stringify(out.session.state.recipients)===JSON.stringify(session.state.recipients)) return annotate({session:out.session,kind:'question',question:pendingQuestion,trace:out.trace},{intent:request.kind,route:'clarification'});
        return annotate(out,{intent:request.kind,route:'rules'});
      }
      if (typeof request.text!=='string'||!request.text.trim()||request.text.length>4000) throw new BaselineError('invalid_request');
      const intent=classifyIntent(request.text,session.state);
      const ask=(question,route='clarification',llmCalls=0)=>annotate({session:structuredClone(session),kind:'question',question,trace:[]},{intent:intent.intent??'conditions',route,llmCalls});
      if (intent.kind==='clarify') return ask(intent.question);
      if (intent.kind!=='message') {
        if (/성분/.test(pendingQuestion)) return ask(pendingQuestion);
        const out=await runCoreTurn({session,products,request:{...intent,expectedVersion:request.expectedVersion}});
        if (intent.intent==='explain' && out.result?.cards.length) {
          out.result.message=out.result.cards.map(p=>`${p.rank}위 ${p.explanation} 선호 점수 ${p.score}점입니다.`).join('\n')+'\n선호 점수가 같으면 상품군 안의 리뷰 비중, 리뷰 수, 낮은 상품값, 상품 ID 순서로 정렬합니다.'+(out.result.notice?`\n${out.result.notice}`:'');
        }
        return annotate(out,{intent:intent.intent,route:'rules'});
      }
      const view=await runCoreTurn({session,products,request:{kind:'view',expectedVersion:session.version}});
      let parsed=parseConditions(request.text,session.state,{pendingQuestion:pendingQuestion || (view.kind==='question'?view.question:'')});
      let llmCalls=0,route=parsed.route;
      if (parsed.unresolved && parsed.route==='unresolved' && interpret) {
        llmCalls=1; route='llm';
        try {
          parsed=await deadlineCall(interpret,{text:request.text,state:structuredClone(session.state),pendingQuestion,history:structuredClone(history)},timeoutMs);
        } catch {
          return ask('조건 해석 서비스에 연결하지 못했어요. 조건은 바뀌지 않았어요. 다시 시도하거나 조건 편집을 이용해 주세요.','llm_error',1);
        }
      }
      validateInterpretation(parsed,session.state);
      if (parsed.unresolved) return ask(parsed.questions[0]||'조건을 확인해 주세요.',route==='unresolved'?'clarification':route,llmCalls);
      // Removing a prior allergen requires an explicit rule-recognized cancellation.
      if (route==='llm' && (!parsed.patch.recipients || JSON.stringify(parsed.patch.recipients)===JSON.stringify(session.state.recipients)) && parsed.patch.excluded_ingredients) parsed.patch.excluded_ingredients=[...new Set([...session.state.excluded_ingredients,...parsed.patch.excluded_ingredients])];
      const out=await runCoreTurn({session,products,request:{kind:'patch',expectedVersion:request.expectedVersion,patch:preparePatch(session.state,parsed.patch)}});
      if (/성분/.test(pendingQuestion) && !Object.hasOwn(parsed.patch,'excluded_ingredients') && (!parsed.patch.recipients || JSON.stringify(parsed.patch.recipients)===JSON.stringify(session.state.recipients))) return annotate({session:out.session,kind:'question',question:pendingQuestion,trace:out.trace},{intent:intent.intent,route:'clarification',llmCalls});
      if (parsed.questions.length) return annotate({session:out.session,kind:'question',question:parsed.questions[0],trace:out.trace},{intent:intent.intent,route,llmCalls});
      return annotate(out,{intent:intent.intent,route,llmCalls});
    },
  };
}
