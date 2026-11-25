import { explicitShoppingConditions } from '../baseline/agents/full-chat/explicit-conditions.mjs';
import { productTypes } from '../lib/ranking.mjs';
import { engineState } from '../lib/single-gift.mjs';

export function recoverEmptyRecommendation(text, before, state, catalog, recommend) {
  const explicit=explicitShoppingConditions(text,engineState(state));
  if (explicit.categories?.length!==1) return {outcome:'no_verified_change',attempts:0};
  const [tag]=explicit.categories;
  const category=tag.slice('category:'.length);
  if (!catalog.some(product=>product.category===category)) return {outcome:'category_unavailable',attempts:0};

  const currentCategories=state.preferences.filter(value=>value.startsWith('category:'));
  const correctCategory=currentCategories.length===1 && currentCategories[0]===tag;
  const namedTypes=new Set([...(explicit.types??[]),...productTypes({category,name:text})]);
  const broadStationery=category==='stationery' && /문구\s*(?:류|용품)(?:를|을)?\s*(?:추천|골라|찾아)/.test(text) &&
    !namedTypes.size && !/마커|붓|크레용|marker|crayon/i.test(text);
  const inferredWriting=broadStationery && state.preferences.includes('type:writing') && !before.preferences.includes('type:writing');
  if (correctCategory && !inferredWriting) return {outcome:'no_verified_change',attempts:0};

  const preferences=state.preferences.filter(value=>!value.startsWith('category:') && (!inferredWriting || value!=='type:writing'));
  const next={...state,preferences:[...new Set([...preferences,tag,...namedTypes])]};
  const reason=correctCategory?'inferred_type_filter':'category_mismatch';
  const result=recommend(catalog,engineState(next));
  return result.items.length ? {outcome:'recovered',attempts:1,reason,state:next,result} : {outcome:'still_empty',attempts:1,reason};
}
