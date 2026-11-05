import test from 'node:test';
import assert from 'node:assert/strict';
import {compatibleTurn,completionUrl} from '../lib/openai-compatible.mjs';
import {resolveLlm} from '../lib/llm-provider.mjs';
import {singleInitial} from '../lib/single-gift.mjs';
import {products} from '../baseline/examples/catalog.mjs';
const input=()=>({text:'차를 좋아하는 엄마 선물',state:{...singleInitial(),recipients:['어머니'],budget:{amount_krw:50000,shipping_included:true}},issues:[],history:[],source:'typed'});
const parsed=()=>({state:{...input().state,preferences:['category:coffee_tea']},question:null});
const envelope=(value=parsed(),extra={})=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value),reasoning_content:'private reasoning'}}],usage:{prompt_tokens:100,completion_tokens:50,total_tokens:150},...extra});
const opts=(fetcher,extra={})=>({apiKey:'test-key',fetcher,...extra});

test('platform transport sends Bearer auth, selected model and JSON schema guidance',async()=>{
 let usage;
 const before=input(),snapshot=structuredClone(before);
 const turn=await compatibleTurn(before,products,opts(async(url,options)=>{
  assert.equal(url,'https://llm.ai.hy.miwork.ai/chat/completions');assert.equal(options.redirect,'error');
  assert.equal(options.headers.Authorization,'Bearer test-key');assert.ok(!('x-goog-api-key' in options.headers));
  const payload=JSON.parse(options.body);assert.equal(payload.model,'deepseek-v4-flash');assert.deepEqual(payload.response_format,{type:'json_object'});assert.equal(payload.stream,false);
  assert.match(payload.messages[0].content,/JSON/);assert.match(payload.messages[0].content,/excluded_ingredients/);
  assert.ok(!options.body.includes('test-key'));return Response.json(envelope());
 },{onUsage:value=>{usage=value;}}));
 assert.deepEqual(before,snapshot);assert.deepEqual(turn.session.state.preferences,['category:coffee_tea']);assert.equal(usage.total_tokens,150);assert.ok(!JSON.stringify(turn).includes('private reasoning'));
});

test('base paths and response formats are explicit without automatic endpoint retries',async()=>{
 assert.equal(completionUrl('https://example.com/v1/'),'https://example.com/v1/chat/completions');
 assert.equal(completionUrl('https://example.com','/v1/chat/completions'),'https://example.com/v1/chat/completions');
 for(const mode of ['text','json_schema']) await compatibleTurn(input(),products,opts(async(_,options)=>{
  const payload=JSON.parse(options.body);
  if(mode==='text')assert.ok(!('response_format' in payload));else assert.equal(payload.response_format.json_schema.strict,true);
  return Response.json(envelope());
 },{responseFormat:mode}));
});

test('malformed, truncated, refused and invalid structured output never updates input',async()=>{
 const cases=[
  {choices:[{finish_reason:'length',message:{content:JSON.stringify(parsed())}}]},
  {choices:[{finish_reason:'stop',message:{content:'```json\n{}\n```'}}]},
  {choices:[{finish_reason:'stop',message:{content:null,reasoning_content:'reasoning only'}}]},
  {choices:[{finish_reason:'stop',message:{content:JSON.stringify(parsed()),tool_calls:[{}]}}]},
  envelope({state:{...parsed().state,budget:{amount_krw:-1,shipping_included:true}},question:null}),
  envelope({state:{...parsed().state,preferences:['invented']},question:null}),
  envelope({state:parsed().state,question:null,extra:true}),
 ];
 const before=input(),snapshot=structuredClone(before);
 for(const data of cases) await assert.rejects(compatibleTurn(before,products,opts(async()=>Response.json(data))),{code:'invalid_response'});
 assert.deepEqual(before,snapshot);
});

test('transient server errors retry once using the same deadline',async()=>{
 let calls=0,signal;
 await compatibleTurn(input(),products,opts(async(_,options)=>{
  if(!signal)signal=options.signal;else assert.equal(options.signal,signal);
  return ++calls===1?new Response('unavailable',{status:503}):Response.json(envelope());
 }));assert.equal(calls,2);
 let failures=0;
 await assert.rejects(compatibleTurn(input(),products,opts(async()=>{failures++;return new Response('raw private details',{status:503});})),{code:'provider_unavailable',status:503});assert.equal(failures,2);
});

test('auth, quota and request errors are sanitized and never retried',async()=>{
 for(const [status,code] of [[401,'auth_failed'],[429,'quota_exceeded'],[404,'endpoint_or_model_not_found'],[400,'request_rejected']]) {
  let calls=0;
  await assert.rejects(compatibleTurn(input(),products,opts(async()=>{calls++;return new Response('test-key raw input',{status});})),error=>error.code===code&&!String(error).includes('test-key'));
  assert.equal(calls,1);
 }
 await assert.rejects(compatibleTurn(input(),products,opts(async()=>{throw Error('test-key transport details');})),{code:'network_error'});
});

test('invalid endpoints and missing keys fail before transmission',async()=>{
 for(const baseUrl of ['http://external.example','https://user:secret@example.com','https://example.com?key=secret','https://example.com/#fragment']) await assert.rejects(compatibleTurn(input(),products,opts(()=>{throw Error('unexpected');},{baseUrl})),{code:'configuration'});
 await assert.rejects(compatibleTurn(input(),products,{apiKey:''}),{code:'configuration'});
 assert.throws(()=>completionUrl('https://example.com','../other'),{code:'configuration'});
});

test('provider selection never substitutes Gemini credentials for the platform key',()=>{
 const selected=resolveLlm({LLM_PROVIDER:'openai-compatible',GEMINI_API_KEY:'gemini-only'});
 assert.equal(selected.provider,'openai-compatible');assert.equal(selected.options.apiKey,undefined);assert.equal(selected.options.model,'deepseek-v4-flash');
 const gemini=resolveLlm({GEMINI_API_KEY:'gemini-only'});assert.equal(gemini.provider,'gemini');assert.equal(gemini.options.apiKey,'gemini-only');
 assert.throws(()=>resolveLlm({LLM_PROVIDER:'unknown'}),{code:'configuration'});
});

test('unmentioned allergen exclusions remain unless caller delegates protection to Router',async()=>{
 const before=input();before.state.excluded_ingredients=['우유'];
 const standard=await compatibleTurn(before,products,opts(async()=>Response.json(envelope())));assert.deepEqual(standard.session.state.excluded_ingredients,['우유']);
 const delegated=await compatibleTurn(before,products,opts(async()=>Response.json(envelope()),{retainAllergens:false}));assert.deepEqual(delegated.session.state.excluded_ingredients,[]);
});
