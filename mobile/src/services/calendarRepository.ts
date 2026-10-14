import { calendarEventsKey, decodeCalendarEvents } from '../storage.ts';
import type { CalendarEvent } from '../domain.ts';

export type CalendarStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export function createCalendarRepository(storage: CalendarStorage) {
  let loaded = false;
  let writes: Promise<void> = Promise.resolve();
  return {
    async load(): Promise<CalendarEvent[]> {
      loaded = false;
      await writes;
      const events = decodeCalendarEvents(await storage.getItem(calendarEventsKey));
      loaded = true;
      return events;
    },
    save(events: CalendarEvent[]) {
      if (!loaded) return Promise.reject(new Error('Calendar has not loaded successfully'));
      // Snapshot at enqueue time so later UI updates cannot change this write.
      const value = JSON.stringify(events);
      const task = writes.then(() => storage.setItem(calendarEventsKey, value));
      // A failed write must reject its caller without poisoning later saves.
      writes = task.catch(() => {});
      return task;
    },
  };
}
