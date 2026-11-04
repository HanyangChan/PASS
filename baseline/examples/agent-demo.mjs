import { createSession } from '../src/index.mjs';
import { loadAgent } from '../agents/registry.mjs';
import { products } from './catalog.mjs';
const agent = loadAgent(process.argv[2] ?? 'a-router');
const first = await agent.runTurn({
  session: createSession('agent-demo'), products,
  request: {kind:'message', expectedVersion:0, text:'어머니 한 세트 세트당 예산 5만원 이하 배송비 포함 추천'},
});
const followup = await agent.runTurn({
  session:first.session, products,
  request:{kind:'message', expectedVersion:first.session.version, text:'센스 있는 선물로 골라줘'},
});
console.log(JSON.stringify({agent:agent.id, first, followup}, null, 2));
