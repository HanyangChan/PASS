// Deterministic contract demo; no real model or keys required. For provider testing use smoke:full-chat.
import { createAgent } from './index.mjs';
import { createSession } from '../../src/index.mjs';
import { products } from '../../examples/catalog.mjs';
const actions=[{action:'update_conditions',patch:{recipients:['어머니'],budget:{amount_krw:50000,shipping_included:true}}},{action:'respond',type:'result'},{action:'compare_budget',amount_krw:70000},{action:'respond',type:'result'}];
const agent=createAgent({decide:async()=>actions.shift()});
const initial=createSession('demo');initial.state.quantity=1;initial.state.same_product=true;initial.state.budget.scope='per_set';
const first=await agent.runTurn({session:initial,products,request:{kind:'message',text:'엄마 예산 5만원 배송비 포함',expectedVersion:0}});
const comparison=await agent.runTurn({session:first.session,products,request:{kind:'message',text:'예산 7만원이면?',expectedVersion:first.session.version}});
console.log(JSON.stringify({demo:'mock decisions; shared real engine',first,comparison},null,2));
