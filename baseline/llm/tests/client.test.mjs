import test from 'node:test';
import assert from 'node:assert/strict';
import {createLlmClient,createLlmFromEnv,completionUrl} from '../index.mjs';
const messages=[{role:'system',content:'Your own prompt.'},{role:'user',content:'Hello'}];
const reply=(text='Hello',extra={})=>Response.json({choices:[{finish_reason:'stop',message:{content:text,reasoning_content:'hidden reasoning'}}],usage:{prompt_tokens:10,completion_tokens:5,total_tokens:15},...extra});

test('GPT-5.6 Luna maps thinking controls to native OpenAI options without changing other models',async()=>{
 const seen=[];
 const client=createLlmClient({apiKey:'test-key',model:'gpt-5.6-luna',fetcher:async(_,options)=>{seen.push(JSON.parse(options.body));return reply();}});
 await client.complete({messages,reasoningEnabled:false,maxTokens:900});
 await client.complete({messages,reasoningEnabled:true});
 await client.complete({messages,reasoningEffort:'low'});
 assert.equal(seen[0].reasoning_effort,'none');assert.equal(seen[0].temperature,0);assert.equal(seen[0].max_completion_tokens,900);
 assert.ok(!('reasoning' in seen[0]));assert.ok(!('max_tokens' in seen[0]));
 assert.equal(seen[1].reasoning_effort,'medium');assert.ok(!('temperature' in seen[1]));
 assert.equal(seen[2].reasoning_effort,'low');assert.ok(!('temperature' in seen[2]));
});

test('generic completion sends caller messages without gift or Router dependencies',async()=>{
 let usage;
 const client=createLlmClient({apiKey:'test-key',onUsage:v=>{usage=v;},fetcher:async(url,options)=>{
  assert.equal(url,'https://llm.ai.hy.miwork.ai/chat/completions');assert.equal(options.headers.Authorization,'Bearer test-key');assert.equal(options.redirect,'error');
  const body=JSON.parse(options.body);assert.deepEqual(body.messages,messages);assert.equal(body.model,'deepseek-v4-flash');assert.ok(!('response_format' in body));assert.ok(!options.body.includes('gift'));return reply();
 }});
 const result=await client.complete({messages});assert.equal(result.text,'Hello');assert.equal(usage.total_tokens,15);assert.ok(!JSON.stringify(result).includes('hidden reasoning'));assert.ok(!JSON.stringify(client).includes('test-key'));
});

test('JSON decoding and caller-defined sync or async validation are independent of any domain',async()=>{
 const client=createLlmClient({apiKey:'test-key',fetcher:async(_,options)=>{assert.equal(JSON.parse(options.body).response_format.type,'json_object');return reply('{"intent":"custom"}');}});
 const result=await client.completeJson({messages,validate:data=>typeof data.intent==='string'});assert.equal(result.data.intent,'custom');
 await assert.rejects(client.completeJson({messages,validate:()=>false}),{code:'invalid_response'});
 await assert.rejects(client.completeJson({messages,validate:async()=>false}),{code:'invalid_response'});
 await assert.rejects(createLlmClient({apiKey:'test-key',fetcher:async()=>reply('not-json')}).completeJson({messages}),{code:'invalid_response'});
});

test('custom model, base URL and strict JSON schema are caller options',async()=>{
 const client=createLlmFromEnv({LLM_MODEL:'another-model',LLM_BASE_URL:'https://example.com/v1',LLM_API_KEY:'test-key'},{fetcher:async(url,options)=>{
  assert.equal(url,'https://example.com/v1/chat/completions');const body=JSON.parse(options.body);assert.equal(body.model,'another-model');assert.equal(body.response_format.json_schema.name,'custom');assert.deepEqual(body.response_format.json_schema.schema,{type:'object'});return reply('{}');
 }});
 await client.completeJson({messages,responseFormat:'json_schema',schema:{type:'object'},schemaName:'custom'});
 assert.equal(completionUrl('https://example.com/','/v1/chat/completions'),'https://example.com/v1/chat/completions');
});

test('5xx retries at most once with the same deadline; 401 and 429 never retry',async()=>{
 let calls=0,signal;
 const client=createLlmClient({apiKey:'test-key',fetcher:async(_,options)=>{
  if(signal)assert.equal(signal,options.signal);signal=options.signal;
  return ++calls===1?new Response('temporary',{status:503}):reply();
 }});
 await client.complete({messages});assert.equal(calls,2);
 for(const [status,code] of [[401,'auth_failed'],[429,'quota_exceeded'],[400,'request_rejected'],[404,'endpoint_or_model_not_found']]) {
  let count=0;
  await assert.rejects(createLlmClient({apiKey:'test-key',fetcher:async()=>{count++;return new Response('raw credentials',{status});}}).complete({messages}),error=>error.code===code&&!String(error).includes('raw credentials'));
  assert.equal(count,1);
 }
});

test('timeouts and caller cancellation abort transport without leaking raw errors',async()=>{
 const fetcher=(_,options)=>new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('raw private message')),{once:true}));
 await assert.rejects(createLlmClient({apiKey:'test-key',timeoutMs:5,fetcher}).complete({messages}),{code:'timeout'});
 const controller=new AbortController();
 const pending=createLlmClient({apiKey:'test-key',fetcher}).complete({messages,signal:controller.signal});controller.abort();
 await assert.rejects(pending,{code:'aborted'});
 await assert.rejects(createLlmClient({apiKey:'test-key'}).complete({messages,signal:controller.signal}),{code:'aborted'});
});

test('missing keys, invalid messages and unsafe URLs fail before transmission',async()=>{
 let calls=0;const client=createLlmFromEnv({},{fetcher:()=>{calls++;}});
 assert.equal(client.configured,false);await assert.rejects(client.complete({messages}),{code:'configuration'});assert.equal(calls,0);
 const configured=createLlmClient({apiKey:'test-key',fetcher:()=>{calls++;}});
 for(const request of [{messages:[]},{messages:[{role:'tool',content:'no'}]},{messages,maxTokens:0},{messages,responseFormat:'json_schema'},{messages,responseFormat:'unknown'}]) await assert.rejects(configured.complete(request),{code:'invalid_request'});
 assert.equal(calls,0);
 for(const baseUrl of ['http://external.example','https://user:key@example.com','https://example.com?key=x'])assert.throws(()=>createLlmClient({baseUrl}),{code:'configuration'});
 assert.throws(()=>createLlmFromEnv({LLM_PROVIDER:'gemini'}),{code:'configuration'});
});

test('truncated, tool-only and empty responses cannot masquerade as completed text',async()=>{
 for(const data of [{choices:[{finish_reason:'length',message:{content:'truncated'}}]},{choices:[{finish_reason:'stop',message:{content:'',reasoning_content:'reasoning'}}]},{choices:[{finish_reason:'stop',message:{content:'text',tool_calls:[{}]}}]}])await assert.rejects(createLlmClient({apiKey:'test-key',fetcher:async()=>Response.json(data)}).complete({messages}),{code:'invalid_response'});
});

test('reasoning effort is optional transport configuration and does not change defaults',async()=>{
 const seen=[];const client=createLlmClient({apiKey:'test-key',fetcher:async(_,options)=>{seen.push(JSON.parse(options.body));return reply();}});
 await client.complete({messages});await client.complete({messages,reasoningEffort:'none'});
 assert.ok(!('reasoning_effort' in seen[0]));assert.equal(seen[1].reasoning_effort,'none');
 await assert.rejects(client.complete({messages,reasoningEffort:'invalid'}),{code:'invalid_request'});
});

test('provider thinking switch is optional and validated without changing defaults',async()=>{
 const seen=[];const client=createLlmClient({apiKey:'test-key',fetcher:async(_,options)=>{seen.push(JSON.parse(options.body));return reply();}});
 await client.complete({messages});await client.complete({messages,reasoningEnabled:false});
 assert.ok(!('reasoning' in seen[0]));assert.deepEqual(seen[1].reasoning,{enabled:false});
 await assert.rejects(client.complete({messages,reasoningEnabled:'invalid'}),{code:'invalid_request'});
});
