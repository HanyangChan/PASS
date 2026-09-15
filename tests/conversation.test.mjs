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
test('money normalization preserves numeric units and accepts Korean and grouped amounts',()=>{for(const [amount,expected] of [['12만 원',120000],['12 만 원',120000],['십만 원',100000],['125,000원',125000],['7만',70000]]){assert.equal(run([`친구 한 세트 상품값 총 ${amount}`]).state.budget.amount_krw,expected);}});
test('negative and lower-bound budgets require a new positive upper limit',()=>{for(const value of ['-7만 원','20만 원 이상']){let s=run([`친구 한 세트 상품값 총 ${value}`]);assert.equal(nextQuestion(s).key,'amount');s=conversationTurn(s,'총 9만 원 이하',products).session;assert.equal(s.state.budget.amount_krw,90000);assert.equal(nextQuestion(s).key,null);}});
test('negative quantity is not silently made positive and correction recovers',()=>{const s=run(['부모님 -3세트 상품값 총 10만 원','한 세트']);assert.equal(s.state.quantity,1);assert.equal(nextQuestion(s).key,null);});
test('invalid date remains blocked through unrelated edits and valid correction recovers',()=>{let s=run(['친구 한 세트 상품값 총 9만 원 2026-02-30까지','견과류 제외']);assert.equal(nextQuestion(s).key,'issue');assert.equal(s.state.delivery_by,null);s=conversationTurn(s,'2026-09-22까지',products).session;assert.equal(nextQuestion(s).key,null);assert.deepEqual(s.state.excluded_categories,['nuts']);});
test('unsupported goods do not produce food recommendations until explicit scope change',()=>{let s=run(['손녀 한 세트 상품값 총 12만 원 운동화','15만 원으로']);assert.equal(nextQuestion(s).key,'issue');s=conversationTurn(s,'식품으로 추천해줘',products).session;assert.equal(nextQuestion(s).key,null);assert.equal(s.state.budget.amount_krw,150000);});
test('shipping negation and re-inclusion change only shipping',()=>{let s=run(['부모님 한 세트 총 9만 원','배송비 포함하지 마']);assert.equal(s.state.budget.shipping_included,false);s=conversationTurn(s,'배송비 포함해줘',products).session;assert.equal(s.state.budget.shipping_included,true);assert.equal(s.state.budget.amount_krw,90000);});
test('recipient addition and quantity correction preserve prior recipient',()=>{const s=run(['부모님 한 세트 상품값 총 18만 원','친척에도 같은 상품 두 세트','두 세트가 아니라 여섯 세트']);assert.equal(s.state.quantity,6);assert.deepEqual(s.state.recipients,['부모님','친척']);});
