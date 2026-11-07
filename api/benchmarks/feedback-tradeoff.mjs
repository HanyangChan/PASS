// Fixtures frozen before any real-provider feedback run. No expected answers reach actor/reviewer.
import { writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { benchmark, comparisonTasks, summarize } from './agent-comparison.mjs';
import { singleInitial } from '../../lib/single-gift.mjs';
import { apply } from '../../lib/engine.mjs';
const ready=()=>({state:{...singleInitial(),recipients:['어머니'],budget:{amount_krw:50000,shipping_included:true}},issues:[]});
const sensitive=()=>({state:{...ready().state,preferences:['category:coffee_tea','type:tea'],excluded_ingredients:['우유']},issues:[]});
const step=(text,state,extra={})=>({text,expectedState:state,...extra});
const changed=(session,patch)=>apply(session.state,patch);
export const holdout=[
 {id:'h_owner',group:'ownership',label:'주는 사람의 단맛 취향과 미확정 수령인 취향',session:ready(),steps:[step('저는 단 걸 좋아하지만 받는 분 취향은 아직 몰라요.',ready().state,{question:true})]},
 {id:'h_tea',group:'natural',label:'받는 분의 홍차 선호 표현',session:ready(),steps:[step('받으실 어머니가 커피 대신 홍차를 원하셔요. 예산은 그대로요.',changed(ready(),{preferences:['category:coffee_tea','type:tea']}),{recommend:true})]},
 {id:'h_exclusion',group:'constraints',label:'기존 우유 제외를 유지하며 견과류 추가 제외',session:sensitive(),steps:[step('기존에 피하던 성분은 그대로 두고 견과류도 들어가지 않는 걸로 부탁해요.',changed(sensitive(),{excluded_ingredients:['우유','견과류']}),{recommend:true})]},
 {id:'h_budget',group:'natural',label:'배송료 포함 한글 예산 감액',session:sensitive(),steps:[step('배송료 포함해서 삼만 원 선으로 낮춰 주세요.',changed(sensitive(),{budget:{amount_krw:30000}}),{recommend:true})]},
 {id:'h_relative',group:'comparison',label:'상대 예산 가정 비교',session:sensitive(),steps:[step('지금보다 만 원 더 쓰면 무엇이 달라져요?',sensitive().state,{compare:60000})]},
 {id:'h_date',group:'validation',label:'윤년이 아닌 해의 2월 29일',session:ready(),steps:[step('2027년 2월 29일까지 받을 수 있게 해주세요.',ready().state,{question:true})]},
 {id:'h_recipient',group:'constraints',label:'수령인 변경과 조건 초기화',session:sensitive(),steps:[step('이번 선물은 아버지께 드릴 거예요. 배송료 포함 6만원이고 다른 조건은 새로 정할게요.',{...singleInitial(),recipients:['아버지'],budget:{amount_krw:60000,shipping_included:true}},{recommend:true})]},
 {id:'h_shipping',group:'context',label:'배송비 확인에 긍정 답장',session:{...ready(),state:changed(ready(),{budget:{shipping_included:null}})},steps:[step('네, 배송비까지요',ready().state,{source:'quick_reply',recommend:true})]},
 {id:'h_multiple',group:'validation',label:'지원하지 않는 다중 선물 확인',session:ready(),steps:[step('두 사람에게 한 개씩 총 여덟만원으로 나눠서 보내려고 해요.',ready().state,{question:true})]},
 {id:'h_correction',group:'constraints',label:'차 선호를 커피로 교체',session:sensitive(),steps:[step('차 말고 커피로 추천해주세요.',changed(sensitive(),{preferences:['category:coffee_tea','type:coffee']}),{recommend:true})]},
];

const variants=['full-chat','full-chat-feedback-1','full-chat-feedback-2'];
const prefix='docs/verification/feedback-tradeoff-2026-11-06';
try {
 const sourceFiles=['baseline/agents/full-chat/index.mjs','baseline/agents/full-chat/prompts.mjs','baseline/agents/full-chat-feedback/index.mjs','api/full-chat-agent.mjs','api/worker.mjs'];
 const sourceHashes={};for(const file of sourceFiles)sourceHashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
 const options={variants,envOverrides:{LLM_REASONING_ENABLED:'false'}};
 const regression=await benchmark({...options,suite:'regression_known',taskList:comparisonTasks,repeats:1,output:`${prefix}-regression.json`});
 const unseen=await benchmark({...options,suite:'new_wording_holdout',taskList:holdout,repeats:3,output:`${prefix}-holdout.json`});
 const summaries=Object.fromEntries(variants.map(agent=>{
  const rows=[...regression.results,...unseen.results].filter(r=>r.agent===agent),turns=rows.flatMap(r=>r.turns);
  return [agent,{overall:summarize(rows),holdout:unseen.summary[agent].overall,regression:regression.summary[agent].overall,feedback:{actorCalls:turns.reduce((s,t)=>s+(t.feedback?.actorCalls??t.llmCalls),0),reviewCalls:turns.reduce((s,t)=>s+(t.feedback?.reviewCalls??0),0),revisions:turns.reduce((s,t)=>s+(t.feedback?.revisions??0),0),budgetExhaustions:turns.filter(t=>t.feedback?.limitReached).length}}];
 }));
 const report={generatedAt:new Date().toISOString(),timezone:'Asia/Seoul',variants,sourceHashes,design:'same B actor/runtime; max 0/1/2 reviews PER DECISION; re-review only after rejection; revision may execute after final allowed review; global 10 actual-call budget, 20-second deadline; B retains default six-call limit; all modes reasoning=false',regression:{file:`${prefix}-regression.json`,tasks:20,repeats:1},holdout:{file:`${prefix}-holdout.json`,tasks:10,repeats:3},summaries};
 await writeFile(`${prefix}.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({finishedTradeoff:true,summaries}));
} catch {console.error(JSON.stringify({error:'feedback_benchmark_failed'}));process.exitCode=1;}
