import { decodeFeedback, type CardFeedback } from './cardFeedback.ts';
import { feedbackIdentity, validProductFeedback } from '../../lib/feedback.mjs';
import { decodeGifts } from './storage.ts';
import type { ChatMessage, Gift } from './domain';

// A finished conversation as mypage shows it. Account rows load messages on demand (`messages: null`).
export type PastChat = { id: string; at: string; title: string; recipients: string[]; messages: ChatMessage[] | null; feedback: CardFeedback[]; recommendations?: Gift[] };
export type PastChatDetail = { messages: ChatMessage[]; recommendations: Gift[] };
export const HISTORY_RECOMMENDATION_LIMIT = 12;
export function decodeHistoryRecommendations(value: unknown): Gift[] {
  return Array.isArray(value) ? decodeGifts(JSON.stringify(value.slice(0, HISTORY_RECOMMENDATION_LIMIT))) : [];
}

export type FeedbackSignal = Pick<CardFeedback, 'giftId' | 'helpful' | 'version' | 'kind' | 'context' | 'productKey'> & { at?: string };
export const historyKey = 'pass.chat-history.v1';
export const HISTORY_LIMIT = 30;
export const SIGNAL_LIMIT = 200;

const str = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
export function decodeHistory(raw: unknown): PastChat[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(c => c && typeof c === 'object' && str(c.id, 100) && str(c.at, 40) && str(c.title, 200) &&
    Array.isArray(c.recipients) && c.recipients.every((r: unknown) => str(r, 40)) && Array.isArray(c.messages) &&
    c.messages.every((m: ChatMessage) => m && ['user', 'assistant'].includes(m.role) && str(m.text, 16000)))
    .map(c => ({ id: c.id, at: c.at, title: c.title, recipients: c.recipients, messages: c.messages, feedback: decodeFeedback(c.feedback), ...(Array.isArray(c.recommendations) ? { recommendations: decodeHistoryRecommendations(c.recommendations) } : {}) }))
    .slice(0, HISTORY_LIMIT);
}

// What the ranking sees: the latest answer per product across every source, newest last, capped.
export function rankingFeedback(...lists: CardFeedback[][]): FeedbackSignal[] {
  const latest = new Map<string, CardFeedback>();
  for (const f of lists.flat().filter(validProductFeedback).sort((a, b) => a.at.localeCompare(b.at))) {
    const key = feedbackIdentity(f); latest.delete(key); latest.set(key, f);
  }
  const signals = [...latest.values()].slice(-SIGNAL_LIMIT).map(({ giftId, helpful, version, kind, context, productKey, at }) =>
    ({ giftId, helpful, version, kind, context, productKey, at }));
  // Stay below the API's 32 KiB request limit even with Korean context strings.
  while (signals.length && JSON.stringify(signals).length > 6000) signals.shift();
  return signals;
}

export function chatTitle(messages: ChatMessage[]) {
  return messages.find(m => m.role === 'user')?.text.slice(0, 80) || '대화';
}

type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
// Guest conversations are archived on this device when a new chat starts. Newest first.
export function createHistoryRepository(storage: Storage) {
  let writes: Promise<void> = Promise.resolve();
  async function load() {
    try { return decodeHistory(JSON.parse((await storage.getItem(historyKey)) ?? '[]')); } catch { return []; }
  }
  const write = (change: (list: PastChat[]) => PastChat[]) => {
    const task = writes.then(async () => { await storage.setItem(historyKey, JSON.stringify(change(await load()).slice(0, HISTORY_LIMIT))); });
    writes = task.catch(() => {});
    return task;
  };
  return {
    load,
    archive: (chat: PastChat) => write(list => [chat, ...list.filter(c => c.id !== chat.id)]),
  };
}
