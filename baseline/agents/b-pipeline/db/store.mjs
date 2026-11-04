// node:sqlite store (K6: zero dependencies). Every query is filtered by owner_id (AC6).
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  checkOwner, recipientInput, RECIPIENT_FIELDS, memoryInput, MEMORY_EDITABLE, giftInput,
  sessionInput, eventInput, versionConflict, notFound, StoreError,
} from './contract.mjs';

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

const toRecipient = r => r && {
  id: r.id, ownerId: r.owner_id, name: r.name, aliases: JSON.parse(r.aliases), groupName: r.group_name,
  budgetCapKrw: r.budget_cap_krw, priceSensitivity: r.price_sensitivity, createdAt: r.created_at,
};
const toMemory = m => m && {
  id: m.id, recipientId: m.recipient_id, key: m.key, polarity: m.polarity, strength: m.strength,
  status: m.status, source: m.source, evidence: m.evidence, signals: JSON.parse(m.signals ?? '[]'), createdAt: m.created_at, lastUsedAt: m.last_used_at,
};
const toGift = g => g && { id: g.id, recipientId: g.recipient_id, productId: g.product_id, occasion: g.occasion, givenAt: g.given_at, satisfaction: g.satisfaction };

/** path ':memory:' (default) or a file path such as PIPELINE_DB_PATH. */
export function createSqliteStore({ path = ':memory:', now = () => new Date().toISOString(), newId = randomUUID } = {}) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('pragma foreign_keys = on;');
  db.exec(SCHEMA);
  if (!db.prepare('pragma table_info(memories)').all().some(c => c.name === 'signals')) db.exec("alter table memories add column signals text not null default '[]'");
  const q = sql => db.prepare(sql);
  const ownRecipient = (ownerId, id) => q('select * from recipients where id = ? and owner_id = ?').get(id, ownerId);
  const ownMemory = (ownerId, id) => q('select m.* from memories m join recipients r on r.id = m.recipient_id where m.id = ? and r.owner_id = ?').get(id, ownerId);

  return {
    kind: 'sqlite',
    async createRecipient(ownerId, input) {
      checkOwner(ownerId);
      const v = recipientInput(input), id = newId();
      q('insert into recipients(id, owner_id, name, aliases, group_name, budget_cap_krw, price_sensitivity, created_at) values (?,?,?,?,?,?,?,?)')
        .run(id, ownerId, v.name, JSON.stringify(v.aliases), v.groupName, v.budgetCapKrw, v.priceSensitivity, now());
      return toRecipient(ownRecipient(ownerId, id));
    },
    async listRecipients(ownerId) { checkOwner(ownerId); return q('select * from recipients where owner_id = ? order by created_at, rowid').all(ownerId).map(toRecipient); },
    async getRecipient(ownerId, id) { checkOwner(ownerId); return toRecipient(ownRecipient(ownerId, id)) ?? null; },
    async updateRecipient(ownerId, id, patch) {
      checkOwner(ownerId);
      const r = toRecipient(ownRecipient(ownerId, id)); if (!r) notFound();
      if (Object.keys(patch).some(k => !RECIPIENT_FIELDS.includes(k))) throw new StoreError('invalid_store_input');
      const v = recipientInput({ ...r, ...patch });
      q('update recipients set name = ?, aliases = ?, group_name = ?, budget_cap_krw = ?, price_sensitivity = ? where id = ? and owner_id = ?')
        .run(v.name, JSON.stringify(v.aliases), v.groupName, v.budgetCapKrw, v.priceSensitivity, id, ownerId);
      return toRecipient(ownRecipient(ownerId, id));
    },
    async deleteRecipient(ownerId, id) { checkOwner(ownerId); return q('delete from recipients where id = ? and owner_id = ?').run(id, ownerId).changes > 0; },

    async addMemory(ownerId, input) {
      checkOwner(ownerId);
      const v = memoryInput(input);
      if (!ownRecipient(ownerId, v.recipientId)) notFound();
      const id = newId();
      q('insert into memories(id, recipient_id, key, polarity, strength, status, source, evidence, signals, created_at) values (?,?,?,?,?,?,?,?,?,?)')
        .run(id, v.recipientId, v.key, v.polarity, v.strength, v.status, v.source, v.evidence, JSON.stringify(v.signals), now());
      return toMemory(ownMemory(ownerId, id));
    },
    async listMemories(ownerId, recipientId, { status } = {}) {
      checkOwner(ownerId);
      const rows = q(`select m.* from memories m join recipients r on r.id = m.recipient_id
        where m.recipient_id = ? and r.owner_id = ? ${status ? 'and m.status = ?' : ''} order by m.created_at, m.rowid`)
        .all(...[recipientId, ownerId, ...(status ? [status] : [])]);
      return rows.map(toMemory);
    },
    async getMemory(ownerId, id) { checkOwner(ownerId); return toMemory(ownMemory(ownerId, id)) ?? null; },
    async updateMemory(ownerId, id, patch) {
      checkOwner(ownerId);
      const m = toMemory(ownMemory(ownerId, id)); if (!m) notFound();
      if (Object.keys(patch).some(k => !MEMORY_EDITABLE.includes(k))) throw new StoreError('invalid_store_input');
      const v = memoryInput({ ...m, ...patch });
      q('update memories set polarity = ?, strength = ?, status = ?, evidence = ?, signals = ? where id = ?').run(v.polarity, v.strength, v.status, v.evidence, JSON.stringify(v.signals), id);
      return toMemory(ownMemory(ownerId, id));
    },
    async deleteMemory(ownerId, id) {
      checkOwner(ownerId);
      if (!ownMemory(ownerId, id)) return false;
      return q('delete from memories where id = ?').run(id).changes > 0;
    },
    async touchMemories(ownerId, ids, at = now()) {
      checkOwner(ownerId);
      for (const id of ids) if (ownMemory(ownerId, id)) q('update memories set last_used_at = ? where id = ?').run(at, id);
    },

    async addGift(ownerId, input) {
      checkOwner(ownerId);
      const v = giftInput(input);
      if (!ownRecipient(ownerId, v.recipientId)) notFound();
      const id = newId();
      q('insert into gift_history(id, recipient_id, product_id, occasion, given_at, satisfaction) values (?,?,?,?,?,?)')
        .run(id, v.recipientId, v.productId, v.occasion, v.givenAt, v.satisfaction);
      return toGift(q('select * from gift_history where id = ?').get(id));
    },
    async listGifts(ownerId, recipientId) {
      checkOwner(ownerId);
      return q('select g.* from gift_history g join recipients r on r.id = g.recipient_id where g.recipient_id = ? and r.owner_id = ? order by g.rowid')
        .all(recipientId, ownerId).map(toGift);
    },
    async updateGift(ownerId, id, { satisfaction }) {
      checkOwner(ownerId);
      const g = toGift(q('select g.* from gift_history g join recipients r on r.id = g.recipient_id where g.id = ? and r.owner_id = ?').get(id, ownerId));
      if (!g) notFound();
      const v = giftInput({ ...g, satisfaction });
      q('update gift_history set satisfaction = ? where id = ?').run(v.satisfaction, id);
      return { ...g, satisfaction: v.satisfaction };
    },

    async insertSession(ownerId, session, meta = {}) {
      checkOwner(ownerId);
      const v = sessionInput(session, meta);
      try {
        q('insert into sessions(id, owner_id, version, state, meta, updated_at) values (?,?,?,?,?,?)')
          .run(v.session.id, ownerId, v.session.version, JSON.stringify(v.session.state), JSON.stringify(v.meta), now());
      } catch (e) {
        if (/UNIQUE|PRIMARY KEY/i.test(e.message)) throw new StoreError('session_exists');
        throw e;
      }
      return v;
    },
    async getSession(ownerId, id) {
      checkOwner(ownerId);
      const row = q('select * from sessions where id = ? and owner_id = ?').get(id, ownerId);
      if (!row) return null;
      const out = { session: { id: row.id, version: row.version, state: JSON.parse(row.state) }, meta: JSON.parse(row.meta) };
      sessionInput(out.session, out.meta); // stored data is re-validated, never trusted
      return out;
    },
    /** Compare-and-set: UPDATE … WHERE version = expectedVersion (TRD §4-6). */
    async saveSession(ownerId, session, meta, expectedVersion) {
      checkOwner(ownerId);
      const v = sessionInput(session, meta);
      if (!Number.isSafeInteger(expectedVersion)) throw new StoreError('invalid_store_input');
      const res = q('update sessions set version = ?, state = ?, meta = ?, updated_at = ? where id = ? and owner_id = ? and version = ?')
        .run(v.session.version, JSON.stringify(v.session.state), JSON.stringify(v.meta), now(), v.session.id, ownerId, expectedVersion);
      if (res.changes !== 1) versionConflict();
      return v;
    },

    async logEvent(input) {
      const e = eventInput(input);
      q('insert into events(session_id, type, payload, at) values (?,?,?,?)').run(e.sessionId, e.type, JSON.stringify(e.payload), now());
    },
    async listEvents(sessionId) {
      return q('select * from events where session_id = ? order by id').all(sessionId)
        .map(e => ({ id: e.id, sessionId: e.session_id, type: e.type, payload: JSON.parse(e.payload), at: e.at }));
    },
    close() { db.close(); },
  };
}
