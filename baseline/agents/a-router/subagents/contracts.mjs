import { checkedPatch } from '../../../src/contracts.mjs';
import { initial } from '../../../src/vendor/engine.mjs';
import { CATEGORIES,PREFERENCE_TAGS } from '../../../src/vendor/catalog.mjs';
import { moneyValues } from '../parser.mjs';
import { ALLERGEN_NAMES } from '../../../src/vendor/allergens.mjs';
export const ROLES=Object.freeze(['recipient','occasion','spending','taste']);
export const FIELDS=Object.freeze({recipient:['recipients'],occasion:['occasion','packaging','delivery_by'],spending:['budget.amount_krw','budget.scope','budget.shipping_included','brand','quantity','same_product'],taste:['preferences','excluded_categories','excluded_ingredients']});
export class SubagentError extends Error { constructor(code,diagnostics) {super(code);this.name='SubagentError';this.code=code;this.diagnostics=diagnostics;} }
export const fail=()=>{throw new SubagentError('invalid_analysis');};
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
export function keys(value,expected) {if(!object(value)||Object.keys(value).length!==expected.length||expected.some(key=>!Object.hasOwn(value,key)))fail();}
export function questions(values) {if(!Array.isArray(values)||values.length>1||values.some(q=>typeof q!=='string'||!q.trim()||q.length>200))fail();}
export function makeSources(text,history=[]) {return [{id:'current',text},...history.flatMap((m,i)=>m.role==='user'?[{id:`user-${i}`,text:m.text}]:[])];}
export function evidence(refs,sources,{current=true}={}) {
  if(!Array.isArray(refs)||!refs.length||refs.length>4)fail();
  for(const ref of refs) {keys(ref,['sourceId','quote']);const source=sources.find(s=>s.id===ref.sourceId);if(!source||typeof ref.quote!=='string'||!ref.quote.trim()||ref.quote.length>200||!source.text.includes(ref.quote))fail();}
  if(current&&!refs.some(ref=>ref.sourceId==='current'))fail();
}
export function validateSelection(data,sources) {
  keys(data,['tasks','question']);
  if(!Array.isArray(data.tasks)||data.tasks.length>4||!(data.question===null||typeof data.question==='string'&&data.question.trim()&&data.question.length<=200))fail();
  const seen=new Set();
  for(const task of data.tasks) {
    keys(task,['agentId','task','evidenceRefs']);
    if(!ROLES.includes(task.agentId)||seen.has(task.agentId)||typeof task.task!=='string'||!task.task.trim()||task.task.length>200)fail();
    seen.add(task.agentId);evidence(task.evidenceRefs,sources);
  }
  if(!data.tasks.length&&!data.question || data.tasks.length&&data.question!==null)fail();
  return data;
}
function fieldPatch(field,value) {return field.startsWith('budget.')?{budget:{[field.slice(7)]:value}}:{[field]:value};}
export function validateValue(field,value) {
  checkedPatch(initial(),fieldPatch(field,value));
  if(field==='recipients'&&(!Array.isArray(value)||value.length!==1))fail();
  if(field==='preferences'&&value.some(x=>!PREFERENCE_TAGS.includes(x)))fail();
  if(field==='excluded_categories'&&value.some(x=>!CATEGORIES.includes(x)))fail();
  if(field==='excluded_ingredients'&&value.some(x=>!ALLERGEN_NAMES.includes(x)))fail();
  if(field==='packaging'&&![null,'basic','formal'].includes(value))fail();
}
export function validateAnalysis(data,role,sources) {
  keys(data,['agentId','status','observations','attributions','questions']);
  if(data.agentId!==role||!['complete','needs_clarification','not_applicable'].includes(data.status)||!Array.isArray(data.observations)||data.observations.length>8||!Array.isArray(data.attributions)||data.attributions.length>8)fail();
  questions(data.questions);const seen=new Set();
  for(const o of data.observations) {
    keys(o,['field','value','subject','certainty','evidenceRefs']);
    if(!FIELDS[role].includes(o.field)||seen.has(o.field)||!['recipient','giver','unknown'].includes(o.subject)||!['explicit','tentative'].includes(o.certainty))fail();
    seen.add(o.field);evidence(o.evidenceRefs,sources);validateValue(o.field,o.value);
    if(o.value===null && (!['brand','occasion','packaging','delivery_by'].includes(o.field)||!o.evidenceRefs.some(r=>/취소|상관없|해제|없애|제거/.test(r.quote))))fail();
    const quotes=o.evidenceRefs.filter(r=>r.sourceId==='current').map(r=>r.quote).join(' ');
    if(o.field==='budget.amount_krw'&&!moneyValues(quotes).includes(o.value))fail();
    if(o.field==='recipients'&&!o.value.every(name=>quotes.replaceAll('엄마','어머니').replaceAll('아빠','아버지').includes(name)))fail();
    if(o.field==='brand'&&o.value!==null&&!quotes.includes(o.value))fail();
    if(o.field==='delivery_by'&&o.value!==null) {
      const dates=[...quotes.matchAll(/(\d{4})[-년]\s*(\d{1,2})[-월]\s*(\d{1,2})/g)].map(m=>`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`);
      if(!dates.includes(o.value))fail();
    }
  }
  if(role!=='recipient'&&data.attributions.length)fail();
  for(const a of data.attributions){keys(a,['subject','evidenceRefs']);if(!['recipient','giver','unknown'].includes(a.subject))fail();evidence(a.evidenceRefs,sources);}
  if(data.status==='needs_clarification'&&!data.questions.length)fail();
  if(data.status==='not_applicable'&&(data.observations.length||data.attributions.length||data.questions.length))fail();
  return data;
}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function subjectAllowed(role,o) {return role==='spending'?(o.field==='brand'?o.subject!=='unknown':o.subject==='giver'):role==='occasion'?o.subject!=='unknown':o.subject==='recipient';}
export function prepareSynthesis(results,state,{text=''}={}) {
  const questionOptions=[];const addQuestion=q=>{if(!questionOptions.includes(q))questionOptions.push(q);};
  const observations=[];
  const attributions=results.find(r=>r.agentId==='recipient')?.attributions??[];
  for(const result of results) {
    result.questions.forEach(addQuestion);
    for(const o of result.observations) {
      const disputed=attributions.some(a=>a.subject!==o.subject&&a.evidenceRefs.some(aRef=>o.evidenceRefs.some(oRef=>aRef.sourceId===oRef.sourceId&&(aRef.quote.includes(oRef.quote)||oRef.quote.includes(aRef.quote)))));
      if(o.certainty!=='explicit'||!subjectAllowed(result.agentId,o)||disputed) {addQuestion('누구의 조건인지, 받는 분에게 적용할 내용인지 확인해 주세요.');continue;}
      observations.push(o);
    }
  }
  const recipient=observations.find(o=>o.field==='recipients');
  const changed=recipient&&state.recipients.length>0&&!same(recipient.value,state.recipients);
  const base=changed?initial():state;
  for(const name of ALLERGEN_NAMES) {
    const re=new RegExp(`${name}(?:은|는|이|가|에|를|을)?\\s*(?:알레르기|피하|피해|피해야|빼|제외|못\\s*먹)`);
    if(re.test(text)&&!base.excluded_ingredients.includes(name)&&!observations.some(o=>o.field==='excluded_ingredients'&&o.value.includes(name)))addQuestion(`${name} 제외 조건을 확인해 주세요.`);
  }

  const patch={};
  for(const o of observations) {
    if(o.field.startsWith('budget.'))patch.budget={...patch.budget,[o.field.slice(7)]:o.value};
    else if(['preferences','excluded_categories','excluded_ingredients'].includes(o.field))patch[o.field]=[...new Set([...base[o.field],...o.value])];
    else patch[o.field]=o.value;
  }
  const newPrefs=observations.find(o=>o.field==='preferences')?.value??[];
  if(newPrefs.some(p=>p.startsWith('category:')&&(patch.excluded_categories??base.excluded_categories).includes(p.slice(9))))addQuestion('선호 상품군과 제외 상품군이 겹쳐요. 적용할 조건을 확인해 주세요.');
  if(patch.excluded_categories)patch.preferences=(patch.preferences??base.preferences).filter(p=>(!p.startsWith('category:')||!patch.excluded_categories.includes(p.slice(9)))&&!(patch.excluded_categories.includes('coffee_tea')&&['type:tea','type:coffee'].includes(p)));
  if(!observations.length&&!questionOptions.length)addQuestion('받는 분의 선호나 조건을 조금 더 구체적으로 알려주세요.');
  checkedPatch(base,patch);
  return {approvedPatch:questionOptions.length?{}:patch,questionOptions};
}
export function validateSynthesis(data,prepared) {
  keys(data,['patch','questions','unresolved']);questions(data.questions);
  if(typeof data.unresolved!=='boolean')fail();
  if(data.unresolved) {
    if(!object(data.patch)||Object.keys(data.patch).length||data.questions.length!==1||!prepared.questionOptions.includes(data.questions[0]))fail();
  } else if(prepared.questionOptions.length||data.questions.length||!equalJson(data.patch,prepared.approvedPatch))fail();
  return data;
}
function equalJson(a,b) {
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&a.every((v,i)=>equalJson(v,b[i]));
  if(object(a)||object(b))return object(a)&&object(b)&&Object.keys(a).sort().join()===Object.keys(b).sort().join()&&Object.keys(a).every(k=>equalJson(a[k],b[k]));
  return a===b;
}
export function safeDiagnostics(data) {
  if(!object(data)||data.mode!=='subagents'||typeof data.runId!=='string'||data.runId.length>100||!Number.isInteger(data.logicalCalls)||data.logicalCalls<0||data.logicalCalls>6||!Number.isInteger(data.httpAttempts)||data.httpAttempts<0||data.httpAttempts>12||!Array.isArray(data.selectedAgents)||data.selectedAgents.some(id=>!ROLES.includes(id))||!Array.isArray(data.stages)||data.stages.length>6)fail();
  return {mode:'subagents',runId:data.runId,stateVersion:Number.isSafeInteger(data.stateVersion)?data.stateVersion:null,selectedAgents:[...data.selectedAgents],logicalCalls:data.logicalCalls,httpAttempts:data.httpAttempts,stages:data.stages.map(s=>({agentId:['supervisor','synthesizer',...ROLES].includes(s.agentId)?s.agentId:'unknown',status:['passed','failed','running'].includes(s.status)?s.status:'failed',...(s.errorCode?{errorCode:['invalid_analysis','invalid_response','stage_timeout','deadline_exceeded','aborted','auth_failed','quota_exceeded','endpoint_or_model_not_found','provider_unavailable','request_rejected','network_error','timeout','call_limit','analysis_failed'].includes(s.errorCode)?s.errorCode:'analysis_failed'}:{}),latencyMs:Number.isFinite(s.latencyMs)?Math.max(0,Math.round(s.latencyMs)):0,usage:Object.fromEntries(Object.entries(s.usage??{}).filter(([k,v])=>['prompt_tokens','completion_tokens','total_tokens'].includes(k)&&Number.isSafeInteger(v)&&v>=0))}))};
}
