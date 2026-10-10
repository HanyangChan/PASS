import data from './make-data.json';
import type { Gift } from './domain';
export type { Gift } from './domain';
type PrototypeGift = {
  id: number;
  name: string;
  tag: string;
  price: string;
  subtitle: string;
  image: string;
  rating: number;
  likeCount?: number;
};
function fromPrototype(p: PrototypeGift): Gift {
  return {
    id: `make-${p.id}`,
    name: p.name,
    category: p.tag,
    price: Number(p.price.replace(/[^0-9]/g, '')),
    description: p.subtitle,
    image: p.image,
    rating: p.rating,
    likeCount: p.likeCount,
    icon: 'gift',
    source: 'prototype',
  };
}
export const popularGifts = data.POPULAR_GIFTS.map(fromPrototype);
export const referenceRecentGifts = data.RECENT_GIFTS.map(fromPrototype);
export const rankingByRecipient = Object.fromEntries(
  Object.entries(data.RANKING_DATA).map(([k, v]) => [k, v.map(fromPrototype)]),
) as Record<string, Gift[]>;
export const categories = data.GIFT_CATEGORIES;
export const categoryNames = {
  fruit: '과일',
  hangwa: '한과',
  tea: '차',
  nuts: '견과류',
  coffee: '커피',
  oil: '기름',
} as Record<string, string>;
