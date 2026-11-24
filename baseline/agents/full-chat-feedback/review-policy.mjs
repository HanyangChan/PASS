import { explicitShoppingConditions } from '../full-chat/explicit-conditions.mjs';
import { capabilityIssue } from '../full-chat/capabilities.mjs';

const same = (a,b) => JSON.stringify(a)===JSON.stringify(b);
const allergy = /알레르기|알러지|피해야\s*할\s*(?:성분|재료)/;
const sensitive = /말고|아니라|대신|빼|제외|취소|해제|가정|비교|원이면|올리면|낮추면|줄이면|늘리면|수령인.{0,12}변경|지\s*마|않/;
const firstIdentification = (state, patch) => !state.recipients.length && patch.recipients?.length;

export function reviewReason(action, context) {
  const { text, state }=context;
  const explicit=explicitShoppingConditions(text,state);
  const allergyContext=allergy.test(text+'\n'+(context.currentQuestion??''));
  const freshRisk=allergy.test(text)?'allergy_constraint':
    explicit.recipients && state.recipients.length && !same(explicit.recipients,state.recipients)?'recipient_change':null;
  if (['search_products','compare_budget','explain_recommendation'].includes(action.action)) return freshRisk;
  if (action.action==='respond') {
    const expected=context.observations.length?'result':null;
    return (action.type==='result')===Boolean(expected)?(!expected?freshRisk:null):'tool_contract';
  }

  const patch=action.patch;
  if (action.action==='clarify') {
    // Repeating a pending question is safe when the user explicitly has no answer.
    if (!allergyContext && context.currentQuestion===action.question &&
        /^(?:아직\s*|잘\s*)?(?:모르겠(?:어요|습니다)|몰라(?:요)?)[.!?\s]*$/.test(text.trim())) return null;
    return allergyContext?'allergy_constraint':'uncertain_clarification';
  }

  if (patch.recipients && state.recipients.length && !same(patch.recipients,state.recipients)) return 'recipient_change';
  if (allergyContext || Object.hasOwn(patch,'excluded_ingredients')) return 'allergy_constraint';
  if ((Array.isArray(patch.excluded_categories) && state.excluded_categories.some(category=>!patch.excluded_categories.includes(category))) ||
      (Array.isArray(patch.preferences) && state.preferences.some(tag=>tag.startsWith('avoid_')&&!patch.preferences.includes(tag)))) {
    return 'constraint_removal';
  }
  if (Object.hasOwn(patch,'excluded_categories') || capabilityIssue(context,action) || sensitive.test(text)) return 'constraint_change';
  if (!Object.keys(patch).every(key=>['budget','preferences','recipients','delivery_by'].includes(key))) return 'unverified_change';

  // Compare each proposed change against an independent, conservative parse.
  // Missing evidence and unsupported fields stay in the reviewer path.
  if (firstIdentification(state,patch) && !same(patch.recipients,explicit.recipients)) return 'unverified_change';
  if (patch.recipients && state.recipients.length && explicit.recipients && !same(patch.recipients,explicit.recipients)) return 'unverified_change';
  if (Object.hasOwn(patch,'recipients') && !patch.recipients?.length) return 'unverified_change';
  if (Object.hasOwn(patch,'budget') && (!patch.budget || !Object.entries(patch.budget).every(([key,value])=>
      Object.hasOwn(explicit.budget??{},key) && value===explicit.budget[key]))) return 'unverified_change';
  if (Object.hasOwn(patch,'delivery_by') && (!explicit.delivery_by || patch.delivery_by!==explicit.delivery_by)) return 'unverified_change';
  if (Object.hasOwn(patch,'preferences')) {
    const categories=explicit.categories??[];
    const types=explicit.types??[];
    const retained=state.preferences.filter(tag=>!tag.startsWith('category:')&&!tag.startsWith('type:'));
    const supported=categories.length?[...retained,...categories,...types]:state.preferences;
    if (!Array.isArray(patch.preferences) || !same([...new Set(patch.preferences)].sort(),[...new Set(supported)].sort())) {
      return 'unverified_change';
    }
  }
  // A server-verified action must also include all explicit fields in the request.
  if (explicit.recipients && !same(patch.recipients??state.recipients,explicit.recipients)) return 'unverified_change';
  if (Object.entries(explicit.budget??{}).some(([key,value])=>(patch.budget?.[key]??state.budget[key])!==value)) return 'unverified_change';
  if (explicit.delivery_by && (Object.hasOwn(patch,'delivery_by')?patch.delivery_by:state.delivery_by)!==explicit.delivery_by) return 'unverified_change';
  if ([...(explicit.categories??[]),...(explicit.types??[])].some(tag=>!(patch.preferences??state.preferences).includes(tag))) return 'unverified_change';
  return null;
}
