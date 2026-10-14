import { calendarEventsKey, decodeCalendarEvents } from '../storage.ts';
import type { CalendarEvent } from '../domain.ts';

export type CalendarStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export function createCalendarRepository(storage: CalendarStorage) {
  let writes: Promise<void> = Promise.resolve();
  return {
    async load(): Promise<CalendarEvent[]> {
      try { return decodeCalendarEvents(await storage.getItem(calendarEventsKey)); }
      catch { return []; }
    },
    save(events: CalendarEvent[]) {
      // Snapshot at enqueue time so later UI updates cannot change this write.
      const value = JSON.stringify(events);
      const task = writes.then(() => storage.setItem(calendarEventsKey, value));
      // A failed write must reject its caller without poisoning later saves.
      writes = task.catch(() => {});
      return task;
    },
  };
}
