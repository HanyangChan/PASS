import { classifyIntent, parseConditions } from '../a-router/parser.mjs';
import { isIngredientQuestion } from '../full-chat/index.mjs';

export function verifiedShoppingPatch({session,request,pendingQuestion=''}) {
  const text=request.text;
  if(typeof text!=='string' || text.length>4000 || !/선물|추천|골라|찾|원하는|있을까요/.test(text)) return null;
  if(isIngredientQuestion(pendingQuestion) || /알레르|알러지|피해야|성분|제외|빼|말고|대신|해제|취소|최소|이상|이유|설명|비교/.test(text)) return null;
  const normalized=text
    .replace(/(받는\s*(?:사람|분)(?:은|는)?\s*[가-힣]+)이고(?=[\s,.!?])/g,'$1.')
    .replace(/원하는\s*(?:건|것은)\s*/g,'')
    .replace(/(?<=[가-힣])입니다(?=[\s,.!?]|$)/g,'')
    .replace(/원까지예요/g,'원 이하');
  if(classifyIntent(normalized,session.state).kind!=='message') return null;

  const parsed=parseConditions(normalized,session.state,{pendingQuestion,singleGift:true});
  const {patch}=parsed;
  if (parsed.unresolved || parsed.questions.length ||
      !Object.keys(patch).every(key=>['recipients','preferences','budget','delivery_by'].includes(key))) return null;
  if (patch.recipients?.length!==1 ||
      (session.state.recipients.length && (session.state.recipients.length!==1 || session.state.recipients[0]!==patch.recipients[0]))) return null;
  if (!patch.preferences?.some(tag=>tag.startsWith('category:')) || !patch.budget?.amount_krw ||
      typeof patch.budget.shipping_included!=='boolean' || Object.hasOwn(patch.budget,'scope')) return null;
  return patch;
}
