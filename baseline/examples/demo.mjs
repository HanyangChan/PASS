import {createSession,runTurn} from '../src/index.mjs';
import {products} from './catalog.mjs';
const first=await runTurn({session:createSession('demo'),products,request:{kind:'message',expectedVersion:0,text:'어머니 한 세트 세트당 예산 5만원 이하 배송비 포함 추천'}});
const comparison=await runTurn({session:first.session,products,request:{kind:'what_if_budget',expectedVersion:first.session.version,amount_krw:70000}});
console.log(JSON.stringify({first,comparison},null,2));
