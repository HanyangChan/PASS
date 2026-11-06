// Catalog capability checks shared by B execution and C review. No price/ranking rules.
const scentCategories={beauty:'화장품|뷰티|미용|beauty',makeup:'메이크업|색조|makeup',personal_care:'생활가전|개인위생|퍼스널.?케어|personal_care',decor:'홈데코|장식품|인테리어|decor'};
export function capabilityIssue(context,action) {
  const userText=[...context.history.filter(m=>m.role==='user').map(m=>m.text),context.text].join('\n');
  if(!/향|scent|fragrance/i.test(userText+'\n'+(context.currentQuestion??'')))return null;
  if(action.action!=='update_conditions'||!Array.isArray(action.patch?.excluded_categories))return null;
  const added=action.patch.excluded_categories.filter(c=>!context.state.excluded_categories.includes(c));
  const unsupported=added.filter(c=>scentCategories[c]&&!new RegExp(`(?:${scentCategories[c]})[^.!?\\n,]{0,20}(?:제외|빼|빼줘|싫|exclude)`, 'i').test(userText));
  if(unsupported.length)return 'Scent strength cannot be mapped to whole categories: '+unsupported.join(', ')+'. Preserve existing category exclusions, apply only explicitly named whole-category exclusions, add avoid_fragrance to existing preferences, then search and respond type=result.';
  if(/^(어|응|네|예|그래)[.!?\s]*$/.test(context.text.trim())&&context.state.excluded_categories.some(c=>!action.patch.excluded_categories.includes(c)))return 'A short acceptance cannot reverse existing explicit exclusions because an assistant misstated them. Preserve the existing exclusions, add avoid_fragrance to existing preferences and search.';
  return null;
}
