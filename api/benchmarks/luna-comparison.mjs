// Freeze fixtures and source hashes before real-provider calls. No agent tuning in this run.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { benchmark, comparisonTasks } from './agent-comparison.mjs';
import { singleInitial } from '../../lib/single-gift.mjs';
const ready=()=>({state:{...singleInitial(),recipients:['어머니'],budget:{amount_krw:50000,shipping_included:true}},issues:[]});
const food=['food','snack','coffee_tea','health'];
const excluded={...ready().state,preferences:['avoid_fragrance'],excluded_categories:food};
const step=(text,expectedState,extra={})=>({text,expectedState,...extra});
const regressions=[
 {id:'f_mixed',group:'fragrance_regression',label:'배송비 확인 중 향/음식 제외 → 배송비 답장 → 예산 변경',session:{state:{...ready().state,budget:{amount_krw:50000,shipping_included:null}},issues:[]},steps:[
  step('향이 강한 제품은 빼고, 먹는 것도 제외해줘.',{...excluded,budget:{amount_krw:50000,shipping_included:null}},{question:true,questionIncludes:'배송비'}),
  step('배송비 포함',excluded,{recommend:true}),
  step('예산 7만원으로 바꿔줘',{...excluded,budget:{amount_krw:70000,shipping_included:true}},{recommend:true}),
 ]},
 {id:'f_cancel',group:'fragrance_regression',label:'향 규칙만 취소하고 음식 제외 유지',session:{state:{...excluded,preferences:['less_sweet','avoid_fragrance']},issues:[]},steps:[step('향 제품 제외 취소',{...excluded,preferences:['less_sweet']},{recommend:true})]},
 {id:'f_accept',group:'fragrance_regression',label:'향 제외·추천 제안에 짧은 동의',session:{state:{...ready().state,excluded_categories:food},issues:['향이 강한 제품도 빼고 추천할까요?']},steps:[step('어',excluded,{recommend:true})]},
 {id:'f_preserve',group:'fragrance_regression',label:'향 제외 유지한 가상 예산 비교',session:{state:excluded,issues:[]},steps:[step('예산 7만원이면?',excluded,{compare:70000})]},
];
const sourceFiles=['api/worker.mjs','api/router-agent.mjs','api/full-chat-agent.mjs','baseline/agents/a-router/index.mjs','baseline/agents/a-router/parser.mjs','baseline/agents/full-chat/index.mjs','baseline/agents/full-chat/prompts.mjs','baseline/agents/full-chat/capabilities.mjs','baseline/agents/full-chat-feedback/index.mjs','baseline/llm/index.mjs','lib/engine.mjs','lib/fragrance.mjs','lib/catalog.mjs','lib/llm.mjs','lib/openai-compatible.mjs','api/benchmarks/agent-comparison.mjs','api/benchmarks/luna-comparison.mjs'];
const hashes=async()=>Object.fromEntries(await Promise.all(sourceFiles.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
const before=await hashes();
const output='docs/verification/luna-comparison-2026-11-06.json';
const report=await benchmark({repeats:3,output,variants:['a-router','full-chat','full-chat-feedback-2'],taskList:[...comparisonTasks,...regressions],suite:'luna_same_tasks_2026-11-06',envOverrides:{LLM_MODEL:'gpt-5.6-luna',LLM_REASONING_ENABLED:'false',A_ROUTER_LLM_MODE:'single'}});
const after=await hashes();
report.sourceHashes=before;report.sourceUnchanged=JSON.stringify(before)===JSON.stringify(after);
report.design='24 fixed tasks x 3 repetitions x A/B/C, sequential calls, rotating mode/task order; Luna reasoning_effort=none, temperature=0; same catalog and conditions; 20 known tasks plus 4 known fragrance regressions, not a held-out evaluation; A/B/C keep their own tool/call budgets.';
await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({completed:true,sourceUnchanged:report.sourceUnchanged,output}));
