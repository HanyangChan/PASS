import test from 'node:test';
import assert from 'node:assert/strict';
import {checkGeminiResponse,geminiFailure,llmTurn} from '../lib/llm.mjs';
import {singleInitial} from '../lib/single-gift.mjs';
test('upstream failures are classified without retaining credentials or request data',async()=>{
 for(const [status,message,expected] of [[403,'Your API key SECRET was reported as leaked','key_blocked'],[400,'API key expired SECRET','key_expired'],[429,'quota SECRET','quota_exceeded'],[404,'unknown model SECRET','model_not_found'],[503,'SECRET','provider_unavailable']]){
  try{await checkGeminiResponse(Response.json({error:{message}},{status}));assert.fail('must reject');}catch(error){const result=geminiFailure(error);assert.equal(result.code,expected);assert.equal(result.upstreamStatus,status);assert.ok(!JSON.stringify(result).includes('SECRET'));assert.ok(!error.message.includes('SECRET'));}
 }
 assert.equal(geminiFailure(new DOMException('secret','TimeoutError')).code,'timeout');
});
test('Gemini thought parts are ignored while split answer text is assembled',async()=>{
 const state=singleInitial();const payload=JSON.stringify({state,question:null});
 const r=await llmTurn({state,issues:[],history:[],text:'도와줘'},[],{apiKey:'test',fetcher:async()=>Response.json({candidates:[{content:{parts:[{thought:true,text:'private reasoning'},{text:payload.slice(0,30)},{text:payload.slice(30)}]}}]})});
 assert.deepEqual(r.session.state,state);
});
test('one transient retry shares its deadline, while auth and quota failures are not retried',async()=>{
 const state=singleInitial(),input={state,issues:[],history:[],text:'도와줘'};
 let calls=0,signal;
 await llmTurn(input,[],{apiKey:'test',fetcher:async(url,options)=>{calls++;if(calls===1){signal=options.signal;return Response.json({error:{message:'unavailable'}},{status:503});}assert.equal(options.signal,signal);return Response.json({candidates:[{content:{parts:[{text:JSON.stringify({state,question:null})}]}}]});}});
 assert.equal(calls,2);
 for(const status of [403,429,503]){calls=0;await assert.rejects(()=>llmTurn(input,[],{apiKey:'test',fetcher:async()=>{calls++;return Response.json({error:{message:'unavailable'}},{status});}}));assert.equal(calls,status===503?2:1);}
});
