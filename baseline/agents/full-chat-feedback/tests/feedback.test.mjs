import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgent, validReview } from '../index.mjs';
import { createSession } from '../../../src/index.mjs';
import { products } from '../../../examples/catalog.mjs';
const ready=()=>({...createSession('feedback'),state:{...createSession('feedback').state,recipients:['어머니'],quantity:1,same_product:true,budget:{amount_krw:50000,shipping_included:true,scope:'per_set'}}});
const run=(agent,extra={})=>agent.runTurn({session:ready(),products,request:{kind:'message',text:'조건을 수정해주세요',expectedVersion:0},...extra});
const pass={verdict:'pass',issues:[],feedback:''};
const revise=(issue,feedback)=>({verdict:'revise',issues:[issue],feedback});
const seq=actions=>async()=>{assert.ok(actions.length);return actions.shift();};
const finish={action:'respond',type:'result'};

test('review can reject an invented scent-category mapping and complete with a transparent limitation',async()=>{
 const session=ready();session.state.excluded_categories=['food','snack','coffee_tea','health'];
 const out=await run(createAgent({maxReviews:2,
   actor:seq([{action:'update_conditions',patch:{excluded_categories:[...session.state.excluded_categories,'beauty','decor']}},{action:'search_products'},{...finish,limitations:['scent_strength']}]),
   reviewer:seq([revise('unsupported_change','Scent strength is unavailable. Preserve categories, search and report the limitation.'),pass,pass]),
 }),{session,request:{kind:'message',text:'어',expectedVersion:0},pendingQuestion:'향이 강한 제품도 제외하고 추천할까요?'});
 assert.deepEqual(out.session,session);assert.deepEqual(out.limitations,['scent_strength']);assert.equal(out.routing.feedback.revisions,1);assert.equal(out.routing.stopReason,'complete');
});

test('an erroneous reviewer pass cannot approve a result before any current-turn tool',async()=>{
 const out=await run(createAgent({maxReviews:2,actor:seq([{...finish,limitations:['scent_strength']},{action:'search_products'},{...finish,limitations:['scent_strength']}]),reviewer:async()=>pass}));
 assert.equal(out.kind,'recommendation');assert.equal(out.routing.stopReason,'complete');
 assert.equal(out.routing.feedback.reviews[0].verdict,'revise');
 assert.deepEqual(out.routing.feedback.reviews[0].issues,['premature_finish']);
 assert.equal(out.routing.feedback.revisions,1);
});

test('a final unreviewed revision still cannot commit invented scent category exclusions',async()=>{
 const patch={action:'update_conditions',patch:{excluded_categories:['beauty','decor']}};
 const out=await run(createAgent({maxReviews:2,actor:seq([patch,patch,patch,{action:'search_products'},{...finish,limitations:['scent_strength']}]),reviewer:async()=>pass}),{request:{kind:'message',text:'향 강한 건 빼줘',expectedVersion:0}});
 assert.deepEqual(out.session,ready());assert.equal(out.routing.toolCalls,1);
 assert.equal(out.routing.feedback.revisions,2);assert.equal(out.routing.stopReason,'complete');
});

test('a search cannot be rejected as a repeated question or a premature response',async()=>{
 const out=await run(createAgent({actor:seq([{action:'search_products'},finish]),reviewer:seq([{verdict:'revise',issues:['unnecessary_question','premature_finish'],feedback:'Proceed with search_products.'},pass])}));
 assert.equal(out.routing.stopReason,'complete');assert.equal(out.routing.feedback.revisions,0);
});

test('ownership feedback returns to actor before executing unsupported patch',async()=>{
 const actor=seq([{action:'update_conditions',patch:{preferences:['type:coffee','category:coffee_tea']}},{action:'clarify',question:'받는 분의 취향인가요?'}]);
 const out=await run(createAgent({actor,reviewer:async()=>revise('ownership','Clarify the owner of this preference.')}));
 assert.equal(out.kind,'question');assert.deepEqual(out.session,ready());assert.equal(out.routing.llmCalls,3);assert.equal(out.routing.toolCalls,0);assert.equal(out.routing.feedback.revisions,1);
});

test('completion feedback repairs acknowledge after tools and preserves valid staged changes',async()=>{
 const seen=[];
 const actions=[{action:'update_conditions',patch:{budget:{amount_krw:70000}}},{action:'respond',type:'acknowledge'},finish];
 const out=await run(createAgent({actor:async input=>{seen.push(input);return actions.shift();},reviewer:seq([pass,revise('premature_finish','Use respond type=result for the existing tool observation.')])}));
 assert.equal(out.session.state.budget.amount_krw,70000);assert.equal(out.routing.llmCalls,5);assert.equal(out.routing.feedback.reviewCalls,2);assert.equal(out.routing.feedback.actorCalls,3);assert.ok(seen[2].validationFeedback);assert.equal(out.result.cards[0].id,'premium');
});

test('two-review mode rechecks a rejected revision, not a passing first action',async()=>{
 const actions=[{action:'update_conditions',patch:{delivery_by:'2026-02-30'}},{action:'clarify',question:'유효한 날짜를 알려주세요.'}];
 const out=await run(createAgent({maxReviews:2,actor:seq(actions),reviewer:seq([revise('invalid_value','Clarify an impossible date.'),pass])}));
 assert.equal(out.routing.llmCalls,4);assert.equal(out.routing.feedback.reviews[1].round,2);assert.equal(out.session.state.delivery_by,null);
 const normal=await run(createAgent({maxReviews:2,actor:seq([{action:'search_products'},finish]),reviewer:seq([pass,pass])}));
 assert.equal(normal.routing.llmCalls,4);assert.ok(normal.routing.feedback.reviews.every(r=>r.round===1));
});

test('shared actual-call budget rolls back rather than executing an unreviewed initial action',async()=>{
 const out=await run(createAgent({maxCalls:1,actor:seq([{action:'update_conditions',patch:{budget:{amount_krw:70000}}}]),reviewer:async()=>{throw Error('unexpected');}}));
 assert.equal(out.routing.llmCalls,1);assert.equal(out.routing.feedback.limitReached,true);assert.deepEqual(out.session,ready());assert.equal(out.kind,'question');
});

test('reviewer failure/malformed output cannot commit a staged patch or expose raw errors',async()=>{
 const actor=seq([{action:'update_conditions',patch:{budget:{amount_krw:70000}}},finish]);
 const reviewer=seq([pass,{verdict:'pass',issues:['private raw data'],feedback:'secret'}]);
 await assert.rejects(run(createAgent({actor,reviewer})),error=>error.routing.llmCalls===4&&!error.message.includes('secret'));
 assert.equal(validReview({verdict:'pass',issues:[],feedback:'unstructured reasoning'}),false);
});

test('whole deadline and caller cancellation include reviewer calls',async()=>{
 await assert.rejects(run(createAgent({timeoutMs:10,actor:async()=>({action:'search_products'}),reviewer:()=>new Promise(()=>{})})),e=>e.code==='timeout'&&e.routing.feedback.reviewCalls===1);
 const c=new AbortController();const pending=run(createAgent({actor:async()=>({action:'search_products'}),reviewer:()=>new Promise(()=>{})}),{signal:c.signal});setTimeout(()=>c.abort(),5);await assert.rejects(pending,e=>e.code==='aborted');
});

test('explicit host operations keep zero model calls',async()=>{
 const out=await run(createAgent({actor:async()=>{throw Error('unexpected');}}),{request:{kind:'patch',expectedVersion:0,patch:{budget:{amount_krw:70000}}}});
 assert.equal(out.session.state.budget.amount_krw,70000);assert.equal(out.routing.llmCalls,0);assert.equal(out.routing.agent,'full-chat-feedback-1');
});

test('multi-round revision still uses the same server date and state checks',async()=>{
 const out=await run(createAgent({maxReviews:2,actor:seq([{action:'update_conditions',patch:{delivery_by:'2026-02-30'}},{action:'update_conditions',patch:{delivery_by:'2026-02-31'}},{action:'clarify',question:'날짜를 확인해주세요.'}]),reviewer:seq([revise('invalid_value','Invalid date.'),revise('invalid_value','Still an invalid date.')])}));
 assert.equal(out.routing.llmCalls,5);assert.equal(out.routing.feedback.revisions,2);assert.deepEqual(out.session,ready());
});
