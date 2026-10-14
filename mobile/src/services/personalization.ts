import { validateState } from '../../../lib/llm.mjs';
import { decodeGifts } from '../storage.ts';
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
export const canonicalRecipient = (name: string) => recipientAliases[name.trim()] ?? name.trim();
const canonicalRecipients = (names: string[]) => unique(names.map(canonicalRecipient));

export function rememberConditions(data: Personalization, state: Conditions, now: string, issues: string[] = []): Personalization {
  if (state.recipients.length !== 1) throw new Error('한 명의 수령인을 정한 뒤 기억해주세요.');
  if (issues.length) throw new Error('확인 중인 질문에 답한 뒤 조건을 기억해주세요.');
  const recipient = canonicalRecipient(state.recipients[0]);
  if (!recipient) throw new Error('받는 분을 입력해주세요.');
  const old = data.memories.find(m => canonicalRecipient(m.recipient) === recipient);
  const memory: RecipientMemory = {
    recipient, preferences: [...state.preferences], excluded_categories: [...state.excluded_categories],
    excluded_ingredients: unique([...(old?.excluded_ingredients ?? []), ...state.excluded_ingredients]), updatedAt: now,
  };
  validateState({ ...state, recipients: [recipient], ...memoryConditions(memory) });
  const rest = data.memories.filter(m => canonicalRecipient(m.recipient) !== recipient);
  if (rest.length >= 100) throw new Error('기억은 100명까지 저장할 수 있어요. 기존 기억을 직접 삭제한 뒤 저장해주세요.');
  return { ...data, memories: [memory, ...rest] };
}
const categoryKeys: Record<string, string> = { 과일: 'fruit', 한과: 'hangwa', 견과류: 'nuts', 차: 'tea', 커피: 'coffee', 오일: 'oil', 기름: 'oil', 전통차: 'tea', '신선 과일': 'fruit' };
// Current explicit preferences outrank inferred purchase preferences. Never infer allergies from purchases.
export function personalizeSession(session: ChatSession, data: Personalization, text = '', recipientsOverride?: string[]) {
  const mentioned = recipientsInText(text);
  const recipients = canonicalRecipients(recipientsOverride ?? (mentioned.length ? mentioned : session.state.recipients));
  const recall = JSON.stringify(recipients) !== JSON.stringify(canonicalRecipients(session.state.recipients));
  const prepared = switchRecipient(session, recipients);
  const state = prepared.state;
  const reasons: string[] = [];
  if (recipients.length !== 1) return { session: { state, issues: prepared.issues }, reasons };
  const recipient = state.recipients[0];
  const memory = data.memories.find(m => canonicalRecipient(m.recipient) === recipient);
  if (memory && recall) {
    state.excluded_ingredients = unique([...state.excluded_ingredients, ...memory.excluded_ingredients]);
    state.excluded_categories = unique([...state.excluded_categories, ...memory.excluded_categories]);
    if (!state.preferences.length) state.preferences = [...memory.preferences];
    reasons.push(`${recipient}의 저장된 선호·제외 조건을 반영했어요.`);
  }
  const explicit = (extract(text, initial()).patch as Partial<Conditions>).preferences;
  if (explicit?.length) state.preferences = explicit;
  if (recall && !state.preferences.length) {
    const liked = data.purchases.filter(p => canonicalRecipient(p.recipient) === recipient && p.feedback === 'liked');
    const preferences = unique(liked.map(p => categoryKeys[p.gift.category] ?? (['fruit', 'hangwa', 'nuts', 'tea', 'coffee', 'oil'].includes(p.gift.category) ? p.gift.category : '')).filter(Boolean));
    if (preferences.length) {
      state.preferences = preferences.map(category => `category:${category}`);
      reasons.push(`${recipient}에게 구매 후 만족했다고 등록한 상품의 종류를 참고했어요.`);
    }
  }
  validateState(state);
  return { session: { state, issues: prepared.issues }, reasons };
}

export function decodePersonalization(raw: string | null): Personalization {
  if (!raw) return emptyPersonalization();
  const data = JSON.parse(raw) as Personalization;
  const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string');
  if (!data || !Array.isArray(data.memories) || !Array.isArray(data.purchases) || data.memories.length > 100 || data.purchases.length > 100 ||
    data.memories.some(m => !m || typeof m.recipient !== 'string' || !m.recipient.trim() || !strings(m.preferences) || !strings(m.excluded_categories) || !strings(m.excluded_ingredients) || typeof m.updatedAt !== 'string') ||
    data.purchases.some(p => !p || typeof p.id !== 'string' || typeof p.recipient !== 'string' || !p.recipient.trim() || p.source !== 'user_reported' || !['unknown', 'liked', 'disliked'].includes(p.feedback) || typeof p.recordedAt !== 'string' || !p.gift || typeof p.gift.id !== 'string' || typeof p.gift.name !== 'string' || typeof p.gift.category !== 'string')) throw new Error('개인화 기록을 읽을 수 없어요.');
  for (const memory of data.memories) validateState({ ...initialMemoryState(), recipients: [canonicalRecipient(memory.recipient)], ...memoryConditions(memory) });
  if (new Set(data.memories.map(m => canonicalRecipient(m.recipient))).size !== data.memories.length || new Set(data.purchases.map(p => p.id)).size !== data.purchases.length) throw new Error('개인화 기록의 식별자가 중복돼요.');
  if (decodeGifts(JSON.stringify(data.purchases.map(p => p.gift))).length !== data.purchases.length) throw new Error('구매 상품 정보가 올바르지 않아요.');
  return { memories: data.memories.map(m => ({ ...m, recipient: canonicalRecipient(m.recipient) })), purchases: data.purchases.map(p => ({ ...p, recipient: canonicalRecipient(p.recipient) })) };
}
export function createPersonalizationRepository(storage: { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> }, owner: string | null) {
  const key = `pass.personalization.v1.${owner ? `account:${owner}` : 'guest'}`;
  let loaded = false;
  let writes = Promise.resolve();
  return {
    async load() { loaded = false; await writes; const data = decodePersonalization(await storage.getItem(key)); loaded = true; return data; },
    save(data: Personalization) {
      if (!loaded) return Promise.reject(new Error('먼저 개인화 기록을 불러와주세요.'));
      let snapshot: string;
      try { snapshot = JSON.stringify(decodePersonalization(JSON.stringify(data))); }
      catch (error) { return Promise.reject(error); }
      const task = writes.then(() => storage.setItem(key, snapshot));
      writes = task.catch(() => {});
      return task;
    },
  };
}

// Even an LLM patch or condition editor cannot silently remove a remembered allergy.
export function protectRememberedAllergies(session: ChatSession, data: Personalization): ChatSession {
  const recipients = canonicalRecipients(session.state.recipients);
  const normalized = { ...session, state: { ...session.state, recipients } };
  if (recipients.length !== 1) return normalized;
  const memory = data.memories.find(m => canonicalRecipient(m.recipient) === recipients[0]);
  if (!memory) return normalized;
  const result = { ...normalized, state: { ...normalized.state, excluded_ingredients: unique([...session.state.excluded_ingredients, ...memory.excluded_ingredients]) } };
  validateState(result.state);
  return result;
}

export function switchRecipient(session: ChatSession, recipients: string[]): ChatSession {
  const names = canonicalRecipients(recipients);
  const oldNames = canonicalRecipients(session.state.recipients);
  if (JSON.stringify(names) === JSON.stringify(oldNames) || !oldNames.length) {
    return { ...structuredClone(session), state: { ...structuredClone(session.state), recipients: names } };
  }
  return { state: { ...structuredClone(session.state), recipients: names, preferences: [], excluded_categories: [], excluded_ingredients: [] }, issues: [] };
}

function initialMemoryState(): Conditions {
  return { recipients: [], occasion: null, budget: { amount_krw: null, shipping_included: null }, preferences: [], excluded_categories: [], excluded_ingredients: [], brand: null, delivery_by: null, packaging: null };
}
function memoryConditions(memory: RecipientMemory) {
  return { preferences: memory.preferences, excluded_categories: memory.excluded_categories, excluded_ingredients: memory.excluded_ingredients };
}

// A model must not silently change the explicit target, including when asked to change other conditions.
export function assertSameRecipient(request: ChatSession, response: ChatSession) {
  if (request.state.recipients.length && JSON.stringify(canonicalRecipients(request.state.recipients)) !== JSON.stringify(canonicalRecipients(response.state.recipients))) {
    throw new Error('받는 분을 정확히 확인하지 못했어요. 조건 편집에서 받는 분을 지정한 뒤 다시 시도해주세요.');
  }
}
