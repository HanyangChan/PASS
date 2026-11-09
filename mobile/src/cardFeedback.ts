// Per-card "was this reason helpful" records. Pure helpers only; storage lives in the repositories.
export type CardFeedback = {
  conversationId: string; // account: conversation row id, guest: local session id
  giftId: string;
  rank: number;
  helpful: boolean;
  agentMode: string; // selected answer mode, or 'local' for the on-device guest engine
  engineMode: string; // what actually ran on the server: rules | rules_fast | llm | agents | local
  reason: string;
  at: string;
};
export const feedbackKey = 'pass.card-feedback.v1';
export const FEEDBACK_LIMIT = 500;
export const FEEDBACK_FLUSH_MS = 3000;

const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max;
export function decodeFeedback(raw: unknown): CardFeedback[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((f): f is CardFeedback => !!f && typeof f === 'object' &&
    text(f.conversationId, 100) && text(f.giftId, 200) && Number.isInteger(f.rank) && typeof f.helpful === 'boolean' &&
    text(f.agentMode, 40) && text(f.engineMode, 20) && text(f.reason, 300) && text(f.at, 40)).slice(-FEEDBACK_LIMIT);
}
// Same answer again clears it; the other answer replaces it. One record per card per conversation.
export function toggleFeedback(list: CardFeedback[], entry: CardFeedback): CardFeedback[] {
  const same = (f: CardFeedback) => f.conversationId === entry.conversationId && f.giftId === entry.giftId;
  const previous = list.find(same);
  const rest = list.filter(f => !same(f));
  return previous && previous.helpful === entry.helpful ? rest : [...rest, entry].slice(-FEEDBACK_LIMIT);
}
export const stampConversation = (list: CardFeedback[], conversationId: string) => list.map(f => ({ ...f, conversationId }));

// Taps only mark the scheduler dirty. One trailing flush covers a burst of taps; a flush that a regular
// chat save already carried is skipped through `pending`, so taps never add saves of their own.
export function createFeedbackScheduler(options: { flush: () => Promise<void> | void; delayMs?: number; setTimer?: typeof setTimeout; clearTimer?: typeof clearTimeout }) {
  const { flush, delayMs = FEEDBACK_FLUSH_MS, setTimer = setTimeout, clearTimer = clearTimeout } = options;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => { timer = null; return flush(); };
  return {
    schedule() { if (timer) clearTimer(timer); timer = setTimer(run, delayMs); },
    flushNow() { if (timer) { clearTimer(timer); timer = null; } return flush(); },
    cancel() { if (timer) clearTimer(timer); timer = null; },
  };
}
