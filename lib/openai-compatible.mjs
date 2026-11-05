// Gift-specific adapter over the shared, domain-independent LLM base.
import { createLlmClient, LlmError } from '../baseline/llm/index.mjs';
import { extractionInstructions, extractionSchema, validateRequest, validate, validateState } from './llm.mjs';
import { finishSingle } from './single-gift.mjs';
export { LlmError as CompatibleLlmError, completionUrl } from '../baseline/llm/index.mjs';

export async function compatibleTurn(body, products, {
  apiKey, model='deepseek-v4-flash', baseUrl='https://llm.ai.hy.miwork.ai', chatPath='chat/completions',
  responseFormat='json_object', fetcher=fetch, additionalInstructions='', retainAllergens=true, onUsage,
}={}) {
  const input=validateRequest(body);
  const client=createLlmClient({apiKey,model,baseUrl,chatPath,fetcher,onUsage});
  const result=await client.completeJson({
    messages:[
      {role:'system',content:`${extractionInstructions(additionalInstructions)}\nReturn a JSON object matching this schema exactly, without markdown or extra keys:\n${JSON.stringify(extractionSchema)}`},
      {role:'user',content:JSON.stringify(input)},
    ],
    responseFormat,schema:extractionSchema,schemaName:'gift_conditions',maxTokens:1600,
    validate:parsed=>{validate(parsed,extractionSchema);validateState(parsed.state);},
  });
  if(result.text.length>16000)throw new LlmError('invalid_response');
  const parsed=result.data;
  if (retainAllergens && !/알레르기.*(?:없|해제|취소)|성분.*(?:해제|취소)/.test(input.text)) parsed.state.excluded_ingredients=[...new Set([...input.state.excluded_ingredients,...parsed.state.excluded_ingredients])];
  return {...finishSingle(input.state,parsed.state,parsed.question?[parsed.question]:[],products),usage:result.usage};
}
