import {createLlmFromEnv} from '../index.mjs';
try {
  const llm=createLlmFromEnv(process.env);
  if(!llm.configured)throw Object.assign(Error(),{code:'configuration'});
  const started=Date.now();
  const result=await llm.completeJson({messages:[
    {role:'system',content:'Return only a JSON object with a boolean field ok. No markdown.'},
    {role:'user',content:'Reply with {"ok":true} to confirm the connection.'},
  ],maxTokens:128,validate:data=>data?.ok===true});
  console.log(JSON.stringify({ok:true,provider:result.provider,model:result.model,latencyMs:Date.now()-started,usage:result.usage},null,2));
} catch(error) {
  console.error(JSON.stringify({ok:false,code:error?.name==='LlmError'?error.code:'request_failed',status:Number.isInteger(error?.status)?error.status:0}));
  process.exitCode=1;
}
