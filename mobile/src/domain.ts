export const giftIcons = ['fruit', 'hangwa', 'nuts', 'tea', 'coffee', 'oil', 'gift'] as const;
export type GiftIcon = (typeof giftIcons)[number];
export type EngineProduct = {
  id: string; name: string; name_en?: string; category: string; description: string;
  price_krw: number; shipping_fee_per_set_krw: number; stock_sets: number; arrival_date: string;
  packaging: string; sweetness: string; brand: string | null; allergens_declared: string[];
  allergen_information_complete: boolean; ingredients?: string[]; image?: string; link?: string;
  rating?: number; rating_count?: number; demo_fields?: string[];
};
export type Gift = {
  id: string;
  name: string;
  category: string;
  price: number;
  description: string;
  icon: GiftIcon;
  shippingIncluded?: boolean;
  image?: string;
  rating?: number;
  likeCount?: number;
  source?: 'prototype' | 'engine';
  packaging?: string;
  arrival?: string;
  ingredients?: string[];
  sweetness?: string;
  brand?: string;
  allergensDeclared?: string[];
  allergenInfoComplete?: boolean;
  link?: string;
  nameEn?: string;
  ratingCount?: number;
  demoFields?: string[];
};

export type Conditions = {
  recipients: string[];
  occasion: string | null;
  budget: { amount_krw: number | null; shipping_included: boolean | null };
  preferences: string[];
  excluded_categories: string[];
  excluded_ingredients: string[];
  brand: string | null;
  delivery_by: string | null;
  packaging: string | null;
};
export type ConditionPatch = Partial<Omit<Conditions, 'budget'>> & {
  budget?: Partial<Conditions['budget']>;
};
export type ChatSession = { state: Conditions; issues: string[] };
export type ChatMessage = { role: 'user' | 'assistant'; text: string };
export type GiftRecords = { saved: Gift[]; recent: Gift[] };
