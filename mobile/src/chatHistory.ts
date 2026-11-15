import { decodeFeedback, type CardFeedback } from './cardFeedback.ts';
import type { ChatMessage, EngineProduct } from './domain';

// A finished conversation as mypage shows it. Account rows load messages on demand (`messages: null`).
export type PastChat = { id: string; at: string; title: string; recipients: string[]; messages: ChatMessage[] | null; feedback: CardFeedback[]; demo?: boolean };
export type FeedbackSignal = { giftId: string; helpful: boolean };
export const historyKey = 'pass.chat-history.v1';
export const HISTORY_LIMIT = 30;
export const SIGNAL_LIMIT = 200;

const str = (v: unknown, max: number) => typeof v === 'string' && v.length <= max;
export function decodeHistory(raw: unknown): PastChat[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(c => c && typeof c === 'object' && str(c.id, 100) && str(c.at, 40) && str(c.title, 200) &&
    Array.isArray(c.recipients) && c.recipients.every((r: unknown) => str(r, 40)) && Array.isArray(c.messages) &&
    c.messages.every((m: ChatMessage) => m && ['user', 'assistant'].includes(m.role) && str(m.text, 16000)))
    .map(c => ({ id: c.id, at: c.at, title: c.title, recipients: c.recipients, messages: c.messages, feedback: decodeFeedback(c.feedback), ...(c.demo === true ? { demo: true } : {}) }))
    .slice(0, HISTORY_LIMIT);
}

// What the ranking sees: the latest answer per product across every source, newest last, capped.
export function rankingFeedback(...lists: CardFeedback[][]): FeedbackSignal[] {
  const latest = new Map<string, CardFeedback>();
  for (const f of lists.flat().sort((a, b) => a.at.localeCompare(b.at))) { latest.delete(f.giftId); latest.set(f.giftId, f); }
  return [...latest.values()].slice(-SIGNAL_LIMIT).map(f => ({ giftId: f.giftId, helpful: f.helpful }));
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
    // Demo records replace earlier demo records and never touch real ones.
    addDemo: (chats: PastChat[]) => write(list => [...chats, ...list.filter(c => !c.demo)]),
  };
}

// Three past conversations for a live demo: beauty liked twice, one snack disliked.
// Product ids come from the loaded catalog so the feedback actually matches ranking candidates.
export function demoHistory(products: EngineProduct[], now = new Date()): PastChat[] {
  const of = (category: string) => products.filter(p => p.category === category);
  const [beautyA, beautyB] = of('beauty'), [snack] = of('snack'), [teaA] = of('coffee_tea');
  const day = (n: number) => new Date(now.getTime() - n * 86400000).toISOString();
  const fb = (id: string, p: EngineProduct | undefined, helpful: boolean, at: string, rank: number): CardFeedback[] =>
    p ? [{ conversationId: id, giftId: p.id, rank, helpful, agentMode: 'demo', engineMode: 'demo', reason: '시연용 과거 기록', at }] : [];
  const chat = (id: string, ago: number, recipients: string[], user: string, reply: string, feedback: CardFeedback[]): PastChat =>
    ({ id, at: day(ago), title: user, recipients, messages: [{ role: 'user', text: user }, { role: 'assistant', text: reply }], feedback, demo: true });
  return [
    chat('demo-1', 3, ['어머니'], '엄마 생신 선물 5만원 안쪽으로 추천해줘', '어머니 생일 선물로 5만 원 이하 상품을 골랐어요.',
      [...fb('demo-1', beautyA, true, day(3), 1), ...fb('demo-1', snack, false, day(3), 2)]),
    chat('demo-2', 10, ['친구'], '친구 합격 축하 선물 3만원', '합격 축하 선물로 3만 원 이하 상품을 골랐어요.',
      fb('demo-2', beautyB, true, day(10), 1)),
    chat('demo-3', 20, ['직장동료'], '직장 동료 선물, 먹는 건 빼주세요', '식품을 제외하고 직장 동료에게 어울리는 상품을 골랐어요.',
      fb('demo-3', teaA, false, day(20), 3)),
  ];
}
