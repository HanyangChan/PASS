import { createAgent } from './index.mjs';
import { createSession } from '../../src/index.mjs';
import { products } from '../../examples/catalog.mjs';
const agent=createAgent({singleGift:true});
let session=createSession('router-demo');
for (const text of ['엄마 선물 예산 5만원 배송비 포함','차 좋아해','견과류는 빼줘','왜 추천했어?','예산 7만원이면?','예산 7만원으로 바꿔줘']) {
  const out=await agent.runTurn({session,products,request:{kind:'message',text,expectedVersion:session.version}});
  session=out.session;
  console.log(JSON.stringify({text,kind:out.kind,routing:out.routing,currentBudget:session.state.budget.amount_krw,question:out.question??null,cards:out.result?.cards.map(p=>({id:p.id,cost:p.budget_cost_krw}))??[]},null,2));
}
