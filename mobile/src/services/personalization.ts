import { extract, initial } from '../../../lib/engine.mjs';
import type { ChatSession, Conditions, Gift } from '../domain.ts';

export type RecipientMemory = {
  recipient: string;
  preferences: string[];
  excluded_categories: string[];
  excluded_ingredients: string[];
  updatedAt: string;
};
export type PurchaseRecord = {
  id: string;
  recipient: string;
  gift: Gift;
  feedback: 'unknown' | 'liked' | 'disliked';
  source: 'user_reported';
  recordedAt: string;
};
export type Personalization = { memories: RecipientMemory[]; purchases: PurchaseRecord[] };
export const emptyPersonalization = (): Personalization => ({ memories: [], purchases: [] });
const unique = (values: string[]) => [...new Set(values)];
const recipientAliases: Record<string, string> = {
  어머니: '어머니', 엄마: '어머니', 아버지: '아버지', 아빠: '아버지',
  부모님: '부모님', 처가: '처가', 교수님: '교수님', '직장 상사': '직장 상사', 친구: '친구',
};
export function recipientsInText(text: string) {
  return unique(Object.entries(recipientAliases).filter(([word]) => text.includes(word)).map(([, name]) => name));
}
export function rememberConditions(data: Personalization, state: Conditions, now: string): Personalization {
  if (state.recipients.length !== 1) throw new Error('한 명의 수령인을 정한 뒤 기억해주세요.');
  const recipient = state.recipients[0];
  const old = data.memories.find(m => m.recipient === recipient);
  const memory: RecipientMemory = {
    recipient, preferences: [...state.preferences], excluded_categories: [...state.excluded_categories],
    excluded_ingredients: unique([...(old?.excluded_ingredients ?? []), ...state.excluded_ingredients]), updatedAt: now,
  };
  return { ...data, memories: [memory, ...data.memories.filter(m => m.recipient !== recipient)].slice(0, 100) };
}
const categoryKeys: Record<string, string> = { 과일: 'fruit', 한과: 'hangwa', 견과류: 'nuts', 차: 'tea', 커피: 'coffee', 오일: 'oil', 기름: 'oil' };
// Current explicit preferences outrank inferred purchase preferences. Never infer allergies from purchases.
export function personalizeSession(session: ChatSession, data: Personalization, text = '') {
  const mentioned = recipientsInText(text);
  const recipients = mentioned.length ? mentioned : session.state.recipients;
  const prepared = switchRecipient(session, recipients);
  const state = prepared.state;
  const reasons: string[] = [];
  if (recipients.length !== 1) return { session: { state, issues: prepared.issues }, reasons };
  const recipient = recipients[0];
  const memory = data.memories.find(m => m.recipient === recipient);
  if (memory) {
    state.excluded_ingredients = unique([...state.excluded_ingredients, ...memory.excluded_ingredients]);
    state.excluded_categories = unique([...state.excluded_categories, ...memory.excluded_categories]);
    if (!state.preferences.length) state.preferences = [...memory.preferences];
    reasons.push(`${recipient}의 저장된 선호·제외 조건을 반영했어요.`);
  }
  const explicit = (extract(text, initial()).patch as Partial<Conditions>).preferences;
  if (explicit?.length) state.preferences = explicit;
  if (!state.preferences.length) {
    const liked = data.purchases.filter(p => p.recipient === recipient && p.feedback === 'liked');
    const preferences = unique(liked.map(p => categoryKeys[p.gift.category] ?? (['fruit', 'hangwa', 'nuts', 'tea', 'coffee', 'oil'].includes(p.gift.category) ? p.gift.category : '')).filter(Boolean));
    if (preferences.length) {
      state.preferences = preferences.map(category => `category:${category}`);
      reasons.push(`${recipient}에게 구매 후 만족했다고 등록한 상품의 종류를 참고했어요.`);
    }
  }
  return { session: { state, issues: prepared.issues }, reasons };
}

export function decodePersonalization(raw: string | null): Personalization {
  if (!raw) return emptyPersonalization();
  const data = JSON.parse(raw) as Personalization;
  const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
  if (!data || !Array.isArray(data.memories) || !Array.isArray(data.purchases) || data.memories.length > 100 || data.purchases.length > 100 ||
    data.memories.some(m => !m || typeof m.recipient !== 'string' || !m.recipient.trim() || !strings(m.preferences) || !strings(m.excluded_categories) || !strings(m.excluded_ingredients) || typeof m.updatedAt !== 'string') ||
    data.purchases.some(p => !p || typeof p.id !== 'string' || typeof p.recipient !== 'string' || !p.recipient.trim() || p.source !== 'user_reported' || !['unknown', 'liked', 'disliked'].includes(p.feedback) || typeof p.recordedAt !== 'string' || !p.gift || typeof p.gift.id !== 'string' || typeof p.gift.name !== 'string' || typeof p.gift.category !== 'string')) throw new Error('개인화 기록을 읽을 수 없어요.');
  return data;
}
export function createPersonalizationRepository(storage: { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> }, owner: string | null) {
  const key = `pass.personalization.v1.${owner ? `account:${owner}` : 'guest'}`;
  let loaded = false;
  let writes = Promise.resolve();
  return {
    async load() { loaded = false; await writes; const data = decodePersonalization(await storage.getItem(key)); loaded = true; return data; },
    save(data: Personalization) {
      if (!loaded) return Promise.reject(new Error('먼저 개인화 기록을 불러와주세요.'));
      const snapshot = JSON.stringify(data);
      const task = writes.then(() => storage.setItem(key, snapshot));
      writes = task.catch(() => {});
      return task;
    },
  };
}

// Even an LLM patch or condition editor cannot silently remove a remembered allergy.
export function protectRememberedAllergies(session: ChatSession, data: Personalization): ChatSession {
  if (session.state.recipients.length !== 1) return session;
  const memory = data.memories.find(m => m.recipient === session.state.recipients[0]);
  if (!memory) return session;
  return { ...session, state: { ...session.state, excluded_ingredients: unique([...session.state.excluded_ingredients, ...memory.excluded_ingredients]) } };
}

export function switchRecipient(session: ChatSession, recipients: string[]): ChatSession {
  if (JSON.stringify(recipients) === JSON.stringify(session.state.recipients)) return structuredClone(session);
  return { state: { ...structuredClone(session.state), recipients: [...recipients], preferences: [], excluded_categories: [], excluded_ingredients: [] }, issues: [] };
}
