// Compare against the latest enqueued intent, not only an acknowledged write.
// Otherwise A -> B -> A can skip the final A while the B request is in flight.
export function createSnapshotPersistence() {
  const enqueued = new Map<string, string>();
  const versions = new Map<string, number>();
  return {
    restore(snapshots: Record<string, string>) {
      enqueued.clear(); versions.clear();
      for (const [key, value] of Object.entries(snapshots)) enqueued.set(key, value);
    },
    retry() { enqueued.clear(); },
    write(key: string, snapshot: string, operation: () => Promise<void>): Promise<void> | null {
      if (enqueued.get(key) === snapshot) return null;
      enqueued.set(key, snapshot);
      const version = (versions.get(key) ?? 0) + 1;
      versions.set(key, version);
      const invalidate = () => {
        // An older failure must not invalidate a newer pending intent.
        if (versions.get(key) === version) enqueued.delete(key);
      };
      try { return operation().catch(error => { invalidate(); throw error; }); }
      catch (error) { invalidate(); return Promise.reject(error); }
    },
  };
}
