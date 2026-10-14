import { CATEGORY_NAMES } from '../../../lib/catalog.mjs';
import { normalizeConditions } from '../../../lib/condition-compat.mjs';
import { validateState } from '../../../lib/llm.mjs';
import type { Conditions } from '../domain.ts';
const categoryNames: Record<string, string> = CATEGORY_NAMES;
const special: Record<string, string> = { less_sweet: '덜 달게', unsweetened: '단맛 없이', formal: '격식 있는 포장', basic: '기본 포장' };
const aliases: Record<string, string> = { 차: 'tea', 커피: 'coffee', 과일: 'fruit', 한과: 'hangwa', 견과류: 'nuts', 식용유: 'oil' };
export function conditionLabel(value: string): string {
  if (value.startsWith('category:')) return categoryNames[value.slice(9)] ?? value;
  return special[value] ?? categoryNames[value] ?? value;
}
export function conditionValue(value: string, field: string): string {
  if (field === 'preferences' || field === 'excluded_categories') {
    const category = Object.entries(CATEGORY_NAMES).find(([, label]) => label === value)?.[0] ?? aliases[value];
    if (category) return field === 'preferences' ? `category:${category}` : category;
  }
  return Object.entries(special).find(([, label]) => label === value)?.[0] ?? value;
}
export function normalizeEditedConditions(conditions: Conditions): { state: Conditions; notices: string[] } {
  const normalized = normalizeConditions(conditions);
  validateState(normalized.state);
  return normalized;
}
