import {initial, extract, apply, differences, recommend} from './engine.mjs';
export const startConversation=()=>({state:initial(),issues:[]});
const prompts={recipient:['누구에게 드릴 선물인가요?',['부모님','손주들','친구']],quantity:['선물이 몇 세트 필요한가요?',['한 세트','두 세트','네 세트']],amount:['얼마까지 쓰고 싶으세요?',['총 10만 원','총 20만 원','세트당 5만 원']],scope:['말씀하신 금액은 모두 합친 예산인가요, 한 세트 예산인가요?',['모두 합쳐서','세트당']],shipping:['예산에 배송비도 포함할까요?',['배송비 포함','상품값만']],same:['모두 같은 상품으로 보낼까요? 지금은 같은 식품 선물을 여러 세트 고를 수 있어요.',['같은 상품으로','서로 다른 상품으로']]};
export function nextQuestion(session){const s=session.state;let key=session.issues.length?'issue':!s.recipients.length?'recipient':!s.quantity?'quantity':!s.budget.amount_krw?'amount':!s.budget.scope?'scope':s.budget.shipping_included===null?'shipping':s.quantity>1&&s.same_product!==true?'same':null;return {key,text:key==='issue'?session.issues[0]:key?prompts[key][0]:'조건이 준비됐어요. 추천을 살펴보거나 원하는 조건을 바꿔주세요.',choices:key==='issue'?[]:key?prompts[key][1]:['덜 단 상품으로','견과류는 빼줘']};}
export function conversationTurn(session,text,products){
 const before=session.state;const asked=nextQuestion(session).key;const parsed=extract(text,before);const p=parsed.patch;let handled=false;
 const rs=['손주','손녀','친척','자녀'].filter(x=>text.includes(x));if(rs.length){p.recipients=rs;handled=true;}
 const numberWords={한:1,하나:1,두:2,둘:2,세:3,셋:3,네:4,넷:4,다섯:5};
 const qm=text.match(/(다섯|하나|둘|셋|넷|한|두|세|네|\d+)\s*(?:명|세트|집)/)||(asked==='quantity'?text.match(/^(?:그냥\s*)?(\d+|하나|둘|셋|넷|다섯)(?:\s*다|이에요|이요|이야|요)?[.!]?$/):null);
 if(qm){p.quantity=numberWords[qm[1]]||Number(qm[1]);handled=true;}
 if(p.quantity!==undefined&&(!Number.isSafeInteger(p.quantity)||p.quantity<1)){delete p.quantity;parsed.questions=['한 세트 이상으로 알려주세요.'];}
 const scope=/합쳐|총|전체/.test(text)?'total':/세트당|한 세트 예산/.test(text)?'per_set':null;
 if(p.budget?.amount_krw!==undefined){p.budget.scope=scope||before.budget.scope;if(p.budget.amount_krw<=0){p.budget.amount_krw=null;}}
 if(scope){p.budget={...p.budget,scope};handled=true;}
 if(/서로 다른|각각 다른|같은.*(?:싫|말고|아니)/.test(text)){p.same_product=false;handled=true;}
 else if(asked==='same'&&/^(네|예|좋아요)[.!]?$/.test(text.trim())){p.same_product=true;handled=true;}
 if(session.issues.some(q=>q.includes('성분'))){const found=['땅콩','호두','우유','밀','대두'].filter(x=>text.includes(x));if(found.length){p.excluded_ingredients=[...new Set([...before.excluded_ingredients,...found])];handled=true;}}
 const next=apply(before,p);
 // Keep unresolved constraints across unrelated replies; never silently lose an allergy or deadline question.
 let issues=session.issues.filter(q=>!(q.includes('성분')&&p.excluded_ingredients?.length)&&!(q.includes('마감일')&&p.delivery_by)&&!(q.includes('예산 상한')&&p.budget?.amount_krw));
 const newIssues=parsed.questions.filter(q=>!q.startsWith('이 데모는')||(!handled&&!Object.keys(p).length));
 issues=[...new Set([...issues.filter(q=>!q.startsWith('이 데모는')&&!(q.includes('한 세트 이상')&&p.quantity)), ...newIssues])];
 const updated={state:next,issues};const question=nextQuestion(updated);const changes=differences(before,next);
 const summary=[next.recipients.join('·'),next.quantity?`${next.quantity}세트`:null,next.budget.amount_krw?`${next.budget.scope==='total'?'모두 합쳐':next.budget.scope==='per_set'?'세트당':'기준 확인 중'} ${next.budget.amount_krw.toLocaleString('ko-KR')}원 이하`:null,next.budget.shipping_included===null?null:next.budget.shipping_included?'배송비 포함':'배송비 별도'].filter(Boolean).join(' · ');
 const unsupported=next.same_product===false&&next.quantity>1?'지금은 받는 분마다 다른 상품을 나누어 추천하지 못해요. 같은 상품을 원하실 때만 “같은 상품으로”라고 알려주세요.':null;
 return {session:updated,changes,question,message:[changes.length?`이렇게 이해했어요: ${summary}.`:null,unsupported||question.key&&question.text||recommend(products,next).message].filter(Boolean).join('\n')};
}
