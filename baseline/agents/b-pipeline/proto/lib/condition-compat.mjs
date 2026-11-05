// Normalize only known v1 food categories. Unknown values remain for strict validation.
const legacyCategories={fruit:'food',hangwa:'snack',nuts:'food',tea:'coffee_tea',coffee:'coffee_tea',oil:'food'};
const legacyNames={fruit:'과일',hangwa:'한과',nuts:'견과류',tea:'차',coffee:'커피',oil:'식용유'};
const names={food:'식품',snack:'과자·간식',coffee_tea:'커피·차'};
export function normalizeConditions(value){
 const state=structuredClone(value),notices=[];
 if(!state||typeof state!=='object'||!Array.isArray(state.preferences)||!Array.isArray(state.excluded_categories)||!Array.isArray(state.excluded_ingredients))return {state,notices};
 state.preferences=[...new Set(state.preferences.map(preference=>{
  if(typeof preference!=='string'||!preference.startsWith('category:'))return preference;
  const old=preference.slice(9),next=legacyCategories[old];
  if(!next)return preference;
  notices.push(`${legacyNames[old]} 선호를 새 상품군 ${names[next]} 선호로 옮겼어요.`);
  return `category:${next}`;
 }))];
 state.excluded_categories=[...new Set(state.excluded_categories.flatMap(category=>{
  if(category==='nuts'){
   state.excluded_ingredients=[...new Set([...state.excluded_ingredients,'견과류'])];
   notices.push('견과류 제외를 피할 성분으로 옮겼어요.');return [];
  }
  const next=legacyCategories[category];
  if(!next)return [category];
  notices.push(`${legacyNames[category]} 제외를 새 상품군 ${names[next]} 제외로 옮겼어요.`);
  return [next];
 }))];
 return {state,notices};
}
