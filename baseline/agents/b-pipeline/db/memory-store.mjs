// In-memory store for tests. Same async contract as db/store.mjs (tests/store.test.mjs runs both).
import { randomUUID } from 'node:crypto';
import {
  checkOwner, recipientInput, RECIPIENT_FIELDS, memoryInput, MEMORY_EDITABLE, giftInput,
  sessionInput, eventInput, versionConflict, notFound, StoreError,
} from './contract.mjs';

export function createMemoryStore({ now = () => new Date().toISOString(), newId = randomUUID } = {}) {
  const recipients = new Map(), memories = new Map(), gifts = new Map(), sessions = new Map(), events = [];
  const clone = x => structuredClone(x);
  const ownRecipient = (ownerId, id) => { const r = recipients.get(id); return r && r.ownerId === ownerId ? r : null; };
  const ownMemory = (ownerId, id) => { const m = memories.get(id); return m && ownRecipient(ownerId, m.recipientId) ? m : null; };

  return {
    kind: 'memory',
    async createRecipient(ownerId, input) {
      checkOwner(ownerId);
      const r = { id: newId(), ownerId, ...recipientInput(input), createdAt: now() };
      recipients.set(r.id, r);
      return clone(r);
    },
    async listRecipients(ownerId) { checkOwner(ownerId); return [...recipients.values()].filter(r => r.ownerId === ownerId).map(clone); },
    async getRecipient(ownerId, id) { checkOwner(ownerId); const r = ownRecipient(ownerId, id); return r ? clone(r) : null; },
    async updateRecipient(ownerId, id, patch) {
      checkOwner(ownerId);
      const r = ownRecipient(ownerId, id); if (!r) notFound();
      if (Object.keys(patch).some(k => !RECIPIENT_FIELDS.includes(k))) throw new StoreError('invalid_store_input');
      const next = { ...r, ...recipientInput({ ...r, ...patch }) };
      recipients.set(id, next);
      return clone(next);
    },
    async deleteRecipient(ownerId, id) {
      checkOwner(ownerId);
      if (!ownRecipient(ownerId, id)) return false;
      recipients.delete(id);
      for (const [k, m] of memories) if (m.recipientId === id) memories.delete(k);
      for (const [k, g] of gifts) if (g.recipientId === id) gifts.delete(k);
      return true;
    },

    async addMemory(ownerId, input) {
      checkOwner(ownerId);
      const v = memoryInput(input);
      if (!ownRecipient(ownerId, v.recipientId)) notFound();
      const m = { id: newId(), ...v, createdAt: now(), lastUsedAt: null };
      memories.set(m.id, m);
      return clone(m);
    },
    async listMemories(ownerId, recipientId, { status } = {}) {
      checkOwner(ownerId);
      if (!ownRecipient(ownerId, recipientId)) return [];
      return [...memories.values()].filter(m => m.recipientId === recipientId && (!status || m.status === status)).map(clone);
    },
    async getMemory(ownerId, id) { checkOwner(ownerId); const m = ownMemory(ownerId, id); return m ? clone(m) : null; },
    async updateMemory(ownerId, id, patch) {
      checkOwner(ownerId);
      const m = ownMemory(ownerId, id); if (!m) notFound();
      if (Object.keys(patch).some(k => !MEMORY_EDITABLE.includes(k))) throw new StoreError('invalid_store_input');
      const next = { ...m, ...memoryInput({ ...m, ...patch }) };
      memories.set(id, next);
      return clone(next);
    },
    async deleteMemory(ownerId, id) { checkOwner(ownerId); return ownMemory(ownerId, id) ? memories.delete(id) : false; },
    async touchMemories(ownerId, ids, at = now()) {
      checkOwner(ownerId);
      for (const id of ids) { const m = ownMemory(ownerId, id); if (m) m.lastUsedAt = at; }
    },

    async addGift(ownerId, input) {
      checkOwner(ownerId);
      const v = giftInput(input);
      if (!ownRecipient(ownerId, v.recipientId)) notFound();
      const g = { id: newId(), ...v };
      gifts.set(g.id, g);
      return clone(g);
    },
    async listGifts(ownerId, recipientId) {
      checkOwner(ownerId);
      if (!ownRecipient(ownerId, recipientId)) return [];
      return [...gifts.values()].filter(g => g.recipientId === recipientId).map(clone);
    },
    async updateGift(ownerId, id, { satisfaction }) {
      checkOwner(ownerId);
      const g = gifts.get(id);
      if (!g || !ownRecipient(ownerId, g.recipientId)) notFound();
      const next = { ...g, ...giftInput({ ...g, satisfaction }) };
      gifts.set(id, next);
      return clone(next);
    },

    async insertSession(ownerId, session, meta = {}) {
      checkOwner(ownerId);
      const v = sessionInput(session, meta);
      if (sessions.has(v.session.id)) throw new StoreError('session_exists');
      sessions.set(v.session.id, { ownerId, ...v, updatedAt: now() });
      return clone(v);
    },
    async getSession(ownerId, id) {
      checkOwner(ownerId);
      const row = sessions.get(id);
      return row && row.ownerId === ownerId ? clone({ session: row.session, meta: row.meta }) : null;
    },
    /** Compare-and-set on version: succeeds only if the stored version still equals expectedVersion. */
    async saveSession(ownerId, session, meta, expectedVersion) {
      checkOwner(ownerId);
      const v = sessionInput(session, meta);
      const row = sessions.get(v.session.id);
      if (!row || row.ownerId !== ownerId || row.session.version !== expectedVersion) versionConflict();
      sessions.set(v.session.id, { ownerId, ...v, updatedAt: now() });
      return clone(v);
    },

    async logEvent(input) {
      const e = eventInput(input);
      events.push({ id: events.length + 1, ...e, at: now() });
    },
    async listEvents(sessionId) { return events.filter(e => e.sessionId === sessionId).map(clone); },
    close() {},
  };
}
