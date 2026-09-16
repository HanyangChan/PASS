import {initial,apply,differences,recommend} from './engine.mjs';
import {conversationTurn,nextQuestion} from './conversation.mjs';
export function publicState(s){const {quantity,same_product,budget,...rest}=s;const {scope,...cost}=budget;return {...rest,budget:cost};}
export const singleInitial=()=>publicState(initial());
export const engineState=s=>({...s,quantity:1,same_product:true,budget:{...s.budget,scope:'per_set'}});
export function singleQuestion(session){return nextQuestion({...session,state:engineState(session.state)});}
export function finishSingle(before,state,issues,products){const question=singleQuestion({state,issues});const changes=differences(before,state);const summary=[state.recipients.join('·'),state.budget.amount_krw?`선물 하나 예산 ${state.budget.amount_krw.toLocaleString('ko-KR')}원 이하`:null,state.budget.shipping_included===null?null:state.budget.shipping_included?'배송비 포함':'배송비 별도'].filter(Boolean).join(' · ');return {session:{state,issues},changes,question,message:[changes.length?`이렇게 이해했어요: ${summary}.`:null,question.key?question.text:recommend(products,engineState(state)).message].filter(Boolean).join('\n')};}
export function singleTurn(session,text,products){const turn=conversationTurn({...session,state:engineState(session.state)},text,products);const state=publicState(turn.session.state);const issues=turn.session.issues.filter(q=>!q.includes('한 세트 이상'));return finishSingle(session.state,state,issues,products);}
