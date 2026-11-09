// Paired, sequential real-provider benchmark. No agent code/config is mutated.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import { createApi } from '../worker.mjs';
import { loadLocalEnv } from '../local-env.mjs';
import { singleInitial, engineState } from '../../lib/single-gift.mjs';
import { toEngineProduct } from '../../lib/catalog.mjs';
import { recommend, apply, APP_RANKING } from '../../lib/engine.mjs';

const clone=structuredClone;
const initial=()=>({state:singleInitial(),issues:[]});
const ready=()=>({state:{...singleInitial(),recipients:['어머니'],budget:{amount_krw:50000,shipping_included:true}},issues:[]});
const sensitive=()=>({state:{...ready().state,preferences:['category:coffee_tea','type:tea'],excluded_ingredients:['견과류']},issues:[]});
const shipping=()=>({state:{...ready().state,budget:{amount_krw:50000,shipping_included:null}},issues:[]});
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const expected=(session,patch)=>apply(session.state,patch);
const step=(text,state,extra={})=>({text,expectedState:state,...extra});
const tasks=[
  {id:'initial',group:'routine',label:'명확한 최초 조건',session:initial(),steps:[step('어머니 예산 5만원 배송비 포함',ready().state,{recommend:true})]},
  {id:'budget',group:'routine',label:'명시적 예산 수정',session:sensitive(),steps:[step('예산 7만원으로 바꿔줘',expected(sensitive(),{budget:{amount_krw:70000}}),{recommend:true})]},
  {id:'tea',group:'routine',label:'차 선호',session:ready(),steps:[step('차 좋아해',expected(ready(),{preferences:['category:coffee_tea','type:tea']}),{recommend:true})]},
  {id:'exclude',group:'routine',label:'견과류 제외 추가',session:ready(),steps:[step('견과류는 빼줘',expected(ready(),{excluded_ingredients:['견과류']}),{recommend:true})]},
  {id:'shipping_no',group:'routine',label:'배송비 빠른 답장',session:shipping(),steps:[step('아니요',expected(shipping(),{budget:{shipping_included:false}}),{source:'quick_reply',recommend:true})]},
  {id:'recommend',group:'routine',label:'현재 조건 추천',session:sensitive(),steps:[step('추천해줘',sensitive().state,{recommend:true})]},
  {id:'explain',group:'routine',label:'추천 이유 설명',session:sensitive(),steps:[step('왜 추천했어?',sensitive().state,{recommend:true,explain:true})]},
  {id:'compare',group:'routine',label:'가상 예산 비교',session:sensitive(),steps:[step('예산 7만원이면?',sensitive().state,{compare:70000})]},
  {id:'recipient',group:'routine',label:'수령인 변경과 이전 조건 초기화',session:sensitive(),steps:[step('친구 예산 4만원 배송비 포함',{...singleInitial(),recipients:['친구'],budget:{amount_krw:40000,shipping_included:true}},{recommend:true})]},
  {id:'conflict',group:'safety',label:'충돌 예산 확인',session:ready(),steps:[step('예산 5만원 이하 최소 7만원',ready().state,{question:true})]},
  {id:'giver',group:'safety',label:'주는 사람 취향을 수령인에 적용하지 않음',session:ready(),steps:[step('나는 커피를 좋아해',ready().state,{question:true})]},
  {id:'allergy_unknown',group:'safety',label:'알레르기 성분 미확정',session:ready(),steps:[step('알레르기가 있어요',ready().state,{question:true,questionIncludes:'성분'})]},
  {id:'allergy_block',group:'safety',label:'성분 미확정 시 비교 차단',session:{...ready(),issues:['피해야 할 성분을 알려주세요.']},steps:[step('예산 7만원이면?',ready().state,{question:true,questionIncludes:'성분'})]},
  {id:'invalid_date',group:'safety',label:'존재하지 않는 날짜 확인',session:ready(),steps:[step('2026-02-30까지 도착해야 해',ready().state,{question:true})]},
  {id:'greeting',group:'conversation',label:'인사에 인사로 답하기',session:initial(),steps:[step('안녕',initial().state,{messagePattern:'안녕'})]},
  {id:'thanks',group:'conversation',label:'감사에 응답하기',session:ready(),steps:[step('고마워',ready().state,{messagePattern:'감사|기뻐|도움|천만|언제든'})]},
  {id:'natural_preferences',group:'natural',label:'자연어 차 선호·우유 회피·기존 제외 유지',session:sensitive(),steps:[step('받는 분은 커피보다 차를 즐기고, 우유가 들어간 음식은 피하고 싶대요. 지금 정한 예산과 배송비 조건은 그대로 해주세요.',expected(sensitive(),{excluded_ingredients:['견과류','우유']}),{recommend:true})]},
  {id:'natural_budget',group:'natural',label:'한글 금액·자연스러운 수정 표현',session:sensitive(),steps:[step('아까 말한 금액 대신 이번에는 배송비까지 합쳐서 사만 원을 넘기지 않게 골라주세요.',expected(sensitive(),{budget:{amount_krw:40000}}),{recommend:true})]},
  {id:'natural_occasion',group:'natural',label:'복합 자연어 최초 조건',session:initial(),steps:[step('받는 분은 은사님이고 생신 선물을 드리려고 해요. 격식 있는 포장에 차를 좋아하시고 우유는 피하신대요. 선물 하나에 배송비까지 5만원 안으로 골라주세요.',{...singleInitial(),recipients:['은사님'],occasion:'생신',packaging:'formal',preferences:['category:coffee_tea','type:tea'],excluded_ingredients:['우유'],budget:{amount_krw:50000,shipping_included:true}},{recommend:true})]},
  {id:'multiturn',group:'multiturn',label:'조건 입력→취향 추가→가상 비교',session:initial(),steps:[step('어머니 예산 5만원 배송비 포함',ready().state,{recommend:true}),step('차 좋아해',expected(ready(),{preferences:['category:coffee_tea','type:tea']}),{recommend:true}),step('예산 7만원이면?',expected(ready(),{preferences:['category:coffee_tea','type:tea']}),{compare:70000})]},
];
export const comparisonTasks=tasks;

function sameField(key,a,b) {
  // Order of set-valued conditions and synonymous birthday labels are immaterial.
  if(Array.isArray(a)&&Array.isArray(b))return eq([...a].sort(),[...b].sort());
  if(key==='occasion' && b==='생신')return ['생신','생일'].includes(a);
  return eq(a,b);
}
export function evaluate(data,status,spec,products) {
  const checks=[];
  const add=(id,passed,detail)=>checks.push({id,passed:Boolean(passed),...(!passed&&detail!==undefined?{actual:detail}:{})});
  add('http',status===200,status);
  if(status!==200||!data.session?.state)return checks;
  for(const [field,value] of Object.entries(spec.expectedState))add(`state.${field}`,sameField(field,data.session.state[field],value),data.session.state[field]);
  if(spec.question) {
    add('clarification',Boolean(data.question?.key),data.message);
    if(spec.questionIncludes)add('question_content',data.question?.text?.includes(spec.questionIncludes),data.question?.text);
  } else if(spec.messagePattern) add('conversation',new RegExp(spec.messagePattern).test(data.message),data.message);
  else {
    add('no_unnecessary_question',data.question?.key===null,data.question?.text);
    const normal=recommend(products,engineState(spec.expectedState),APP_RANKING);
    add('recommendation_ids',eq(data.view?.result?.items?.map(p=>p.id),normal.items.map(p=>p.id)),data.view?.result?.items?.map(p=>p.id));
    add('recommendation_costs',eq(data.view?.result?.items?.map(p=>p.total),normal.items.map(p=>p.total)),data.view?.result?.items?.map(p=>p.total));
    if(spec.explain) {
      add('explanation_action',data.routing?.intent==='explain',data.routing?.intent);
      if(normal.items.length)add('explanation_evidence',data.message?.includes(normal.items[0].name)&&data.message?.includes(normal.items[0].total.toLocaleString('ko-KR')),data.message);
    }
    if(spec.compare) {
      const compared=recommend(products,engineState({...spec.expectedState,budget:{...spec.expectedState.budget,amount_krw:spec.compare}}),APP_RANKING);
      add('comparison_action',data.routing?.intent==='compare_budget',data.routing?.intent);
      add('hypothetical_amount',data.message?.includes(spec.compare.toLocaleString('ko-KR')),data.message);
      if(compared.items.length)add('comparison_evidence',data.message?.includes(compared.items[0].name),data.message);
      else add('comparison_empty',/없/.test(data.message),data.message);
    }
  }
  return checks;
}

const percentile=(values,p)=>{const a=[...values].sort((a,b)=>a-b);return a.length?a[Math.max(0,Math.ceil(a.length*p)-1)]:null;};
export function summarize(rows) {
  const n=rows.length,latency=rows.map(r=>r.latencyMs),checks=rows.flatMap(r=>r.turns.flatMap(t=>t.checks));
  const passed=rows.filter(r=>r.passed).length,turns=rows.flatMap(r=>r.turns),sum=k=>turns.reduce((s,t)=>s+(t[k]??0),0);
  return {runs:n,passed,taskAccuracy:n?passed/n:null,atomicPassed:checks.filter(c=>c.passed).length,atomicTotal:checks.length,meanLatencyMs:n?latency.reduce((a,b)=>a+b,0)/n:null,medianLatencyMs:percentile(latency,.5),p95LatencyMs:percentile(latency,.95),meanSuccessfulLatencyMs:passed?rows.filter(r=>r.passed).reduce((s,r)=>s+r.latencyMs,0)/passed:null,requests:turns.length,meanRequestLatencyMs:turns.length?turns.reduce((s,t)=>s+t.latencyMs,0)/turns.length:null,medianRequestLatencyMs:percentile(turns.map(t=>t.latencyMs),.5),p95RequestLatencyMs:percentile(turns.map(t=>t.latencyMs),.95),httpErrors:turns.filter(t=>t.status!==200).length,llmCalls:sum('llmCalls'),httpAttempts:sum('httpAttempts'),totalTokens:sum('totalTokens')};
}

export async function benchmark({repeats=3,output='docs/verification/agent-comparison-2026-11-06.json',variants=['a-router','full-chat'],taskList=tasks,envOverrides={},suite='original'}={}) {
  const local=await loadLocalEnv();
  if(local.LLM_PROVIDER!=='openai-compatible'||!local.LLM_API_KEY)throw Error('configuration');
  const catalogText=await readFile(new URL('../../supabase/seed/products-amazon.json',import.meta.url),'utf8');
  const catalogDay='2026-11-06',products=JSON.parse(catalogText).map(p=>toEngineProduct(p,catalogDay));
  const results=[],wireSettings={};
  const base={...local,...envOverrides,SUPABASE_URL:'https://comparison.invalid',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_comparison',IP_LIMITER:{limit:async()=>({success:true})},USER_LIMITER:{limit:async()=>({success:true})}};
  const startedAt=new Date().toISOString();
  for(let repeat=0;repeat<repeats;repeat++) {
    // Rotate task order and alternate A/B order to distribute warm-up/cache/time effects.
    const ordered=taskList.slice(repeat*7%taskList.length).concat(taskList.slice(0,repeat*7%taskList.length));
    for(let index=0;index<ordered.length;index++) {
      const task=ordered[index];
      for(const agent of variants.map((_,offset)=>variants[(index+repeat+offset)%variants.length])) {
        const turns=[];let session=clone(task.session),history=[],httpAttempts=0,totalTokens=0;
        const api=createApi({catalog:async()=>products,fetcher:async(url,options)=>{
          if(String(url)==='https://comparison.invalid/auth/v1/user')return Response.json({id:'synthetic-owner',role:'authenticated'});
          httpAttempts++;
          const payload=JSON.parse(options.body);
          wireSettings[agent]={model:payload.model,temperature:payload.temperature,reasoning:payload.reasoning??'omitted',reasoningEffort:payload.reasoning_effort??'omitted',maxTokens:payload.max_completion_tokens??payload.max_tokens,responseModels:wireSettings[agent]?.responseModels??{}};
          const response=await fetch(url,options);
          if(response.ok) {
            const body=await response.clone().json().catch(()=>null);
            totalTokens+=body?.usage?.total_tokens??0;
            if(typeof body?.model==='string')wireSettings[agent].responseModels[body.model]=(wireSettings[agent].responseModels[body.model]??0)+1;
          }
          return response;
        }});
        const taskStart=performance.now();
        for(let turnIndex=0;turnIndex<task.steps.length;turnIndex++) {
          const spec=task.steps[turnIndex],beforeAttempts=httpAttempts,beforeTokens=totalTokens,start=performance.now();
          const response=await api.fetch(new Request('https://benchmark.local/api/chat',{method:'POST',headers:{Authorization:'Bearer synthetic-comparison-token','Content-Type':'application/json'},body:JSON.stringify({operation:'turn',text:spec.text,session:clone(session),history:history.slice(-6),source:spec.source??'typed'})}),{...base,CHAT_AGENT:agent});
          const data=await response.json();
          const latencyMs=performance.now()-start,checks=evaluate(data,response.status,spec,products);
          turns.push({turn:turnIndex+1,text:spec.text,status:response.status,latencyMs,passed:checks.every(c=>c.passed),checks,llmCalls:data.routing?.llmCalls??0,httpAttempts:httpAttempts-beforeAttempts,totalTokens:totalTokens-beforeTokens,route:data.routing?.route,steps:data.routing?.steps,feedback:data.routing?.feedback,stopReason:data.routing?.stopReason,...(data.code?{code:data.code}:{}),response:{state:data.session?.state,issues:data.session?.issues,question:data.question,message:data.message,productIds:data.view?.result?.items?.map(p=>p.id)}});
          if(response.status===200&&data.session)session=clone(data.session);
          history.push({role:'user',text:spec.text},{role:'assistant',text:String(data.message??data.error??'').slice(0,1200)});
        }
        const row={agent,repeat:repeat+1,task:task.id,label:task.label,group:task.group,passed:turns.every(t=>t.passed),latencyMs:performance.now()-taskStart,turns};
        results.push(row);
        console.log(JSON.stringify({agent,repeat:repeat+1,task:task.id,passed:row.passed,ms:Math.round(row.latencyMs),calls:turns.reduce((s,t)=>s+t.llmCalls,0),failures:turns.flatMap(t=>t.checks.filter(c=>!c.passed).map(c=>c.id))}));
      }
    }
    // Checkpoint after each complete repetition, including failures.
    await save();
  }
  async function save() {
    const report={startedAt,finishedAt:new Date().toISOString(),timezone:'Asia/Seoul',suite,variants,repeats,tasks:taskList.length,model:base.LLM_MODEL,aMode:base.A_ROUTER_LLM_MODE||'single',reasoningSetting:base.LLM_REASONING_ENABLED??'provider_default',wireSettings,catalog:{products:products.length,day:catalogDay,sha256:createHash('sha256').update(catalogText).digest('hex')},scope:'actual Worker handler; real configured LLM; fixed 3376-row local catalog; synthetic auth/session; excludes UI, real auth and DB network latency; no agent code changes during run',fixtures:taskList,summary:Object.fromEntries(variants.map(agent=>[agent,{overall:summarize(results.filter(r=>r.agent===agent)),business:summarize(results.filter(r=>r.agent===agent&&r.group!=='conversation')),byGroup:Object.fromEntries([...new Set(taskList.map(t=>t.group))].map(group=>[group,summarize(results.filter(r=>r.agent===agent&&r.group===group))]))}])),results};
    const destination=resolve(output);await mkdir(dirname(destination),{recursive:true});await writeFile(destination,JSON.stringify(report,null,2)+'\n');
    return report;
  }
  const report=await save();console.log(JSON.stringify({finished:true,output,summary:report.summary}));return report;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const repeats=Number(process.argv.find(a=>a.startsWith('--repeats='))?.split('=')[1]??3);
  if(!Number.isInteger(repeats)||repeats<1||repeats>10)throw Error('invalid_repeats');
  benchmark({repeats}).catch(()=>{console.error(JSON.stringify({error:'benchmark_failed'}));process.exitCode=1;});
}
