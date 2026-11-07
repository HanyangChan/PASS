import { createAgent } from './index.mjs';
import { createSession } from '../../src/index.mjs';
import { products } from '../../examples/catalog.mjs';
const session=createSession('feedback-demo');session.state={...session.state,recipients:['어머니'],quantity:1,same_product:true,budget:{amount_krw:50000,scope:'per_set',shipping_included:true}};
const actions=[{action:'update_conditions',patch:{preferences:['category:coffee_tea','type:coffee']}},{action:'clarify',question:'커피 취향은 받는 분의 취향인가요?'}];
const agent=createAgent({actor:async()=>actions.shift(),reviewer:async()=>({verdict:'revise',issues:['ownership'],feedback:'Do not apply giver preferences to the recipient; ask a clarification.'})});
const out=await agent.runTurn({session,products,request:{kind:'message',text:'나는 커피를 좋아해',expectedVersion:0}});
console.log(JSON.stringify({demo:'mock actor/reviewer; real core checks',output:out},null,2));
