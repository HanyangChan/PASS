type SecureStorage = {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
};
type Manifest = { generation: string; count: number };
// 400 code points are at most 1600 UTF-8 bytes, below historical iOS payload limits.
export function createSecureSessionStorage(store: SecureStorage) {
  let queue: Promise<unknown> = Promise.resolve();
  let sequence = 0;
  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    const task = queue.then(operation);
    queue = task.catch(() => {});
    return task;
  }
  async function manifest(key: string): Promise<Manifest | null> {
    const raw = await store.getItemAsync(key);
    if (!raw) return null;
    let value: Manifest | null = null;
    try { value = JSON.parse(raw) as Manifest; } catch {}
    if (!value || typeof value.generation !== 'string' || !/^[a-z0-9-]+$/.test(value.generation) || !Number.isInteger(value.count) || value.count < 0 || value.count > 500) {
      await store.deleteItemAsync(key);
      return null;
    }
    return value;
  }
  const chunkKey = (key: string, value: Manifest, index: number) => `${key}.${value.generation}.${index}`;
  async function cleanup(key: string, value: Manifest | null) {
    if (value) await Promise.all(Array.from({ length: value.count }, (_, i) => store.deleteItemAsync(chunkKey(key, value, i)).catch(() => {})));
  }
  return {
    getItem(key: string) {
      return serialized(async () => {
        const value = await manifest(key);
        if (!value) return null;
        const chunks = await Promise.all(Array.from({ length: value.count }, (_, i) => store.getItemAsync(chunkKey(key, value, i))));
        if (chunks.some(chunk => chunk === null)) {
          await store.deleteItemAsync(key); await cleanup(key, value); return null;
        }
        return chunks.join('');
      });
    },
    setItem(key: string, text: string) {
      return serialized(async () => {
        const previous = await manifest(key);
        const characters = Array.from(text);
        const next = { generation: `${Date.now().toString(36)}-${(++sequence).toString(36)}-${Math.random().toString(36).slice(2)}`, count: Math.ceil(characters.length / 400) };
        if (next.count > 500) throw new Error('로그인 정보가 너무 큽니다.');
        try {
          for (let i = 0; i < next.count; i++) await store.setItemAsync(chunkKey(key, next, i), characters.slice(i * 400, (i + 1) * 400).join(''));
          // Commit only after all chunks succeed. Interrupted writes keep the previous session readable.
          await store.setItemAsync(key, JSON.stringify(next));
        } catch (error) { await cleanup(key, next); throw error; }
        await cleanup(key, previous);
      });
    },
    removeItem(key: string) {
      return serialized(async () => {
        const previous = await manifest(key);
        await store.deleteItemAsync(key);
        await cleanup(key, previous);
      });
    },
  };
}
