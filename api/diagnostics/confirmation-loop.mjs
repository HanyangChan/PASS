// Synthetic sessions only; uses the configured provider without touching user records.
import { readFile, writeFile } from 'node:fs/promises';
import { loadLocalEnv } from '../local-env.mjs';
import { prototypeFullChatTurn } from '../full-chat-agent.mjs';
import { createAgent } from '../../baseline/agents/full-chat-feedback/index.mjs';
import { singleInitial } from '../../lib/single-gift.mjs';
import { products } from '../../baseline/examples/catalog.mjs';
import { toEngineProduct } from '../../lib/catalog.mjs';

const env=await loadLocalEnv();
const realCatalog=process.argv[3]==='catalog';
const catalog=realCatalog?JSON.parse(await readFile(new URL('../../supabase/seed/products-amazon.json',import.meta.url),'utf8')).map(p=>toEngineProduct(p,'2026-11-06')):products;
const question='향이 강한 제품(향수·방향제 등)도 제외하고, 조건에 맞는 상품 3개를 추천할까요?';
const runs=[];
for(const mode of ['full-chat','full-chat-feedback-2']) {
  for(const scenario of realCatalog?['new_constraint']:['new_constraint','confirmation','inverted_question']) {
    let state={...singleInitial(),recipients:['어머니'],budget:{amount_krw:70000,shipping_included:true},excluded_categories:['food','snack','coffee_tea','health']};
    if(realCatalog)state.excluded_categories=[];
    let issues=scenario==='new_constraint'?[]:[scenario==='confirmation'?question:'음식만 포함하고, 향이 강한 제품(향수·방향제 등)도 제외할까요?'];
    let history=[{role:'user',text:'향이 강한 제품은 빼고, 먹는 것도 제외해줘.'},...(issues.length?[{role:'assistant',text:issues[0]}]:[])];
    const turns=[];
    for(const text of scenario==='new_constraint'?['향이 강한 제품은 빼고, 먹는 것도 제외해줘.','어','그래']:['어','그래']) {
      const actions=[];
      const fetcher=async(...args)=>{
        const response=await fetch(...args);
        if(response.ok) {
          const body=await response.clone().json();
          try {actions.push(JSON.parse(body.choices[0].message.content));} catch {}
        }
        return response;
      };
      const started=Date.now();
      try {
        const out=await prototypeFullChatTurn({state,issues,history:history.slice(-6),operation:'turn',text},catalog,{env,fetcher,...(mode==='full-chat-feedback-2'?{agentFactory:options=>createAgent({...options,maxReviews:2})}:{})});
        turns.push({text,message:out.message,question:out.question.key,exclusions:out.session.state.excluded_categories,actions,elapsedMs:Date.now()-started});
        state=out.session.state;issues=out.session.issues;
        history.push({role:'user',text},{role:'assistant',text:out.message});
      } catch(error) { turns.push({text,error:error.code??'failed',actions});break; }
    }
    runs.push({mode,scenario,turns});
    console.log(JSON.stringify(runs.at(-1)));
  }
}
const expected=['food','snack','coffee_tea','health'];
const passed=runs.every(r=>r.turns.every(t=>!t.error&&t.question===null&&t.exclusions.length===expected.length&&expected.every(c=>t.exclusions.includes(c)))&&r.turns[0].message.includes('향 강도 정보가 없어'));
if(process.argv[2])await writeFile(process.argv[2],JSON.stringify({generatedAt:new Date().toISOString(),catalog:realCatalog?'amazon-snapshot':'synthetic',passed,runs},null,2)+'\n');
console.log(JSON.stringify({passed}));
if(!passed)process.exitCode=1;
