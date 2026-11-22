import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const review=JSON.parse(await readFile(new URL('docs/verification/gift-suitability-llm-judgments-2026-11-16.json',root),'utf8'));
const labels=new Map(review.judgments.map(j=>[`${j.case}:${j.product}`,j]));
const runs={};
for(const label of ['before','after']) {
 const input=JSON.parse(await readFile(new URL(`docs/verification/artifacts/2026-11-16/gift-suitability-${label}.json`,root),'utf8'));
 const products=[],abstentions=[];
 for(const task of input.results) {
  if(!task.result.items.length)abstentions.push({source:task.source,id:task.id,message:task.result.message});
  for(const p of task.result.items) {
   const judgment=labels.get(`${task.id}:${p.id}`);assert.ok(judgment,`Missing LLM judgment: ${task.id}:${p.id}`);
   products.push({source:task.source,case:task.id,product:p.id,name:p.name,total:p.total,...judgment});
  }
 }
 runs[label]={tasks:input.results.length,presentedProducts:products.length,score0:products.filter(p=>p.score===0).length,score1:products.filter(p=>p.score===1).length,score2:products.filter(p=>p.score===2).length,
  meanScore:products.reduce((n,p)=>n+p.score,0)/products.length,abstentions,products};
}
const report={judge:review.judge,rubric:review.rubric,limits:review.limits,runs};
await mkdir(new URL('work/unseen-evaluation/',root),{recursive:true});
await writeFile(new URL('work/unseen-evaluation/llm-review-summary.json',root),JSON.stringify(report,null,2)+'\n');
for(const[label,{products,...summary}]of Object.entries(runs))console.log(JSON.stringify({label,...summary}));
