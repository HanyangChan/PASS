import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubagentInterpreter } from '../subagents/interpreter.mjs';
import { createAgent } from '../index.mjs';
import { createSession } from '../../../src/index.mjs';
import { products } from '../../../examples/catalog.mjs';
import { text, analysis, observation, makeFetcher } from './subagent-fixtures.mjs';
const state=()=>({...createSession('subagents').state,recipients:['어머니'],quantity:1,same_product:true,budget:{amount_krw:50000,scope:'per_set',shipping_included:true}});
const input=()=>({text,state:state(),history:[],stateVersion:3});
const make=(mock,extra={})=>createSubagentInterpreter({llmOptions:{apiKey:'test-key',fetcher:mock.fetcher},...extra});

test('Supervisor, four specialists and synthesizer execute six bounded grounded calls',async()=>{
 const mock=makeFetcher({roles:['recipient','occasion','spending','taste']});
 const before=input(),snapshot=structuredClone(before);
 const out=await make(mock)(before);
 assert.deepEqual(before,snapshot);assert.equal(out.unresolved,false);assert.deepEqual(out.patch.preferences,['category:coffee_tea']);assert.deepEqual(out.patch.excluded_ingredients,['우유']);assert.equal(out.patch.occasion,'생일');
 assert.equal(mock.calls.length,6);assert.equal(out.diagnostics.logicalCalls,6);assert.equal(out.diagnostics.httpAttempts,6);assert.equal(out.diagnostics.stateVersion,3);assert.ok(out.diagnostics.stages.every(s=>s.status==='passed'));assert.ok(!JSON.stringify(out.diagnostics).includes('test-key'));assert.ok(!JSON.stringify(out.diagnostics).includes(text));
});

test('unselected roles are not invoked and selected specialists run in parallel',async()=>{
 let started=0,release;const barrier=new Promise(resolve=>{release=resolve;});
 const mock=makeFetcher({roles:['occasion','taste'],onStage:async(stage)=>{if(['occasion','taste'].includes(stage)){if(++started===2)release();await barrier;}}});
 const out=await make(mock,{limits:{totalMs:500,supervisorMs:100,specialistsMs:200,synthesizerMs:100}})(input());
 assert.deepEqual(mock.calls,['supervisor','occasion','taste','synthesizer']);assert.equal(out.diagnostics.logicalCalls,4);
});

test('zero selected roles produce one question without expert or synthesis calls',async()=>{
 const mock=makeFetcher({override:stage=>stage==='supervisor'?{tasks:[],question:'원하시는 조건을 알려주세요.'}:undefined});
 const out=await make(mock)(input());assert.equal(out.unresolved,true);assert.deepEqual(out.patch,{});assert.equal(out.questions.length,1);assert.deepEqual(mock.calls,['supervisor']);
});

test('invalid role, duplicate role and invented selection evidence stop before specialists',async()=>{
 for(const tasks of [
  [{agentId:'hacker',task:'x',evidenceRefs:[{sourceId:'current',quote:'어머니'}]}],
  ...[true,false].map(duplicate=>duplicate?[0,1].map(()=>({agentId:'taste',task:'x',evidenceRefs:[{sourceId:'current',quote:'어머니'}]})):[{agentId:'taste',task:'x',evidenceRefs:[{sourceId:'current',quote:'invented'}]}]),
 ]) {
  const mock=makeFetcher({override:stage=>stage==='supervisor'?{tasks,question:null}:undefined});
  await assert.rejects(make(mock)(input()),error=>error.diagnostics.logicalCalls===1&&error.diagnostics.stages[0].status==='failed');assert.equal(mock.calls.length,1);
 }
});

test('wrong field owner, unknown enums and fabricated quotes cannot become conditions',async()=>{
 for(const o of [observation('budget.amount_krw',1,'차를 좋아'),observation('preferences',['invented'],'차를 좋아'),observation('preferences',['category:coffee_tea'],'invented quote')]) {
  const mock=makeFetcher({override:stage=>stage==='taste'?analysis('taste',[o]):undefined});
  await assert.rejects(make(mock)(input()),error=>error.diagnostics.logicalCalls===2);assert.ok(!mock.calls.includes('synthesizer'));
 }
});

test('giver or tentative tastes become a clarification with no partial patch',async()=>{
 for(const [subject,certainty] of [['giver','explicit'],['recipient','tentative'],['unknown','explicit']]) {
  const mock=makeFetcher({override:stage=>stage==='taste'?analysis('taste',[observation('preferences',['category:coffee_tea'],'차를 좋아',subject,certainty)]):undefined});
  const out=await make(mock)(input());assert.equal(out.unresolved,true);assert.deepEqual(out.patch,{});assert.equal(out.questions.length,1);
 }
});

test('synthesis cannot add unsupported facts or drop an explicit hard constraint',async()=>{
 for(const patch of [{preferences:['category:coffee_tea']},{budget:{amount_krw:1}},{}]) {
  const mock=makeFetcher({override:stage=>stage==='synthesizer'?{patch,questions:[],unresolved:false}:undefined});
  await assert.rejects(make(mock)(input()),error=>error.diagnostics.logicalCalls===3&&error.diagnostics.stages.at(-1).status==='failed');
 }
});

test('known exclusions are retained, but a recipient change does not copy old arrays',async()=>{
 const before=input();before.state.excluded_ingredients=['견과류'];before.state.preferences=['less_sweet'];
 const same=await make(makeFetcher())(before);assert.deepEqual(same.patch.excluded_ingredients,['견과류','우유']);assert.deepEqual(same.patch.preferences,['less_sweet','category:coffee_tea']);
 const changed=makeFetcher({roles:['recipient','taste'],override:stage=>stage==='recipient'?analysis('recipient',[observation('recipients',['친구'],'친구')]):undefined});
 const other=await make(changed)({...before,text:'친구 '+text});assert.deepEqual(other.patch.excluded_ingredients,['우유']);assert.deepEqual(other.patch.preferences,['category:coffee_tea']);
});

test('one failed expert cancels peers and never falls back to a single interpreter',async()=>{
 const mock=makeFetcher({roles:['occasion','taste'],override:async(stage,_,options)=>{
  if(stage==='occasion')return new Response('raw secret error',{status:401});
  if(stage==='taste')return new Promise((_,reject)=>{if(options.signal.aborted)reject(Error());else options.signal.addEventListener('abort',()=>reject(Error()),{once:true});});
 }});
 await assert.rejects(make(mock)(input()),error=>{assert.ok(!String(error).includes('secret'));assert.equal(error.diagnostics.logicalCalls,3);assert.ok(error.diagnostics.stages.some(s=>s.status==='failed'));return true;});
 assert.ok(!mock.calls.includes('synthesizer'));
});

test('stage timeout and parent cancellation preserve input and bounded diagnostics',async()=>{
 const hanging={fetcher:()=>new Promise(()=>{})};
 const before=input(),snapshot=structuredClone(before);
 await assert.rejects(make(hanging,{limits:{totalMs:50,supervisorMs:5}})(before),error=>error.code==='stage_timeout'&&error.diagnostics.logicalCalls===1);
 assert.deepEqual(before,snapshot);
 const controller=new AbortController();const pending=make(hanging,{limits:{supervisorMs:15}})( {...before,signal:controller.signal});controller.abort();
 await assert.rejects(pending,error=>error.code==='aborted'&&error.diagnostics.logicalCalls===1);
 const stopped=new AbortController();stopped.abort();await assert.rejects(make(hanging)({...before,signal:stopped.signal}),error=>error.diagnostics.logicalCalls===0);
});

test('concurrent requests have independent state snapshots and run counters',async()=>{
 const mock=makeFetcher();const interpret=make(mock);
 const [a,b]=await Promise.all([interpret(input()),interpret({...input(),stateVersion:4})]);
 assert.notEqual(a.diagnostics.runId,b.diagnostics.runId);assert.equal(a.diagnostics.logicalCalls,3);assert.equal(b.diagnostics.logicalCalls,3);assert.equal(a.diagnostics.stateVersion,3);assert.equal(b.diagnostics.stateVersion,4);
});

test('a-router still uses zero calls on rules and exposes real subagent call counts on fallback',async()=>{
 const mock=makeFetcher();const agent=createAgent({interpret:make(mock),singleGift:true});
 const session={...createSession('router'),state:state()};
 const clear=await agent.runTurn({session,products,request:{kind:'message',text:'예산 7만원으로 바꿔줘',expectedVersion:0}});assert.equal(mock.calls.length,0);assert.equal(clear.routing.llmCalls,0);
 const out=await agent.runTurn({session,products,request:{kind:'message',text,expectedVersion:0}});assert.equal(out.routing.llmCalls,3);assert.equal(out.routing.subagents.httpAttempts,3);assert.equal(out.routing.subagents.stages.at(-1).agentId,'synthesizer');
});

test('role selection and evidence cannot invent recipients, budget amounts or relative dates',async()=>{
 for(const [role,o] of [['recipient',observation('recipients',['친구'],'어머니')],['spending',observation('budget.amount_krw',100000,'5만원','giver')],['occasion',observation('delivery_by','2026-12-01','생일')]]) {
  const mock=makeFetcher({roles:[role],override:stage=>stage===role?analysis(role,[o]):undefined});
  await assert.rejects(make(mock)(input()),error=>error.diagnostics.logicalCalls===2);
 }
});

test('5xx retry counts HTTP attempts separately from logical subagent calls',async()=>{
 const basic=makeFetcher();let once=true;
 const fetcher=async(url,options)=>{if(once){once=false;return new Response('temporary',{status:503});}return basic.fetcher(url,options);};
 const out=await make({fetcher})(input());assert.equal(out.diagnostics.logicalCalls,3);assert.equal(out.diagnostics.httpAttempts,4);
});

test('omitting a known explicit ingredient avoidance forces clarification instead of an unsafe recommendation',async()=>{
 const mock=makeFetcher({override:stage=>stage==='taste'?analysis('taste',[observation('preferences',['category:coffee_tea'],'차를 좋아')]):undefined});
 const out=await make(mock)(input());assert.equal(out.unresolved,true);assert.deepEqual(out.patch,{});assert.match(out.questions[0],/우유/);
});

test('DeepSeek stages explicitly disable gateway reasoning without changing other models',async()=>{
 for(const model of ['deepseek-v4-flash','other-model']) {
  const mock=makeFetcher({onStage:(_,__,options)=>{
   const payload=JSON.parse(options.body);
   if(model.startsWith('deepseek'))assert.deepEqual(payload.reasoning,{enabled:false});else assert.ok(!('reasoning' in payload));
  }});
  const out=await createSubagentInterpreter({llmOptions:{apiKey:'test-key',model,fetcher:mock.fetcher}})(input());assert.equal(out.diagnostics.logicalCalls,3);
 }
});

test('relative holiday dates are clarified and cross-agent ownership conflicts do not apply conditions',async()=>{
 const pending=makeFetcher({roles:['occasion'],override:stage=>stage==='occasion'?{...analysis('occasion'),status:'needs_clarification',questions:['수령 마감일을 실제 날짜로 알려주세요.']}:undefined});
 const question=await make(pending)(input());assert.equal(question.unresolved,true);assert.deepEqual(question.patch,{});assert.equal(question.questions.length,1);
 const conflict=makeFetcher({roles:['recipient','taste'],override:stage=>stage==='recipient'?{...analysis('recipient'),attributions:[{subject:'giver',evidenceRefs:[{sourceId:'current',quote:'차를 좋아'}]}]}:undefined});
 const ownership=await make(conflict)(input());assert.equal(ownership.unresolved,true);assert.deepEqual(ownership.patch,{});
});

test('a canceled Router request cannot apply a late interpreter result',async()=>{
 const session={...createSession('late'),state:state()},before=structuredClone(session);const controller=new AbortController();
 const agent=createAgent({interpret:async()=>{await new Promise(resolve=>setTimeout(resolve,20));return {patch:{budget:{amount_krw:1}},questions:[],unresolved:false};}});
 const pending=agent.runTurn({session,products,signal:controller.signal,request:{kind:'message',text:'센스 있는 선물',expectedVersion:0}});
 await new Promise(resolve=>setTimeout(resolve,1));controller.abort();
 const out=await pending;assert.equal(out.kind,'question');assert.equal(out.routing.route,'llm_error');
 await new Promise(resolve=>setTimeout(resolve,25));assert.deepEqual(session,before);assert.deepEqual(out.session,before);
});

test('typed tea preference survives specialist validation and synthesis without losing exclusions',async()=>{
 const mock=makeFetcher({override:stage=>stage==='taste'?analysis('taste',[
  observation('preferences',['category:coffee_tea','type:tea'],'차를 좋아'),
  observation('excluded_ingredients',['우유'],'우유는 피해요'),
 ]):undefined});
 const out=await make(mock)(input());
 assert.equal(out.unresolved,false);assert.deepEqual(out.patch.preferences,['category:coffee_tea','type:tea']);assert.deepEqual(out.patch.excluded_ingredients,['우유']);
});
