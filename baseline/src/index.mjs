import { initial, recommend, budgetCost } from './vendor/engine.mjs';
import { BaselineError, checkedPatch, validateCatalog, validateSession } from './contracts.mjs';
import { parseRules } from './parser.mjs';
export { createSession, BaselineError } from './contracts.mjs';
export { budgetAlternatives } from './vendor/counterfactual.mjs';

function missing(s) {
  if (!s.recipients.length) return '받는 사람을 알려주세요.';
  if (s.budget.amount_krw === null) return '예산 상한을 알려주세요.';
  if (!s.quantity) return '선물 수량을 알려주세요.';
  if (!s.budget.scope) return '총예산인지 세트당 예산인지 알려주세요.';
  if (s.budget.shipping_included === null) return '예산에 배송비를 포함할까요?';
  if (s.quantity > 1 && s.same_product !== true) return '여러 명에게 같은 상품을 보낼지 확인해 주세요.';
  return null;
}
function resultFor(products, state) {
  const result = recommend(products, state);
  // Independent final hard-constraint gate over returned engine facts.
  for (const p of result.items) {
    if (budgetCost(p,state) > state.budget.amount_krw || state.excluded_categories.includes(p.category) || p.allergens_declared.some(a=>state.excluded_ingredients.includes(a)) || p.stock_sets < state.quantity || (state.brand && p.brand !== state.brand) || (state.packaging && p.packaging !== state.packaging) || (state.delivery_by && p.arrival_date > state.delivery_by))
      throw new BaselineError('invalid_engine_result');
  }
  const cards = result.items.map((p,i)=>({id:p.id,rank:i+1,name:p.name,price_krw:p.price_krw,budget_cost_krw:budgetCost(p,state),total_krw:p.total,score:p.score,
    explanation:`${p.name}: 적용 비용 ${budgetCost(p,state).toLocaleString('ko-KR')}원, 예산 상한 ${state.budget.amount_krw.toLocaleString('ko-KR')}원 이하입니다.`,evidence:[p.id]}));
  return {status:result.status,cards,message:result.message,notice:result.notice ?? null};
}
/** Pure turn: caller owns authentication, durable storage and atomic version comparison.
 * interpret({text,state}) -> Promise<{patch,questions,unresolved}> is the branch extension port.
 */
export async function runTurn({session,request,products,interpret}) {
  validateSession(session);
  if (!request || !['message','patch','view','what_if_budget'].includes(request.kind) || !Number.isSafeInteger(request.expectedVersion)) throw new BaselineError('invalid_request');
  if (request.expectedVersion !== session.version) throw new BaselineError('version_conflict');
  validateCatalog(products);
  const next=structuredClone(session), trace=[];
  let patch={}, questions=[];
  if (request.kind === 'message') {
    if (typeof request.text !== 'string' || !request.text.trim() || request.text.length > 4000) throw new BaselineError('invalid_request');
    let parsed=parseRules(request.text);
    trace.push({stage:'interpret',provider:'rules'});
    if (parsed.unresolved && interpret) {
      parsed=await interpret({text:request.text,state:structuredClone(session.state)});
      trace.push({stage:'interpret',provider:'extension'});
    }
    if (!parsed || typeof parsed.unresolved !== 'boolean' || !Array.isArray(parsed.questions) || parsed.questions.some(q=>typeof q !== 'string' || !q.trim() || q.length > 400)) throw new BaselineError('invalid_interpretation');
    checkedPatch(session.state,parsed.patch); // Validate even unresolved extension output.
    if (parsed.unresolved) return {session:next,kind:'question',question:parsed.questions[0] || '조건을 확인해 주세요.',trace};
    patch=parsed.patch; questions=parsed.questions;
  }
  if (request.kind === 'patch') patch=request.patch;
  if (request.kind === 'message' || request.kind === 'patch') {
    // Recipient identity is supplied by the host; label-only matching is not a memory key.
    const candidate=checkedPatch(next.state,patch);
    const changed=JSON.stringify(candidate.recipients)!==JSON.stringify(next.state.recipients);
    next.state=changed ? checkedPatch(initial(),patch) : candidate;
    if (JSON.stringify(next.state)!==JSON.stringify(session.state)) next.version++;
  }
  let state=next.state;
  if (request.kind === 'what_if_budget') {
    if (!Number.isSafeInteger(request.amount_krw) || request.amount_krw <= 0) throw new BaselineError('invalid_request');
    state=checkedPatch(state,{budget:{amount_krw:request.amount_krw}});
  }
  const question=questions[0] || missing(state);
  if (question) return {session:next,kind:'question',question,trace};
  const result=resultFor(products,state);
  trace.push({stage:'engine',status:result.status},{stage:'verify',status:'passed'});
  return {session:next,kind:request.kind==='what_if_budget'?'comparison':'recommendation',evaluatedState:structuredClone(state),result,trace};
}
