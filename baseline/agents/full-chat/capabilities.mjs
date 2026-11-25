// Catalog capability checks shared by B execution and C review. No price/ranking rules.
import { extract } from '../../src/vendor/engine.mjs';
const scentCategories={beauty:'화장품|뷰티|미용|beauty',makeup:'메이크업|색조|makeup',personal_care:'생활가전|개인위생|퍼스널.?케어|personal_care',decor:'홈데코|장식품|인테리어|decor'};
// Gender/age words that describe the current recipient rather than name a different person.
const PROFILE_WORDS=/^(?:남자|여자|남성|여성|남아|여아)?\s*(?:아이|어린이|아기|청소년|학생|초등학생|중학생|고등학생|대학생|성인|어른|어르신)?$|^(?:남자|여자|남성|여성|남아|여아)$|^\d{1,2}\s*(?:살|세|대)\s*(?:남자|여자|남성|여성)?$/;
const REPLACE_CUE=/말고|대신|이번엔|이번에는|아니라|바꿔|다른\s*사람/;
export function recipientRefinementIssue(context,action) {
  const next=action.action==='update_conditions'?action.patch?.recipients:null;
  if(!Array.isArray(next)||!next.length||!context.state.recipients?.length)return null;
  if(next.some(r=>context.state.recipients.includes(r))||REPLACE_CUE.test(context.text))return null;
  if(!next.every(r=>PROFILE_WORDS.test(String(r).trim())))return null;
  return `"${next.join(', ')}" describes the current recipient (${context.state.recipients.join(', ')}), not a new person. Keep recipients unchanged and add gender:/age: profile tags to the existing preferences, keeping every other condition, then respond type=result.`;
}
// Asking the question the user just answered loops the conversation ("손주야" → the same question again).
// Reworded repeats count too: character-bigram overlap (Dice) of 0.6 or more is the same question.
const bigrams=s=>{const n=String(s??'').replace(/[\s?.!,~]/g,'');return Array.from({length:Math.max(0,n.length-1)},(_,i)=>n.slice(i,i+2));};
const sameQuestion=(a,b)=>{
  const x=bigrams(a),y=bigrams(b);
  if(!x.length||!y.length)return false;
  const pool=[...y];let shared=0;
  for(const g of x){const i=pool.indexOf(g);if(i>=0){shared++;pool.splice(i,1);}}
  return 2*shared/(x.length+y.length)>=0.6;
};
// With one recipient, gender/age words describe that person; asking whether they mean the recipient is not needed.
const PROFILE_TEXT=/\d{1,2}\s*(?:대|살|세)|남자|여자|남성|여성|남아|여아|성인|어른|어르신|청소년|중학생|고등학생|대학생|직장인|초등학생|어린이|유아/;
const IDENTITY_QUESTION=/수령인|수신자|받는\s*(?:분|사람)|받으시는|대상|대신|다른|뜻하|뜻인|의미|맞나요|말씀/;
export function needlessRecipientQuestion(context,action) {
  if(action.action!=='clarify'||(context.state.recipients?.length??0)!==1||REPLACE_CUE.test(context.text??''))return null;
  const question=String(action.question??''),recipient=context.state.recipients[0];
  if(!PROFILE_TEXT.test(context.text??'')||!(IDENTITY_QUESTION.test(question)||question.includes(recipient)||PROFILE_TEXT.test(question)))return null;
  return `With one recipient (${context.state.recipients[0]}) and no replacement cue, "${context.text}" describes that recipient. Do not ask; keep recipients unchanged, add the gender:/age: profile tags to the existing preferences and respond type=result.`;
}
export function repeatedQuestionIssue(context,action) {
  if(action.action!=='clarify'||!String(context.text??'').trim())return null;
  const asked=[context.currentQuestion,...(context.history??[]).filter(m=>m.role==='assistant').slice(-1).map(m=>m.text)];
  if(!asked.some(q=>sameQuestion(action.question,q)))return null;
  return `You already asked "${action.question}" and the user answered "${context.text}". Treat the reply as the answer: apply what it settles, using the earlier user message in history that the question was about, keep every other condition, and finish. Ask a different, more specific question only if the reply truly leaves it open.`;
}
// A taste stated without a subject ("화장품을 좋아해") belongs to the single current recipient; the rule parser maps it.
const TASTE_TEXT=/좋아|선호|관심|즐겨|취미/;
export function tasteTagsFromText(text,state) {
  if(!TASTE_TEXT.test(String(text??''))||/싫|안\s*좋아|좋아하지/.test(String(text??'')))return [];
  try { return (extract(String(text),{...state,budget:state.budget??{scope:null}}).patch.preferences??[]).filter(p=>/^(?:category|type):/.test(p)&&!state.preferences.includes(p)); } catch { return []; }
}
function needlessTasteQuestion(context,action) {
  if(action.action!=='clarify'||(context.state.recipients?.length??0)!==1||REPLACE_CUE.test(context.text??''))return null;
  if(!tasteTagsFromText(context.text,context.state).length)return null;
  return `With one recipient (${context.state.recipients[0]}), "${context.text}" is that recipient's taste. Do not ask; add the matching category/type preference to the existing preferences and respond type=result.`;
}
// Gender/age tags the words themselves state; ambiguous or missing gives [].
export function profileTagsFromText(text) {
  const t=String(text??''),tags=[];
  const male=/남자|남성|남아/.test(t),female=/여자|여성|여아/.test(t);
  if(male!==female)tags.push(male?'gender:male':'gender:female');
  const decade=t.match(/(\d)0\s*대/),years=t.match(/(\d{1,2})\s*(?:살|세)/);
  const age=decade?(+decade[1]<=1?'teen':+decade[1]<=5?'adult':'elder')
    :years?(+years[1]<13?'child':+years[1]<20?'teen':+years[1]<60?'adult':'elder')
    :/중학생|고등학생|청소년/.test(t)?'teen':/초등학생|유아|어린이|아이|아기/.test(t)?'child'
    :/성인|어른|대학생|직장인/.test(t)?'adult':/어르신|노인/.test(t)?'elder':null;
  if(age)tags.push(`age:${age}`);
  return tags;
}
// When the model insists on a needless or repeated recipient question but the user's words settle it, the server
// applies the profile tags itself (or finishes, if it already did) instead of looping until the call budget runs out.
export function capabilityFix(context,action) {
  if(action.action!=='clarify'||(context.state.recipients?.length??0)!==1)return null;
  const needless=needlessRecipientQuestion(context,action),repeated=repeatedQuestionIssue(context,action),taste=needlessTasteQuestion(context,action);
  if(!needless&&!repeated&&!taste)return null;
  if(context.observations?.length)return {action:'respond',type:'result'};
  if(taste)return {action:'update_conditions',patch:{preferences:[...context.state.preferences,...tasteTagsFromText(context.text,context.state)]}};
  let tags=profileTagsFromText(context.text);
  if(!tags.length&&repeated)tags=profileTagsFromText((context.history??[]).filter(m=>m.role==='user').at(-1)?.text);
  if(!tags.length)return null;
  const kinds=new Set(tags.map(tag=>tag.split(':')[0]));
  return {action:'update_conditions',patch:{preferences:[...context.state.preferences.filter(p=>!kinds.has(p.split(':')[0])),...tags]}};
}
// Actions the server can verify from the user's own words, so a model reviewer cannot argue them into a loop:
// adding only the gender/age/taste tags the message states (other preferences kept), and the result after that.
export function verifiedAction(context,action) {
  if((context.state.recipients?.length??0)!==1||REPLACE_CUE.test(context.text??''))return false;
  const said=[...profileTagsFromText(context.text),...tasteTagsFromText(context.text,context.state)];
  if(!said.length)return false;
  if(action.action==='respond'&&action.type==='result')return Boolean(context.observations?.length)&&said.every(tag=>context.state.preferences.includes(tag));
  if(action.action!=='update_conditions'||Object.keys(action.patch??{}).join()!=='preferences')return false;
  const next=action.patch.preferences,kinds=new Set(said.filter(tag=>/^(?:gender|age):/.test(tag)).map(tag=>tag.split(':')[0]));
  const kept=context.state.preferences.filter(p=>!kinds.has(p.split(':')[0]));
  return kept.every(p=>next.includes(p))&&next.every(p=>kept.includes(p)||said.includes(p))&&said.every(tag=>next.includes(tag));
}
export function capabilityIssue(context,action) {
  const refinement=recipientRefinementIssue(context,action)??repeatedQuestionIssue(context,action)??needlessRecipientQuestion(context,action)??needlessTasteQuestion(context,action);
  if(refinement)return refinement;
  const userText=[...context.history.filter(m=>m.role==='user').map(m=>m.text),context.text].join('\n');
  if(!/향|scent|fragrance/i.test(userText+'\n'+(context.currentQuestion??'')))return null;
  if(action.action!=='update_conditions'||!Array.isArray(action.patch?.excluded_categories))return null;
  const added=action.patch.excluded_categories.filter(c=>!context.state.excluded_categories.includes(c));
  const unsupported=added.filter(c=>scentCategories[c]&&!new RegExp(`(?:${scentCategories[c]})[^.!?\\n,]{0,20}(?:제외|빼|빼줘|싫|exclude)`, 'i').test(userText));
  if(unsupported.length)return 'Scent strength cannot be mapped to whole categories: '+unsupported.join(', ')+'. Preserve existing category exclusions, apply only explicitly named whole-category exclusions, add avoid_fragrance to existing preferences, then search and respond type=result.';
  if(/^(어|응|네|예|그래)[.!?\s]*$/.test(context.text.trim())&&context.state.excluded_categories.some(c=>!action.patch.excluded_categories.includes(c)))return 'A short acceptance cannot reverse existing explicit exclusions because an assistant misstated them. Preserve the existing exclusions, add avoid_fragrance to existing preferences and search.';
  return null;
}
