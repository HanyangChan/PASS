import { createLlmClient } from '../../../llm/index.mjs';
import { validateState } from '../../../src/contracts.mjs';
import { SubagentError, makeSources, prepareSynthesis, safeDiagnostics } from './contracts.mjs';
import { PROMPT_VERSION } from './prompts.mjs';
import { runSupervisor } from './supervisor.mjs';
import { runSynthesizer } from './synthesizer.mjs';
import { run as recipient } from './recipient.mjs';
import { run as occasion } from './occasion.mjs';
import { run as spending } from './spending.mjs';
import { run as taste } from './taste.mjs';
const specialists={recipient,occasion,spending,taste};
const defaults={totalMs:16000,supervisorMs:6500,specialistsMs:6500,synthesizerMs:5000};

export function createSubagentInterpreter({env={},llmOptions,limits={},onTrace}={}) {
  if(env.LLM_PROVIDER&&env.LLM_PROVIDER!=='openai-compatible')throw new SubagentError('configuration');
  const options=llmOptions??{apiKey:env.LLM_API_KEY,model:env.LLM_MODEL,baseUrl:env.LLM_BASE_URL,chatPath:env.LLM_CHAT_PATH};
  const budget={...defaults,...limits};
  if(Object.keys(budget).some(k=>!Object.hasOwn(defaults,k))||Object.values(budget).some(v=>!Number.isSafeInteger(v)||v<1)||budget.totalMs>16000)throw new SubagentError('configuration');
  if(options.responseFormat&& !['json_object','text'].includes(options.responseFormat))throw new SubagentError('configuration');
  return async function interpret({text,state,pendingQuestion='',history=[],signal,stateVersion}) {
    validateState(state);
    if(typeof text!=='string'||!text.trim()||text.length>4000||!Array.isArray(history)||history.length>6||history.some(m=>!['user','assistant'].includes(m?.role)||typeof m.text!=='string'||m.text.length>1200)||typeof pendingQuestion!=='string'||pendingQuestion.length>400)throw new SubagentError('invalid_input');
    const stats={mode:'subagents',runId:crypto.randomUUID(),stateVersion,selectedAgents:[],logicalCalls:0,httpAttempts:0,stages:[]};
    const controller=new AbortController();const deadline=Date.now()+budget.totalMs;let totalExpired=false;
    const externalAbort=()=>controller.abort();signal?.addEventListener('abort',externalAbort,{once:true});
    if(signal?.aborted)controller.abort();
    const totalTimer=setTimeout(()=>{totalExpired=true;controller.abort();},budget.totalMs);
    const context={text,state:structuredClone(state),pendingQuestion,sources:makeSources(text,history),todayKst:new Date(Date.now()+9*3600e3).toISOString().slice(0,10)};
    const finish=value=>({...value,diagnostics:safeDiagnostics(stats)});
    async function run(id,{system,payload,maxTokens,validate}) {
      if(controller.signal.aborted)throw new SubagentError(totalExpired?'deadline_exceeded':'aborted');
      if(stats.logicalCalls>=6)throw new SubagentError('call_limit');
      stats.logicalCalls++;
      const record={agentId:id,status:'running',latencyMs:0,usage:{}};stats.stages.push(record);
      const started=Date.now();
      const duration=Math.min(deadline-started,id==='supervisor'?budget.supervisorMs:id==='synthesizer'?budget.synthesizerMs:budget.specialistsMs);
      if(duration<1){record.status='failed';throw new SubagentError('deadline_exceeded');}
      const stageController=new AbortController();let timer,abort;
      try {
        const stop=new Promise((_,reject)=>{
          abort=()=>{stageController.abort();reject(new SubagentError(totalExpired?'deadline_exceeded':'aborted'));};
          controller.signal.addEventListener('abort',abort,{once:true});
          timer=setTimeout(()=>{stageController.abort();reject(new SubagentError('stage_timeout'));},duration);
        });
        const fetcher=async(url,request)=>{
          if(controller.signal.aborted||stageController.signal.aborted)throw new SubagentError('aborted');
          if(stats.httpAttempts>=12)throw new SubagentError('call_limit');
          stats.httpAttempts++;
          return (options.fetcher??fetch)(url,request);
        };
        const client=createLlmClient({...options,fetcher,timeoutMs:duration,onUsage:usage=>{
          if(record.status==='running')record.usage=Object.fromEntries(Object.entries(usage).filter(([k,v])=>['prompt_tokens','completion_tokens','total_tokens'].includes(k)&&Number.isSafeInteger(v)&&v>=0));
        }});
        const response=await Promise.race([client.completeJson({
          messages:[{role:'system',content:system},{role:'user',content:JSON.stringify({stage:id,promptVersion:PROMPT_VERSION,input:payload})}],
          responseFormat:options.responseFormat??'json_object',maxTokens,signal:stageController.signal,reasoningEffort:options.reasoningEffort,reasoningEnabled:options.reasoningEnabled??(client.model.startsWith('deepseek')?false:undefined),validate,
        }),stop]);
        record.status='passed';return response.data;
      } catch(error) {record.status='failed';record.errorCode=['invalid_analysis','invalid_response','stage_timeout','deadline_exceeded','aborted','auth_failed','quota_exceeded','endpoint_or_model_not_found','provider_unavailable','request_rejected','network_error','timeout','call_limit'].includes(error?.code)?error.code:'analysis_failed';throw error;}
      finally {record.latencyMs=Date.now()-started;clearTimeout(timer);controller.signal.removeEventListener('abort',abort);stageController.abort();}
    }
    try {
      const selection=await runSupervisor(run,context);
      stats.selectedAgents=selection.tasks.map(t=>t.agentId);
      if(!selection.tasks.length)return finish({patch:{},questions:[selection.question],unresolved:true});
      const settled=await Promise.allSettled(selection.tasks.map(async task=>{
        try {return await specialists[task.agentId](run,context,task);}
        catch(error){controller.abort();throw error;}
      }));
      const failures=settled.filter(s=>s.status==='rejected');
      if(failures.length)throw failures.find(s=>s.reason?.code!=='aborted')?.reason??failures[0].reason;
      const analyses=settled.map(s=>s.value);
      const prepared=prepareSynthesis(analyses,state,{text});
      const result=await runSynthesizer(run,{...prepared,analyses});
      return finish(result);
    } catch(error) {
      const allowed=['configuration','invalid_analysis','invalid_response','stage_timeout','deadline_exceeded','aborted','auth_failed','quota_exceeded','endpoint_or_model_not_found','provider_unavailable','request_rejected','network_error','timeout','call_limit'];
      throw new SubagentError(allowed.includes(error?.code)?error.code:'invalid_analysis',safeDiagnostics(stats));
    } finally {
      clearTimeout(totalTimer);signal?.removeEventListener('abort',externalAbort);controller.abort();
      try {onTrace?.(safeDiagnostics(stats));} catch {}
    }
  };
}
