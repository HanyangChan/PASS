export const giftIcons = ['fruit', 'hangwa', 'nuts', 'tea', 'coffee', 'oil', 'gift'] as const;
export type GiftIcon = (typeof giftIcons)[number];
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

export const calendarEventKinds = ['birthday', 'anniversary', 'etc'] as const;
export type CalendarEventKind = (typeof calendarEventKinds)[number];
// date is 'MM-DD' and recurs every year — birthdays and anniversaries don't carry a year.
export type CalendarEvent = { id: string; title: string; date: string; kind: CalendarEventKind };
