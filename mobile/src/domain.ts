export type Gift = {
  id: string;
  name: string;
  category: string;
  price: number;
  description: string;
  icon: 'fruit' | 'gift';
  shippingIncluded?: boolean;
  image?: string;
  rating?: number;
  likeCount?: number;
  source?: 'prototype' | 'engine';
  packaging?: string;
  arrival?: string;
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
