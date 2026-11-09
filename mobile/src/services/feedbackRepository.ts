import { decodeFeedback, feedbackKey, FEEDBACK_LIMIT, type CardFeedback } from '../cardFeedback.ts';

export type FeedbackStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};
// Guest feedback lives on the device only. Each guest session replaces its own entries in the shared log.
export function createFeedbackRepository(storage: FeedbackStorage) {
  let writes: Promise<void> = Promise.resolve();
  async function read(): Promise<CardFeedback[]> {
    try { return decodeFeedback(JSON.parse((await storage.getItem(feedbackKey)) ?? '[]')); } catch { return []; }
  }
  return {
    load: read,
    save(sessionId: string, current: CardFeedback[]) {
      const snapshot = current.map(f => ({ ...f, conversationId: sessionId }));
      const task = writes.then(async () => {
        const others = (await read()).filter(f => f.conversationId !== sessionId);
        await storage.setItem(feedbackKey, JSON.stringify([...others, ...snapshot].slice(-FEEDBACK_LIMIT)));
      });
      writes = task.catch(() => {});
      return task;
    },
  };
}
