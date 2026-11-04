// Shared input checks for every store implementation (sqlite, in-memory, later Supabase).
// Vocabulary checks for memory keys live in memory/keys.mjs (P1); this layer checks shape only.
import { validateSession } from '../../../src/contracts.mjs';

export class StoreError extends Error {
  constructor(code) { super(code); this.code = code; }
}
const fail = (code = 'invalid_store_input') => { throw new StoreError(code); };
const str = (x, max = 200) => typeof x === 'string' && x.trim().length > 0 && x.length <= max;
const optStr = (x, max = 200) => x === null || x === undefined || str(x, max);

export const SENSITIVITIES = ['value', 'balanced', 'quality'];
export const STATUSES = ['confirmed', 'suggested'];
export const SOURCES = ['explicit', 'feedback', 'purchase'];
// Event payloads must not carry raw utterances or prompts (AGENTS.md rule).
const FORBIDDEN_EVENT_KEYS = new Set(['text', 'utterance', 'raw', 'prompt', 'message', 'evidence', 'apiKey', 'api_key', 'authorization']);

export function checkOwner(ownerId) { if (!str(ownerId)) fail(); }

export function recipientInput(r) {
  const v = {
    name: r.name, aliases: r.aliases ?? [], groupName: r.groupName ?? null,
    budgetCapKrw: r.budgetCapKrw ?? null, priceSensitivity: r.priceSensitivity ?? 'balanced',
  };
  if (!str(v.name) || !Array.isArray(v.aliases) || v.aliases.length > 20 || !v.aliases.every(a => str(a, 50))) fail();
  if (!optStr(v.groupName, 50)) fail();
  if (v.budgetCapKrw !== null && (!Number.isSafeInteger(v.budgetCapKrw) || v.budgetCapKrw <= 0)) fail();
  if (!SENSITIVITIES.includes(v.priceSensitivity)) fail();
  return v;
}
export const RECIPIENT_FIELDS = ['name', 'aliases', 'groupName', 'budgetCapKrw', 'priceSensitivity'];

export function memoryInput(m) {
  const v = {
    recipientId: m.recipientId, key: m.key, polarity: m.polarity, strength: m.strength ?? 0.7,
    status: m.status, source: m.source, evidence: m.evidence,
  };
  if (!str(v.recipientId) || !str(v.key, 100) || ![1, -1].includes(v.polarity)) fail();
  if (typeof v.strength !== 'number' || !(v.strength >= 0 && v.strength <= 1)) fail();
  if (!STATUSES.includes(v.status) || !SOURCES.includes(v.source) || !str(v.evidence, 200)) fail();
  return v;
}
// key/source/recipient are identity: editing them means delete + add.
export const MEMORY_EDITABLE = ['polarity', 'strength', 'status', 'evidence'];

export function giftInput(g) {
  const v = { recipientId: g.recipientId, productId: g.productId, occasion: g.occasion ?? null, givenAt: g.givenAt ?? null, satisfaction: g.satisfaction ?? null };
  if (!str(v.recipientId) || !str(v.productId) || !optStr(v.occasion, 50) || !optStr(v.givenAt, 30)) fail();
  if (v.satisfaction !== null && (!Number.isSafeInteger(v.satisfaction) || v.satisfaction < 1 || v.satisfaction > 5)) fail();
  return v;
}

/** Baseline session ({id, version, state}) is validated by the common contract; meta must be a plain JSON object. */
export function sessionInput(session, meta = {}) {
  validateSession(session);
  if (Object.keys(session).some(k => !['id', 'version', 'state'].includes(k))) fail();
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) fail();
  return { session: structuredClone(session), meta: structuredClone(meta) };
}

export function eventInput(e) {
  if (!str(e.type, 50) || !optStr(e.sessionId)) fail();
  const payload = e.payload ?? {};
  const walk = x => {
    if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { if (FORBIDDEN_EVENT_KEYS.has(k)) fail('forbidden_event_field'); walk(v); }
  };
  walk(payload);
  return { sessionId: e.sessionId ?? null, type: e.type, payload: structuredClone(payload) };
}

export const versionConflict = () => fail('version_conflict');
export const notFound = () => fail('not_found');
