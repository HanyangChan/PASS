import test from 'node:test';
import assert from 'node:assert/strict';
import { agentIds, loadAgent } from '../agents/registry.mjs';
import { createAgentRunner } from '../agents/runtime.mjs';
import { createSession, runTurn } from '../src/index.mjs';
import { products } from '../examples/catalog.mjs';
const clearRequest = {kind:'message',expectedVersion:0,text:'어머니 한 세트 세트당 예산 5만원 이하 배송비 포함 추천'};
const ready = async () => (await runTurn({session:createSession('agents'),products,request:clearRequest})).session;

test('all agent workspaces preserve common ranking and skip extension for clear messages', async () => {
  const session=createSession('same');
  const expected=await runTurn({session,products,request:clearRequest});
  for (const id of agentIds) {
    let calls=0;
    const agent=loadAgent(id,{interpret:async()=>{calls++;throw Error('unexpected extension');}});
    const actual=await agent.runTurn({session,products,request:clearRequest});
    assert.deepEqual(actual.session,expected.session);assert.deepEqual(actual.result,expected.result);assert.equal(actual.kind,expected.kind);assert.equal(calls,0);
  }
});

test('unimplemented agent messages ask for clarification without changing state', async () => {
  const session=await ready(),before=structuredClone(session);
  for (const id of agentIds) {
    const out=await loadAgent(id).runTurn({session,products,request:{kind:'message',text:'센스 있는 선물',expectedVersion:session.version}});
    assert.equal(out.kind,'question');assert.deepEqual(out.session,before);assert.deepEqual(session,before);
  }
});

test('injected interpreters must pass common condition validation for every agent', async () => {
  const session=await ready();
  for (const id of agentIds) {
    const bad=loadAgent(id,{interpret:async()=>({patch:{budget:{amount_krw:-1}},questions:[],unresolved:false})});
    await assert.rejects(bad.runTurn({session,products,request:{kind:'message',text:'센스 있는 선물',expectedVersion:session.version}}),{code:'invalid_input'});
    const good=loadAgent(id,{interpret:async({state})=>{
      state.budget.amount_krw=1;
      return {patch:{preferences:['category:coffee_tea']},questions:[],unresolved:false};
    }});
    const out=await good.runTurn({session,products,request:{kind:'message',text:'센스 있는 선물',expectedVersion:session.version}});
    assert.equal(out.kind,'recommendation');assert.equal(out.session.state.budget.amount_krw,50000);
    assert.equal(session.state.preferences.length,0);
  }
});

test('agent comparison keeps the current budget and stale requests fail', async () => {
  const session=await ready();
  for (const id of agentIds) {
    const agent=loadAgent(id);
    const out=await agent.runTurn({session,products,request:{kind:'what_if_budget',amount_krw:70000,expectedVersion:session.version}});
    assert.equal(out.result.cards[0].id,'premium');assert.deepEqual(out.session,session);
    await assert.rejects(agent.runTurn({session,products,request:{kind:'view',expectedVersion:0}}),{code:'version_conflict'});
  }
});

test('agent selection uses registered names and requires callable interpreters', () => {
  assert.throws(()=>loadAgent('../src/index.mjs'),RangeError);
  assert.throws(()=>loadAgent('toString'),RangeError);
  assert.throws(()=>createAgentRunner({interpret:null}),TypeError);
});
