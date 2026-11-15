import { normalizeConditions } from '../../../lib/condition-compat.mjs';
import { validateState } from '../../../lib/llm.mjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { decodeGifts } from '../storage.ts';
import type { ChatMessage, ChatSession, ConversationSummary, SavedConversation, Gift, GiftRecords } from '../domain';
import { decodeFeedback, stampConversation, type CardFeedback } from '../cardFeedback.ts';
import { canonicalRecipient } from './personalization.ts';

const keyOf = (gift: Gift) => `${gift.source ?? 'prototype'}:${gift.id}`;
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function check(error: { message: string } | null) { if (error) throw new Error(error.message); }
function validSession(value: unknown): value is ChatSession['state'] {
  if (!value || typeof value !== 'object') return false;
  const s = value as ChatSession['state'];
  return ['recipients', 'preferences', 'excluded_categories', 'excluded_ingredients'].every(k =>
    Array.isArray(s[k as keyof typeof s]) && (s[k as keyof typeof s] as unknown[]).every(v => typeof v === 'string')) &&
    !!s.budget && (s.budget.amount_krw === null || Number.isFinite(s.budget.amount_krw)) &&
    (s.budget.shipping_included === null || typeof s.budget.shipping_included === 'boolean') &&
    ['occasion', 'brand', 'delivery_by', 'packaging'].every(k => s[k as keyof typeof s] === null || typeof s[k as keyof typeof s] === 'string');
}

// One instance per mounted account. Ownership is fixed, never read from mutable UI state.
export function createCloudRecords(client: SupabaseClient, owner: string, uuid: () => string) {
  let active = true;
  let queue: Promise<void> = Promise.resolve();
  let previous: GiftRecords = { saved: [], recent: [] };
  const attemptedKeys = { saved: new Set<string>(), recent: new Set<string>() };
  let conversationId: string | null = null;
  let messageIds: string[] = [];
  let messageTimes: string[] = [];
  let previousMessages: ChatMessage[] = [];
  // Card feedback is held in memory and rides on the next chat commit; saveFeedback() is the single
  // lighter write used when nothing else saved it. `written` is what the server last acknowledged.
  let feedbackState: CardFeedback[] = [];
  let written = '[]';
  let committed: { id: string; state: ChatSession['state']; ids: string[]; issues: string[]; recommendations: Gift[] } | null = null;
  async function assertOwner() {
    if (!active) throw new Error('계정이 변경되어 저장을 취소했어요.');
    const { data, error } = await client.auth.getSession(); check(error);
    if (!active || data.session?.user.id !== owner) throw new Error('다시 로그인해주세요.');
  }
  function enqueue(task: () => Promise<void>) {
    const next = queue.then(async () => { await assertOwner(); await task(); });
    queue = next.catch(() => {});
    return next;
  }
  async function loadGifts() {
    const rows: { kind: string; snapshot: Gift & { _pass_position?: number } }[] = [];
    for (let offset = 0; ; offset += 500) {
      const result = await client.from('gift_records').select('kind,snapshot').eq('user_id', owner).in('kind', ['saved', 'recent'])
        .order('updated_at', { ascending: false }).order('id', { ascending: true }).range(offset, offset + 499);
      check(result.error);
      rows.push(...(result.data ?? []));
      if ((result.data ?? []).length < 500) return rows;
    }
  }
  async function readConversation(row: any): Promise<SavedConversation> {
    const meta = row.conditions?._pass;
    if (!meta || meta.committed !== true || !Array.isArray(meta.message_ids)) throw new Error('대화 기록 형식이 올바르지 않아요.');
    const messages: ChatMessage[] = [];
    for (let offset = 0; offset < meta.message_ids.length; offset += 100) {
      const ids = meta.message_ids.slice(offset, offset + 100);
      const result = await client.from('messages').select('id,role,content').eq('user_id', owner).eq('conversation_id', row.id).in('id', ids);
      check(result.error);
      const found = new Map((result.data ?? []).map((message: any) => [message.id, message]));
      for (const id of ids) {
        const message: any = found.get(id);
        if (!message || !['user', 'assistant'].includes(message.role) || typeof message.content !== 'string') throw new Error('대화 메시지를 불러오지 못했어요.');
        messages.push({ role: message.role, text: message.content });
      }
    }
    const products = Array.isArray(meta.recommendations) ? decodeGifts(JSON.stringify(meta.recommendations)) : [];
    return { id: row.id, title: row.title ?? '', updatedAt: row.updated_at, recipient: Array.isArray(row.conditions?.recipients) && row.conditions.recipients.length === 1 ? row.conditions.recipients[0] : null, messages, products };
  }
  return {
    close() { active = false; },
    async listConversations(): Promise<ConversationSummary[]> {
      await assertOwner();
      const rows: any[] = [];
      for (let offset = 0; ; offset += 500) {
        const result = await client.from('conversations').select('id,title,updated_at,conditions').eq('user_id', owner).eq('conditions->_pass->>committed', 'true').order('updated_at', { ascending: false }).range(offset, offset + 499);
        check(result.error); rows.push(...(result.data ?? []));
        if ((result.data ?? []).length < 500) break;
      }
      return rows.map((row: any) => ({ id: row.id, title: row.title ?? '', updatedAt: row.updated_at, recipient: Array.isArray(row.conditions?.recipients) && row.conditions.recipients.length === 1 ? row.conditions.recipients[0] : null }));
    },
    async getConversation(id: string): Promise<SavedConversation> {
      await assertOwner();
      const result = await client.from('conversations').select('id,title,updated_at,conditions').eq('user_id', owner).eq('id', id).limit(1);
      check(result.error);
      if (!result.data?.[0]) throw new Error('대화 기록을 찾을 수 없어요.');
      return readConversation(result.data[0]);
    },
    async getRecipientHistory(recipient: string): Promise<Pick<ChatSession['state'], 'preferences' | 'excluded_categories' | 'excluded_ingredients'> | null> {
      await assertOwner();
      let match: any = null;
      for (let offset = 0; ; offset += 500) {
        const result = await client.from('conversations').select('conditions').eq('user_id', owner).eq('conditions->_pass->>committed', 'true').order('updated_at', { ascending: false }).range(offset, offset + 499);
        check(result.error);
        match = (result.data ?? []).find((row: any) => Array.isArray(row.conditions?.recipients) && row.conditions.recipients.length === 1 && canonicalRecipient(row.conditions.recipients[0]) === canonicalRecipient(recipient));
        if (match || (result.data ?? []).length < 500) break;
      }
      if (!match) return null;
      const normalized = normalizeConditions(match.conditions).state;
      return { preferences: normalized.preferences, excluded_categories: normalized.excluded_categories, excluded_ingredients: normalized.excluded_ingredients };
    },
    async deleteConversation(id: string): Promise<void> {
      await enqueue(async () => {
        const result = await client.from('conversations').delete().eq('user_id', owner).eq('id', id);
        check(result.error);
        if (conversationId === id) { conversationId = null; messageIds = []; messageTimes = []; previousMessages = []; committed = null; }
      });
    },
    async load(emptySession: ChatSession) {
      await assertOwner();
      const [gifts, chats] = await Promise.all([
        loadGifts(),
        client.from('conversations').select('id,conditions').eq('user_id', owner).eq('conditions->_pass->>committed', 'true').order('updated_at', { ascending: false }).limit(1),
      ]);
      check(chats.error);
      const records: GiftRecords = { saved: [], recent: [] };
      for (const kind of ['saved', 'recent'] as const) {
        const rows = gifts.filter(row => row.kind === kind);
        rows.sort((a, b) => (a.snapshot._pass_position ?? 0) - (b.snapshot._pass_position ?? 0));
        records[kind] = decodeGifts(JSON.stringify(rows.map(row => row.snapshot)));
      }
      const conversation = chats.data?.[0];
      let session = copy(emptySession), messages: ChatMessage[] = [];
      let migrationNotice = '';
      let feedback: CardFeedback[] = [];
      if (conversation) {
        const { _pass, ...state } = conversation.conditions;
        if (!validSession(state) || !_pass || _pass.version !== 1 || !Array.isArray(_pass.message_ids) ||
          !_pass.message_ids.every((v: unknown) => typeof v === 'string') || !Array.isArray(_pass.issues) ||
          !_pass.issues.every((v: unknown) => typeof v === 'string')) throw new Error('대화 기록 형식을 확인할 수 없어요.');
        const ids: string[] = _pass.message_ids;
        const found = new Map<string, { role: ChatMessage['role']; content: string; created_at: string }>();
        for (let offset = 0; offset < ids.length; offset += 100) {
          const result = await client.from('messages').select('id,role,content,created_at').eq('user_id', owner)
            .eq('conversation_id', conversation.id).in('id', ids.slice(offset, offset + 100));
          check(result.error);
          for (const row of result.data ?? []) found.set(row.id, row);
        }
        for (const id of ids) {
          const row = found.get(id);
          if (!row || !['user', 'assistant'].includes(row.role) || typeof row.content !== 'string') throw new Error('대화 기록 일부를 불러오지 못했어요.');
          messages.push({ role: row.role, text: row.content });
        }
        const normalized = normalizeConditions(state);
        validateState(normalized.state);
        session = { state: normalized.state, issues: _pass.issues };
        if (normalized.notices.length) migrationNotice = `${normalized.notices.join(' ')} 조건 편집창에서 범위를 확인해주세요.`;
        conversationId = conversation.id;
        feedback = decodeFeedback(_pass.feedback);
        const recommendations = Array.isArray(_pass.recommendations) ? decodeGifts(JSON.stringify(_pass.recommendations)) : [];
        committed = { id: conversation.id, state: session.state, ids, issues: session.issues, recommendations };
        messageIds = ids;
        messageTimes = ids.map(id => found.get(id)!.created_at);
      }
      previous = copy(records);
      previousMessages = copy(messages);
      feedbackState = copy(feedback); written = JSON.stringify(feedback);
      return { ...records, session, messages, migrationNotice, feedback };
    },
    // Memory only, no request. The conversation id is stamped when a save is enqueued.
    setFeedback(value: CardFeedback[]) { feedbackState = copy(value); },
    saveFeedback() {
      const id = conversationId;
      if (!id) return Promise.resolve();
      const feedback = stampConversation(copy(feedbackState), id);
      if (JSON.stringify(feedback) === written) return Promise.resolve();
      return enqueue(async () => {
        // Not committed yet (or a newer conversation took over): the next chat commit carries it.
        if (!committed || committed.id !== id) return;
        if (JSON.stringify(feedback) === written) return; // a chat commit already carried it
        const update = await client.from('conversations').update({ conditions: { ...committed.state, _pass: { version: 1, committed: true, message_ids: committed.ids, issues: committed.issues, feedback, recommendations: committed.recommendations } } }).eq('id', id).eq('user_id', owner);
        check(update.error);
        written = JSON.stringify(feedback);
      });
    },
    saveGifts(value: GiftRecords) {
      const snapshot = copy(value);
      return enqueue(async () => {
        for (const kind of ['saved', 'recent'] as const) {
          const before = new Map(previous[kind].map((gift, position) => [keyOf(gift), { ...gift, _pass_position: position }]));
          const after = new Map(snapshot[kind].map((gift, position) => [keyOf(gift), { ...gift, _pass_position: position }]));
          const changed = [...after].filter(([key, gift]) => JSON.stringify(before.get(key)) !== JSON.stringify(gift));
          if (changed.length) {
            // A failed response can still follow a successful server write. Track all
            // attempted additions until the complete collection save is acknowledged.
            for (const [key] of changed) attemptedKeys[kind].add(key);
            const changedKeys = new Set(changed.map(([key]) => key));
            previous[kind] = previous[kind].filter(gift => !changedKeys.has(keyOf(gift)));
            const result = await client.from('gift_records').upsert(changed.map(([key, gift]) => ({ user_id: owner, kind, gift_key: key, snapshot: gift })), { onConflict: 'user_id,kind,gift_key' });
            check(result.error);
          }
          // Delete only items actually removed here, preserving unseen records from other devices.
          const removed = [...new Set([...before.keys(), ...attemptedKeys[kind]])].filter(key => !after.has(key));
          if (removed.length) {
            for (const key of removed) attemptedKeys[kind].add(key);
            previous[kind] = previous[kind].filter(gift => !removed.includes(keyOf(gift)));
            const result = await client.from('gift_records').delete().eq('user_id', owner).eq('kind', kind).in('gift_key', removed);
            check(result.error);
          }
          previous[kind] = copy(snapshot[kind]);
          attemptedKeys[kind].clear();
        }
      });
    },
    saveChat(sessionValue: ChatSession, messagesValue: ChatMessage[], recommendationsValue?: Gift[]) {
      const session = copy(sessionValue), messages = copy(messagesValue);
      if (messages.some(message => !message.text || [...message.text].length > 16000)) return Promise.reject(new Error('메시지는 16,000자까지 저장할 수 있어요.'));
      // Reserve IDs at enqueue time so a failed request can be retried without duplicates.
      const isNew = !conversationId || messages.length < previousMessages.length || previousMessages.some((message, index) => JSON.stringify(message) !== JSON.stringify(messages[index]));
      if (isNew) { conversationId = uuid(); messageIds = []; messageTimes = []; }
      const recommendations = recommendationsValue === undefined && !isNew ? committed?.recommendations ?? [] : decodeGifts(JSON.stringify((recommendationsValue ?? []).slice(0, 12)));
      const id = conversationId!;
      for (let index = messageIds.length; index < messages.length; index++) { messageIds.push(uuid()); messageTimes.push(new Date().toISOString()); }
      const ids = messageIds.slice(0, messages.length), times = messageTimes.slice(0, messages.length);
      const feedback = stampConversation(copy(feedbackState), id);
      previousMessages = copy(messages);
      return enqueue(async () => {
        // Initial row is retry-safe. The final conditions update commits the ordered message IDs.
        // Readers ignore messages from an interrupted write until that commit succeeds.
        const create = await client.from('conversations').upsert({ id, user_id: owner, conditions: { ...session.state, _pass: { version: 1, committed: false, message_ids: [], issues: [], feedback: [], recommendations: [] } } }, { onConflict: 'id', ignoreDuplicates: true });
        check(create.error);
        if (messages.length) {
          const result = await client.from('messages').upsert(messages.map((message, index) => ({ id: ids[index], conversation_id: id, user_id: owner, role: message.role, content: message.text, created_at: times[index] })), { onConflict: 'id' });
          check(result.error);
        }
        const commit = await client.from('conversations').update({ conditions: { ...session.state, _pass: { version: 1, committed: true, message_ids: ids, issues: session.issues, feedback, recommendations } }, title: messages.find(message => message.role === 'user')?.text.slice(0, 80) ?? '' }).eq('id', id).eq('user_id', owner);
        check(commit.error);
        committed = { id, state: session.state, ids, issues: session.issues, recommendations };
        written = JSON.stringify(feedback);
      });
    },
  };
}
