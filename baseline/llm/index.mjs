// Server-only, dependency-free OpenAI-compatible transport. No domain prompts or agent routing.
export class LlmError extends Error {
  constructor(code,status=0) { super(code);this.name='LlmError';this.code=code;this.status=status; }
}
export function completionUrl(baseUrl,chatPath='chat/completions') {
  let url;
  try {url=new URL(baseUrl);} catch {throw new LlmError('configuration');}
  if (url.username||url.password||url.search||url.hash||(url.protocol!=='https:'&&!(url.protocol==='http:'&&['localhost','127.0.0.1'].includes(url.hostname)))) throw new LlmError('configuration');
  if (typeof chatPath!=='string') throw new LlmError('configuration');
  const path=chatPath.replace(/^\/+/, '');
  if (!['chat/completions','v1/chat/completions'].includes(path)) throw new LlmError('configuration');
  return `${url.href.replace(/\/$/,'')}/${path}`;
}
export function createLlmClient({
  apiKey,model='deepseek-v4-flash',baseUrl='https://llm.ai.hy.miwork.ai',chatPath='chat/completions',
  fetcher=fetch,timeoutMs=18000,onUsage,
}={}) {
  if (typeof window!=='undefined') throw new LlmError('server_only');
  const url=completionUrl(baseUrl,chatPath);
  if (typeof model!=='string'||!model.trim()||typeof fetcher!=='function'||!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000) throw new LlmError('configuration');
  const configured=typeof apiKey==='string'&&Boolean(apiKey.trim());
  async function complete({messages,responseFormat='text',schema,schemaName='response',temperature=0,maxTokens=1600,signal,reasoningEffort,reasoningEnabled}={}) {
    if (!configured) throw new LlmError('configuration');
    if (!Array.isArray(messages)||!messages.length||messages.length>100||messages.some(m=>!m||!['system','user','assistant'].includes(m.role)||typeof m.content!=='string')||!['text','json_object','json_schema'].includes(responseFormat)||!Number.isFinite(temperature)||temperature<0||temperature>2||!Number.isSafeInteger(maxTokens)||maxTokens<1||maxTokens>100000) throw new LlmError('invalid_request');
    if(reasoningEnabled!==undefined&&typeof reasoningEnabled!=='boolean')throw new LlmError('invalid_request');
    if(reasoningEffort!==undefined&&!['none','minimal','low','medium','high','xhigh','max'].includes(reasoningEffort))throw new LlmError('invalid_request');
    if (responseFormat==='json_schema'&&(!schema||typeof schema!=='object'||Array.isArray(schema)||typeof schemaName!=='string'||! /^[A-Za-z0-9_-]{1,64}$/.test(schemaName))) throw new LlmError('invalid_request');
    if (signal!==undefined&&!(signal instanceof AbortSignal)) throw new LlmError('invalid_request');
    if (signal?.aborted) throw new LlmError('aborted');
    const payload={model,stream:false,temperature,max_tokens:maxTokens,messages:messages.map(({role,content})=>({role,content}))};
    if(reasoningEnabled!==undefined)payload.reasoning={enabled:reasoningEnabled};
    if(reasoningEffort!==undefined)payload.reasoning_effort=reasoningEffort;
    if(responseFormat==='json_object')payload.response_format={type:'json_object'};
    if(responseFormat==='json_schema')payload.response_format={type:'json_schema',json_schema:{name:schemaName,strict:true,schema}};
    const controller=new AbortController();let timedOut=false;
    const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
    try {
      const options={method:'POST',redirect:'error',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify(payload)};
      let response;
      try {
        response=await fetcher(url,options);
        if([500,502,503,504].includes(response.status)) {
          await response.body?.cancel();
          if(controller.signal.aborted)throw Error();
          response=await fetcher(url,options);
        }
      } catch(error) {throw new LlmError(timedOut||error?.name==='TimeoutError'?'timeout':signal?.aborted?'aborted':'network_error');}
      if(!response.ok) {
        await response.body?.cancel();
        const code=[401,403].includes(response.status)?'auth_failed':response.status===429?'quota_exceeded':response.status===404?'endpoint_or_model_not_found':response.status>=500?'provider_unavailable':'request_rejected';
        throw new LlmError(code,response.status);
      }
      let body;
      try {body=await response.json();} catch {throw new LlmError(timedOut?'timeout':signal?.aborted?'aborted':'invalid_response');}
      const choice=body?.choices?.[0];
      if(!choice||(choice.finish_reason!==undefined&&choice.finish_reason!=='stop')||choice.message?.tool_calls?.length||typeof choice.message?.content!=='string'||!choice.message.content.trim())throw new LlmError('invalid_response');
      const usage={};
      for(const key of ['prompt_tokens','completion_tokens','total_tokens'])if(Number.isSafeInteger(body.usage?.[key])&&body.usage[key]>=0)usage[key]=body.usage[key];
      onUsage?.({provider:'openai-compatible',model,...usage});
      return {text:choice.message.content,provider:'openai-compatible',model,usage};
    } finally {clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  }
  async function completeJson({validate,...request}={}) {
    if(validate!==undefined&&typeof validate!=='function')throw new LlmError('invalid_request');
    const result=await complete({responseFormat:'json_object',...request});
    try {
      const data=JSON.parse(result.text);
      if(validate&&await validate(data)===false)throw Error();
      return {...result,data};
    } catch {throw new LlmError('invalid_response');}
  }
  return Object.freeze({provider:'openai-compatible',model,configured,complete,completeJson});
}
export function createLlmFromEnv(env={},options={}) {
  if(env.LLM_PROVIDER&&env.LLM_PROVIDER!=='openai-compatible')throw new LlmError('configuration');
  return createLlmClient({apiKey:env.LLM_API_KEY,model:env.LLM_MODEL||'deepseek-v4-flash',baseUrl:env.LLM_BASE_URL||'https://llm.ai.hy.miwork.ai',chatPath:env.LLM_CHAT_PATH||'chat/completions',...options});
}
