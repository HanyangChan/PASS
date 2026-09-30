import {initial,apply,recommend,rankProducts} from './engine.mjs';
import {budgetAlternatives} from './counterfactual.mjs';
import {PRE_QUESTIONS,POST_QUESTIONS,POST_TEXT_QUESTIONS,FINAL_QUESTION,RESEARCH_OBJECTIVE,validChoice,completeChoices} from './study-surveys.mjs';
export const STUDY_VERSION='pass-explanation-pilot-v3-pre-post';
export const TASKS=[
 {id:'parents',title:'부모님께 드릴 선물',description:'부모님께 드릴 선물을 고릅니다. 덜 단 상품을 선호하고 견과류는 제외합니다.',patch:{recipients:['부모님'],quantity:1,preferences:['less_sweet'],excluded_categories:['nuts'],budget:{amount_krw:30000,scope:'total',shipping_included:true}}},
 {id:'friends',title:'친구에게 보낼 선물',description:'친구에게 보낼 선물을 고릅니다. 덜 단 상품을 선호하고 커피는 제외합니다.',patch:{recipients:['친구'],quantity:1,same_product:true,preferences:['less_sweet'],excluded_categories:['coffee'],budget:{amount_krw:60000,scope:'total',shipping_included:true}}}
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
const trial=(definition,now)=>({...definition,budget:'base',visitedBudgets:['base'],selectedId:null,answers:{},startedAt:now});
export function newStudy(id,group,now){return {version:STUDY_VERSION,id,group,sequence:assignment(group),status:'pre',index:0,startedAt:now,preSurvey:{answers:{}},finalSurvey:{answers:{}},events:[{type:'start',elapsedMs:0}],trials:[],current:null};}
export const canStart=s=>completeChoices(PRE_QUESTIONS,s.preSurvey.answers);
export const canFinishTask=t=>!!t?.selectedId&&['base','higher'].every(b=>t.visitedBudgets.includes(b));
export const canSubmit=t=>!!t?.selectedId&&completeChoices(POST_QUESTIONS,t.answers);
export const canComplete=s=>completeChoices([FINAL_QUESTION],s.finalSurvey.answers);
export function studyEvent(session,event,now,products){
 if(['complete','stopped'].includes(session.status))return session;
 const s=structuredClone(session),t=s.current,elapsedMs=Math.max(0,Math.round(now-s.startedAt));let data={};
 if(event.type==='stop'){s.status='stopped';}
 else if(s.status==='pre'){
  if(event.type==='pre_answer'&&validChoice(PRE_QUESTIONS,event.key,event.value)){s.preSurvey.answers[event.key]=event.value;data={key:event.key,value:event.value};}
  else if(event.type==='pre_submit'&&canStart(s)){s.preSurvey.durationMs=elapsedMs;s.status='running';s.current=trial(s.sequence[0],now);}
  else return session;
 }else if(s.status==='running'){
  if(event.type==='budget'&&['base','higher'].includes(event.value)&&t.budget!==event.value){t.budget=event.value;t.visitedBudgets=[...new Set([...t.visitedBudgets,event.value])];if(t.selectedId!=='none'&&!studyView(t,products).result.items.some(p=>p.id===t.selectedId))t.selectedId=null;data={value:event.value};}
  else if(event.type==='select'&&(event.value==='none'||studyView(t,products).result.items.some(p=>p.id===event.value))){t.selectedId=event.value;t.selectionMs=Math.max(0,Math.round(now-t.startedAt));data={productId:event.value};}
  else if(event.type==='task_finish'&&canFinishTask(t)){t.taskDurationMs=Math.max(0,Math.round(now-t.startedAt));t.surveyStartedAt=now;s.status='post';}
  else return session;
 }else if(s.status==='post'){
  if(event.type==='answer'){
   if(validChoice(POST_QUESTIONS,event.key,event.value)){t.answers[event.key]=event.value;data={key:event.key,value:event.value};}
   else if(POST_TEXT_QUESTIONS.some(q=>q.key===event.key)&&typeof event.value==='string'&&event.value.length<=1000){t.answers[event.key]=event.value;return s;}
   else return session;
  }else if(event.type==='submit'&&canSubmit(t)){
   const v=studyView(t,products),base=studyView({...t,budget:'base'},products),higher=studyView({...t,budget:'higher'},products);
   const count=higher.result.items.length>base.result.items.length?'more':higher.result.items.length<base.result.items.length?'fewer':'same';
   s.trials.push({...t,durationMs:Math.max(0,Math.round(now-t.startedAt)),surveyDurationMs:Math.max(0,Math.round(now-t.surveyStartedAt)),budgetAmount:v.state.budget.amount_krw,visibleProductIds:v.result.items.map(p=>p.id),comprehensionCorrect:t.answers.topChanged===(v.topChanged?'yes':'no'),candidateCountCorrect:t.answers.candidateCount===count});
   s.status=s.index===s.sequence.length-1?'final':'between';if(s.status==='final')s.finalSurvey.startedAt=now;
  }else return session;
 }else if(s.status==='final'){
  if(event.type==='final_answer'&&validChoice([FINAL_QUESTION],event.key,event.value)){s.finalSurvey.answers[event.key]=event.value;data={key:event.key,value:event.value};}
  else if(event.type==='final_answer'&&event.key==='reason'&&typeof event.value==='string'&&event.value.length<=1000){s.finalSurvey.answers.reason=event.value;return s;}
  else if(event.type==='final_submit'&&canComplete(s)){s.finalSurvey.durationMs=Math.max(0,Math.round(now-s.finalSurvey.startedAt));const pref=s.finalSurvey.answers.preference;s.finalSurvey.preferredCondition=['first','second'].includes(pref)?s.sequence[pref==='first'?0:1].condition:null;s.status='complete';}
  else return session;
 }else return session;
 s.events.push({type:event.type,trial:s.current?s.index:null,condition:s.current?.condition??null,taskId:s.current?.taskId??null,elapsedMs,...data});return s;
}
export function nextTrial(session,now){if(session.status!=='between')return session;const s=structuredClone(session);s.index++;s.status='running';s.current=trial(s.sequence[s.index],now);s.events.push({type:'trial_start',trial:s.index,elapsedMs:Math.max(0,Math.round(now-s.startedAt))});return s;}
export function exportStudy(s){const copy=structuredClone(s);delete copy.startedAt;delete copy.finalSurvey.startedAt;if(copy.current){delete copy.current.startedAt;delete copy.current.surveyStartedAt;}for(const t of copy.trials){delete t.startedAt;delete t.surveyStartedAt;}return {...copy,taskDefinitions:structuredClone(TASKS),surveyDefinitions:{objective:RESEARCH_OBJECTIVE,pre:PRE_QUESTIONS,post:POST_QUESTIONS,postText:POST_TEXT_QUESTIONS,final:FINAL_QUESTION,scaleNote:'Study-specific exploratory items, not validated SUS or NASA-TLX scales. Open text is optional.'},timingNote:'Milliseconds. Task and survey time are separate; hidden-tab time is included. No chat history collected. Optional free-text survey responses are exported; do not include personal information.'};}
