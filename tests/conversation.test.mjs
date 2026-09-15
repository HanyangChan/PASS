import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {startConversation,nextQuestion,conversationTurn} from '../lib/conversation.mjs';
const products=JSON.parse(readFileSync(new URL('../lib/products.json',import.meta.url)));
const run=(texts)=>texts.reduce((s,t)=>conversationTurn(s,t,products).session,startConversation());
test('new session asks recipient and does not offer premature results',()=>assert.equal(nextQuestion(startConversation()).key,'recipient'));
test('senior short-answer journey resolves one missing condition at a time',()=>{
 let s=startConversation();for(const [text,key] of [['손주들','quantity'],['넷이에요','amount'],['30만 원','scope'],['모두 합쳐서','shipping'],['배송비 포함','same'],['네',null]]){s=conversationTurn(s,text,products).session;assert.equal(nextQuestion(s).key,key);}
 assert.equal(s.state.quantity,4);assert.equal(s.state.budget.scope,'total');assert.equal(s.state.same_product,true);
});
test('unscoped budget stays unresolved during unrelated preference edits',()=>{const s=run(['부모님 한 세트 10만 원','견과류는 빼줘']);assert.equal(s.state.budget.scope,null);assert.equal(nextQuestion(s).key,'scope');assert.deepEqual(s.state.excluded_categories,['nuts']);});
test('allergy question persists and a short ingredient reply resolves it',()=>{let s=run(['부모님 한 세트 상품값 총 10만 원','알레르기가 있어요','덜 단 상품']);assert.equal(nextQuestion(s).key,'issue');s=conversationTurn(s,'땅콩',products).session;assert.deepEqual(s.state.excluded_ingredients,['땅콩']);assert.equal(s.issues.length,0);});
test('different gifts remain blocked until explicit consent to same product',()=>{let s=run(['손주 네 명 상품값 총 30만 원 서로 다른 상품']);assert.equal(nextQuestion(s).key,'same');s=conversationTurn(s,'견과류는 빼줘',products).session;assert.equal(s.state.same_product,false);assert.equal(nextQuestion(s).key,'same');});
test('budget changes preserve shipping, exclusions and recipients',()=>{const s=run(['부모님 두 세트 같은 상품 배송비 포함 총 10만 원','견과류는 빼줘','15만 원']);assert.equal(s.state.budget.scope,'total');assert.equal(s.state.budget.shipping_included,true);assert.deepEqual(s.state.excluded_categories,['nuts']);assert.deepEqual(s.state.recipients,['부모님']);});
test('zero quantity can be corrected without a stale question',()=>{const s=run(['부모님 0세트','한 세트']);assert.equal(s.state.quantity,1);assert.equal(nextQuestion(s).key,'amount');});
test('read-back includes exact total budget and quantity',()=>{const t=conversationTurn(startConversation(),'부모님 두 세트 상품값 합쳐 15만 원 같은 상품',products);assert.match(t.message,/2세트.*모두 합쳐 150,000원 이하.*배송비 별도/);assert.equal(t.question.key,null);});
