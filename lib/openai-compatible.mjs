import { extractionInstructions, extractionSchema, validateRequest, validate, validateState } from './llm.mjs';
import { finishSingle } from './single-gift.mjs';

export class CompatibleLlmError extends Error {
  constructor(code, status=0) { super(code); this.name='CompatibleLlmError'; this.code=code; this.status=status; }
}
export function completionUrl(baseUrl, chatPath='chat/completions') {
  let url;
  try { url=new URL(baseUrl); } catch { throw new CompatibleLlmError('configuration'); }
  if (url.username || url.password || url.search || url.hash || (url.protocol!=='https:' && !(url.protocol==='http:' && ['localhost','127.0.0.1'].includes(url.hostname)))) throw new CompatibleLlmError('configuration');
  const path=chatPath.replace(/^\/+/, '');
  if (!['chat/completions','v1/chat/completions'].includes(path)) throw new CompatibleLlmError('configuration');
  return `${url.href.replace(/\/$/,'')}/${path}`;
}
export async function compatibleTurn(body, products, {
  apiKey, model='deepseek-v4-flash', baseUrl='https://llm.ai.hy.miwork.ai', chatPath='chat/completions',
  responseFormat='json_object', fetcher=fetch, additionalInstructions='', retainAllergens=true, onUsage,
}={}) {
  const input=validateRequest(body);
  if (typeof apiKey!=='string'||!apiKey.trim()||typeof model!=='string'||!model.trim()||!['json_object','json_schema','text'].includes(responseFormat)) throw new CompatibleLlmError('configuration');
  const url=completionUrl(baseUrl,chatPath);
  const payload={
    model, stream:false, temperature:0, max_tokens:1600,
    messages:[
      {role:'system',content:`${extractionInstructions(additionalInstructions)}\nReturn a JSON object matching this schema exactly, without markdown or extra keys:\n${JSON.stringify(extractionSchema)}`},
      {role:'user',content:JSON.stringify(input)},
    ],
  };
  if (responseFormat==='json_object') payload.response_format={type:'json_object'};
  if (responseFormat==='json_schema') payload.response_format={type:'json_schema',json_schema:{name:'gift_conditions',strict:true,schema:extractionSchema}};
  const options={method:'POST',redirect:'error',headers:{Authorization:`Bearer ${apiKey}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(18000),body:JSON.stringify(payload)};
  let response;
  try {
    response=await fetcher(url,options);
    if ([500,502,503,504].includes(response.status)) { await response.body?.cancel(); response=await fetcher(url,options); }
  } catch (error) {
    throw new CompatibleLlmError(['TimeoutError','AbortError'].includes(error?.name)?'timeout':'network_error');
  }
  if (!response.ok) {
    await response.body?.cancel();
    const code=response.status===401||response.status===403?'auth_failed':response.status===429?'quota_exceeded':response.status===404?'endpoint_or_model_not_found':response.status>=500?'provider_unavailable':'request_rejected';
    throw new CompatibleLlmError(code,response.status);
  }
  let data,parsed;
  try {
    data=await response.json();
    const choice=data.choices?.[0];
    if (!choice || (choice.finish_reason!==undefined && choice.finish_reason!=='stop') || choice.message?.tool_calls?.length || typeof choice.message?.content!=='string' || !choice.message.content.trim() || choice.message.content.length>16000) throw Error();
    parsed=JSON.parse(choice.message.content);
    validate(parsed,extractionSchema);validateState(parsed.state);
  } catch { throw new CompatibleLlmError('invalid_response'); }
  if (retainAllergens && !/알레르기.*(?:없|해제|취소)|성분.*(?:해제|취소)/.test(input.text)) parsed.state.excluded_ingredients=[...new Set([...input.state.excluded_ingredients,...parsed.state.excluded_ingredients])];
  const usage={};
  for (const key of ['prompt_tokens','completion_tokens','total_tokens']) if (Number.isSafeInteger(data.usage?.[key]) && data.usage[key]>=0) usage[key]=data.usage[key];
  onUsage?.({provider:'openai-compatible',model,...usage});
  return {...finishSingle(input.state,parsed.state,parsed.question?[parsed.question]:[],products),usage};
}
