import { CATEGORY_NAMES, recipientCategories } from '../../lib/catalog.mjs';
import type { Conditions } from './domain';

// A recommended item as the engine returns it (guest engine and server agents share this shape).
// Every field is optional so a partial server payload degrades to fewer reasons, never a crash.
export type ReasonItem = {
  category?: string; sweetness?: string; packaging?: string; arrival_date?: string;
  rating_count?: number; popularity?: number;
};
const names = CATEGORY_NAMES as Record<string, string>;
const money = (amount: number) => amount % 10000 === 0 ? `${amount / 10000}만 원` : `${amount.toLocaleString('ko-KR')}원`;

// One short line built only from facts the engine already used. It says which conditions the item
// satisfies; it does not claim why it outranks other items (ties are broken by popularity and price).
export function cardReason(item: ReasonItem, conditions: Conditions): string {
  const category = item.category ? names[item.category] ?? item.category : '';
  const picks: (string | null)[] = [
    item.category && conditions.preferences.includes(`category:${item.category}`) ? `${category} 선호 반영` : null,
    conditions.preferences.includes('unsweetened') && item.sweetness === 'unsweetened' ? '단맛 없는 상품'
      : conditions.preferences.includes('less_sweet') && ['unsweetened', 'naturally_sweet'].includes(item.sweetness ?? '') ? '덜 단 상품' : null,
    item.category && conditions.recipients.length && recipientCategories(conditions.recipients).has(item.category)
      ? `${conditions.recipients.join('·')}에게 어울리는 ${category}` : null,
    conditions.budget.amount_krw ? `예산 ${money(conditions.budget.amount_krw)} 이하` : null,
    // Allergen data is estimated from product names, so say "reflected", never "safe".
    conditions.excluded_ingredients.length ? `${conditions.excluded_ingredients.slice(0, 2).join('·')} 제외 조건 반영` : null,
    conditions.delivery_by && item.arrival_date && item.arrival_date <= conditions.delivery_by
      ? `${Number(conditions.delivery_by.slice(5, 7))}월 ${Number(conditions.delivery_by.slice(8, 10))}일 전 도착` : null,
    conditions.packaging === 'formal' && item.packaging === 'formal' ? '격식 있는 포장' : null,
    (item.rating_count ?? 0) > 0 && (item.popularity ?? 0) >= 0.5 ? `리뷰 ${item.rating_count!.toLocaleString('ko-KR')}개의 인기 상품` : null,
  ];
  const facts = picks.filter((fact): fact is string => Boolean(fact)).slice(0, 2);
  return facts.length ? facts.join(' · ') : '현재 조건에 맞는 상품';
}
