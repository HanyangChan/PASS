import type { SupabaseClient } from '@supabase/supabase-js';
import { decodeGifts } from '../storage.ts';
import type { ChatMessage, ChatSession, Gift, GiftRecords } from '../domain';

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
  return {
    close() { active = false; },
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
        session = { state, issues: _pass.issues };
        conversationId = conversation.id;
        messageIds = ids;
        messageTimes = ids.map(id => found.get(id)!.created_at);
      }
      previous = copy(records);
      previousMessages = copy(messages);
      return { ...records, session, messages };
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
    saveChat(sessionValue: ChatSession, messagesValue: ChatMessage[]) {
      const session = copy(sessionValue), messages = copy(messagesValue);
      if (messages.some(message => !message.text || [...message.text].length > 16000)) return Promise.reject(new Error('메시지는 16,000자까지 저장할 수 있어요.'));
      // Reserve IDs at enqueue time so a failed request can be retried without duplicates.
      const isNew = !conversationId || messages.length < previousMessages.length || previousMessages.some((message, index) => JSON.stringify(message) !== JSON.stringify(messages[index]));
      if (isNew) { conversationId = uuid(); messageIds = []; messageTimes = []; }
      const id = conversationId!;
      for (let index = messageIds.length; index < messages.length; index++) { messageIds.push(uuid()); messageTimes.push(new Date().toISOString()); }
      const ids = messageIds.slice(0, messages.length), times = messageTimes.slice(0, messages.length);
      previousMessages = copy(messages);
      return enqueue(async () => {
        // Initial row is retry-safe. The final conditions update commits the ordered message IDs.
        // Readers ignore messages from an interrupted write until that commit succeeds.
        const create = await client.from('conversations').upsert({ id, user_id: owner, conditions: { ...session.state, _pass: { version: 1, committed: false, message_ids: [], issues: [] } } }, { onConflict: 'id', ignoreDuplicates: true });
        check(create.error);
        if (messages.length) {
          const result = await client.from('messages').upsert(messages.map((message, index) => ({ id: ids[index], conversation_id: id, user_id: owner, role: message.role, content: message.text, created_at: times[index] })), { onConflict: 'id' });
          check(result.error);
        }
        const commit = await client.from('conversations').update({ conditions: { ...session.state, _pass: { version: 1, committed: true, message_ids: ids, issues: session.issues } }, title: messages.find(message => message.role === 'user')?.text.slice(0, 80) ?? '' }).eq('id', id).eq('user_id', owner);
        check(commit.error);
      });
    },
  };
}
