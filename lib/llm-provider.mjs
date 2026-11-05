import { llmTurn } from './llm.mjs';
import { compatibleTurn, completionUrl, CompatibleLlmError } from './openai-compatible.mjs';

export function resolveLlm(env, {extract,fetcher=fetch}={}) {
  const provider=env.LLM_PROVIDER || 'gemini';
  if (provider==='gemini') return {provider,extract:extract??llmTurn,options:{apiKey:env.GEMINI_API_KEY,model:env.GEMINI_MODEL||'gemini-3.6-flash',fetcher}};
  if (provider!=='openai-compatible') throw new CompatibleLlmError('configuration');
  const baseUrl=env.LLM_BASE_URL||'https://llm.ai.hy.miwork.ai';
  const chatPath=env.LLM_CHAT_PATH||'chat/completions';
  const responseFormat=env.LLM_RESPONSE_FORMAT||'json_object';
  completionUrl(baseUrl,chatPath);
  if (!['json_object','json_schema','text'].includes(responseFormat)) throw new CompatibleLlmError('configuration');
  return {provider,extract:extract??compatibleTurn,options:{apiKey:env.LLM_API_KEY,model:env.LLM_MODEL||'deepseek-v4-flash',baseUrl,chatPath,responseFormat,fetcher}};
}
