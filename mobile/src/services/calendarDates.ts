// `date` is always 'MM-DD' — birthdays and anniversaries recur every year, so the
// year is never stored and every occurrence is computed relative to `today`.
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
export function nextOccurrence(date: string, today: Date = new Date()): Date {
  const [month, day] = date.split('-').map(Number);
  const todayStart = startOfDay(today);
  const occurrence = new Date(todayStart.getFullYear(), month - 1, day);
  if (occurrence < todayStart) occurrence.setFullYear(occurrence.getFullYear() + 1);
  return occurrence;
}
export function daysUntil(date: string, today: Date = new Date()): number {
  const diff = nextOccurrence(date, today).getTime() - startOfDay(today).getTime();
  return Math.round(diff / 86_400_000);
}
export function sortByUpcoming<T extends { date: string }>(events: readonly T[], today: Date = new Date()): T[] {
  return [...events].sort((a, b) => daysUntil(a.date, today) - daysUntil(b.date, today));
}
export function upcomingWithin<T extends { date: string }>(events: readonly T[], days: number, today: Date = new Date()): T[] {
  return sortByUpcoming(events, today).filter(e => daysUntil(e.date, today) <= days);
}
