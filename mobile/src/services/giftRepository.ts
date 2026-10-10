import { savedKey, recentKey, decodeGifts } from '../storage.ts';
import type { GiftRecords } from '../domain';

export type GiftStorage = {
  getItem(key: string): Promise<string | null>;
  multiSet(entries: [string, string][]): Promise<void>;
};

export function createGiftRepository(storage: GiftStorage) {
  let writes: Promise<void> = Promise.resolve();
  return {
    async load() {
      const results = await Promise.allSettled([
        storage.getItem(savedKey).then(decodeGifts),
        storage.getItem(recentKey).then(decodeGifts),
      ]);
      const [saved, recent] = results;
      return {
        saved: saved.status === 'fulfilled' ? saved.value : [],
        recent: recent.status === 'fulfilled' ? recent.value : [],
        failed: results.flatMap((result, index) => result.status === 'rejected' ? [index === 0 ? 'saved' : 'recent'] : []),
      };
    },
    save(records: GiftRecords) {
      // Snapshot at enqueue time so later UI updates cannot change this write.
      const entries: [string, string][] = [
        [savedKey, JSON.stringify(records.saved)],
        [recentKey, JSON.stringify(records.recent)],
      ];
      const task = writes.then(() => storage.multiSet(entries));
      // A failed write must reject its caller without poisoning later saves.
      writes = task.catch(() => {});
      return task;
    },
  };
}
