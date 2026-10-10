import type { Gift } from './domain';
export const savedKey = 'pass.saved-gifts.v1';
export const recentKey = 'pass.recent-gifts.v1';
export function decodeGifts(raw: string | null): Gift[] {
  if (!raw) return [];
  const values: unknown = JSON.parse(raw);
  if (!Array.isArray(values)) throw new Error('Invalid gift storage');
  return values.filter(
    (g): g is Gift =>
      !!g &&
      typeof g === 'object' &&
      typeof g.id === 'string' &&
      typeof g.name === 'string' &&
      typeof g.category === 'string' &&
      Number.isFinite(g.price) &&
      typeof g.description === 'string' &&
      ['fruit', 'gift'].includes(g.icon) &&
      (g.image === undefined ||
        (typeof g.image === 'string' && g.image.startsWith('https://'))),
  );
}
