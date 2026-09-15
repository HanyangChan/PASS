import {initial,apply,recommend,rankProducts} from './engine.mjs';
import {budgetAlternatives} from './counterfactual.mjs';
export const STUDY_VERSION='pass-explanation-pilot-v1';
export const TASKS=[
 {id:'parents',title:'부모님께 드릴 선물',description:'부모님께 한 세트를 드립니다. 덜 단 상품을 선호하고 견과류는 제외합니다.',patch:{recipients:['부모님'],quantity:1,preferences:['less_sweet'],excluded_categories:['nuts'],budget:{amount_krw:30000,scope:'total',shipping_included:true}}},
 {id:'friends',title:'친구 두 명에게 보낼 선물',description:'친구 두 명에게 같은 상품을 한 세트씩 보냅니다. 덜 단 상품을 선호하고 커피는 제외합니다.',patch:{recipients:['친구'],quantity:2,same_product:true,preferences:['less_sweet'],excluded_categories:['coffee'],budget:{amount_krw:60000,scope:'total',shipping_included:true}}}
];
export function assignment(group){if(!Number.isInteger(group)||group<0||group>3)throw Error('Invalid assignment');const order=group<2?[0,1]:[1,0];return order.map((i,index)=>({taskId:TASKS[i].id,condition:(index+group)%2===0?'A':'B'}));}
export function studyView(trial,products){
 const task=TASKS.find(t=>t.id===trial.taskId);if(!task)throw Error('Unknown task');
 const baseline=apply(initial(),task.patch);const alternative=budgetAlternatives(products,baseline).alternatives[0];if(!alternative)throw Error('Study requires an alternative');
 const state=trial.budget==='higher'?apply(baseline,alternative.patch):baseline;
 const result=rankProducts(products,state);const baselineTop=recommend(products,baseline).items[0]?.id;
 const comparisonTop=recommend(products,apply(baseline,alternative.patch)).items[0]?.id;
 return {task,baseline,state,result,alternative,topChanged:baselineTop!==comparisonTop};
}
export function newStudy(id,group,now){return {version:STUDY_VERSION,id,group,sequence:assignment(group),status:'running',index:0,startedAt:now,events:[{type:'start',elapsedMs:0}],trials:[],current:{...assignment(group)[0],budget:'base',selectedId:null,answers:{},startedAt:now}};}
export function studyEvent(session,event,now,products){
 if(event.type==='stop'&&session.status==='between'){const s=structuredClone(session);s.status='stopped';s.events.push({type:'stop',trial:s.index,elapsedMs:Math.max(0,Math.round(now-s.startedAt))});return s;}
 if(session.status!=='running')return session;
 const s=structuredClone(session),t=s.current;const elapsedMs=Math.max(0,Math.round(now-s.startedAt));
 let data={};
 if(event.type==='budget'){
  if(!['base','higher'].includes(event.value)||t.budget===event.value)return session;
  t.budget=event.value;if(t.selectedId!=='none'&&!studyView(t,products).result.items.some(p=>p.id===t.selectedId))t.selectedId=null;
  data={value:event.value};
 }else if(event.type==='select'){
  if(event.value!=='none'&&!studyView(t,products).result.items.some(p=>p.id===event.value))return session;
  t.selectedId=event.value;t.selectionMs=Math.max(0,Math.round(now-t.startedAt));data={productId:event.value};
 }else if(event.type==='answer'){
  const valid=event.key==='topChanged'?['yes','no','unsure'].includes(event.value):['effort','confidence','pressure'].includes(event.key)&&Number.isInteger(event.value)&&event.value>=1&&event.value<=5;
  if(!valid)return session;t.answers[event.key]=event.value;data={key:event.key,value:event.value};
 }else if(event.type==='submit'){
  if(!canSubmit(t))return session;
  const v=studyView(t,products);
  s.trials.push({...t,durationMs:Math.max(0,Math.round(now-t.startedAt)),budgetAmount:v.state.budget.amount_krw,visibleProductIds:v.result.items.map(p=>p.id),comprehensionCorrect:t.answers.topChanged===(v.topChanged?'yes':'no')});
  s.status=s.index===s.sequence.length-1?'complete':'between';
 }else if(event.type==='stop'){s.status='stopped';}else return session;
 s.events.push({type:event.type,trial:s.index,condition:t.condition,taskId:t.taskId,elapsedMs,...data});return s;
}
export function nextTrial(session,now){if(session.status!=='between')return session;const s=structuredClone(session);s.index++;s.status='running';s.current={...s.sequence[s.index],budget:'base',selectedId:null,answers:{},startedAt:now};s.events.push({type:'trial_start',trial:s.index,elapsedMs:Math.max(0,Math.round(now-s.startedAt))});return s;}
export function canSubmit(t){return !!t.selectedId&&['yes','no','unsure'].includes(t.answers.topChanged)&&['effort','confidence','pressure'].every(k=>Number.isInteger(t.answers[k])&&t.answers[k]>=1&&t.answers[k]<=5);}
export function exportStudy(s){const copy=structuredClone(s);delete copy.startedAt;delete copy.current.startedAt;for(const t of copy.trials)delete t.startedAt;return {...copy,taskDefinitions:structuredClone(TASKS),timingNote:'Elapsed wall time includes hidden-tab time; no raw conversation or personal identifiers collected.'};}
