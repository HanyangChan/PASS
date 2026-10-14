import { CATEGORY_NAMES } from '../../lib/catalog.mjs';
import type { EngineProduct, Gift } from './domain.ts';
export type { Gift } from './domain.ts';
export const categoryNames: Record<string, string> = CATEGORY_NAMES;
// Chat starters on the home screen (labels are sent as the first message).
export const categories = [
  { label: '생일', emoji: '🎂' }, { label: '결혼', emoji: '💍' }, { label: '졸업', emoji: '🎓' }, { label: '부모님', emoji: '🧡' },
  { label: '아이', emoji: '🧸' }, { label: '연인', emoji: '💝' }, { label: '직장', emoji: '💼' }, { label: '감사', emoji: '🏮' },
];
const iconCategories: readonly string[] = ['fruit', 'hangwa', 'nuts', 'tea', 'coffee', 'oil'];
export function giftFromProduct(p: EngineProduct): Gift {
  return {
    id: p.id, name: p.name.replace('가상 ', ''), category: categoryNames[p.category] ?? p.category,
    price: p.price_krw, description: p.description,
    icon: iconCategories.includes(p.category) ? (p.category as Gift['icon']) : 'gift',
    source: 'engine', image: p.image, rating: p.rating, ratingCount: p.rating_count, link: p.link,
    nameEn: p.name_en, demoFields: p.demo_fields,
    packaging: p.packaging === 'formal' ? '격식 있는 포장' : '기본 포장', arrival: p.arrival_date,
    ingredients: p.ingredients, sweetness: p.sweetness, brand: p.brand ?? undefined,
    allergensDeclared: p.allergens_declared, allergenInfoComplete: p.allergen_information_complete,
  };
}
const recipientCategories: Record<string, string[] | null> = {
  전체: null,
  부모님: ['health', 'food', 'coffee_tea', 'kitchen', 'decor'],
  친구: ['beauty', 'makeup', 'jewelry', 'audio', 'snack'],
  직장동료: ['coffee_tea', 'snack', 'decor', 'accessory', 'kitchen'],
};
export function rankGifts(products: EngineProduct[]): Record<string, Gift[]> {
  const sorted = [...products].sort((a, b) => (b.rating_count ?? 0) - (a.rating_count ?? 0) || a.id.localeCompare(b.id));
  return Object.fromEntries(Object.entries(recipientCategories).map(([label, cats]) =>
    [label, sorted.filter(p => !cats || cats.includes(p.category)).slice(0, 100).map(giftFromProduct)]));
}
