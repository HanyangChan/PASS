import { giftIcons, calendarEventKinds, type Gift, type CalendarEvent } from './domain.ts';
export const savedKey = 'pass.saved-gifts.v1';
export const recentKey = 'pass.recent-gifts.v1';
export const calendarEventsKey = 'pass.calendar-events.v1';
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
      (giftIcons as readonly string[]).includes(g.icon) &&
      (g.image === undefined ||
        (typeof g.image === 'string' && g.image.startsWith('https://'))),
  );
}
const monthDayPattern = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
export function decodeCalendarEvents(raw: string | null): CalendarEvent[] {
  if (!raw) return [];
  const values: unknown = JSON.parse(raw);
  if (!Array.isArray(values)) throw new Error('Invalid calendar storage');
  return values.filter(
    (e): e is CalendarEvent =>
      !!e &&
      typeof e === 'object' &&
      typeof e.id === 'string' &&
      typeof e.title === 'string' &&
      e.title.trim().length > 0 &&
      typeof e.date === 'string' &&
      monthDayPattern.test(e.date) &&
      (calendarEventKinds as readonly string[]).includes(e.kind),
  );
}
