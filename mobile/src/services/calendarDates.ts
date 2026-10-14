// Recurring dates use MM-DD. February 29 occurs only in leap years.
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}
export function isValidMonthDay(date: string): boolean {
  if (!/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date)) return false;
  const [month, day] = date.split('-').map(Number);
  // Validate against a leap year so February 29 remains a valid recurring date.
  const candidate = new Date(2000, month - 1, day);
  return candidate.getMonth() === month - 1 && candidate.getDate() === day;
}
export function nextOccurrence(date: string, today: Date = new Date()): Date {
  if (!isValidMonthDay(date)) throw new RangeError('Invalid calendar date');
  const [month, day] = date.split('-').map(Number);
  const todayStart = startOfDay(today);
  for (let year = todayStart.getFullYear(); ; year++) {
    const occurrence = new Date(year, month - 1, day);
    // Construct from the original month/day every year; do not reuse normalized dates.
    if (occurrence.getMonth() === month - 1 && occurrence.getDate() === day && occurrence >= todayStart)
      return occurrence;
  }
}
export function daysUntil(date: string, today: Date = new Date()): number {
  const occurrence = nextOccurrence(date, today);
  // Count civil dates rather than elapsed hours across daylight-saving changes.
  return (Date.UTC(occurrence.getFullYear(), occurrence.getMonth(), occurrence.getDate())
    - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())) / 86_400_000;
}
export function sortByUpcoming<T extends { date: string }>(events: readonly T[], today: Date = new Date()): T[] {
  return [...events].sort((a, b) => daysUntil(a.date, today) - daysUntil(b.date, today));
}
export function upcomingWithin<T extends { date: string }>(events: readonly T[], days: number, today: Date = new Date()): T[] {
  return sortByUpcoming(events, today).filter(e => daysUntil(e.date, today) <= days);
}
