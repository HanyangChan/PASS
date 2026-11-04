// Recipient resolution for the orchestrator (TRD §5.4, R9). Owner-filtered store calls only (AC6).
// Display names go into the baseline state (`recipients`); memories are linked by recipient id.
import { findRecipient } from '../memory/read.mjs';

// Fixed relation used when the DB has no group yet (first session, S1): 어머니 + 아버지 = 부모님.
// Not an inference about taste; only which display name the two people share (decisions K24).
export const KNOWN_GROUPS = { 어머니: '부모님', 아버지: '부모님' };
export const KNOWN_ALIASES = { 어머니: ['엄마', '어머님'], 아버지: ['아빠', '아버님'] };
const NEW = 'new:'; // placeholder id for a person who has no row yet; replaced on memory confirm
export const isNewRecipientId = id => typeof id === 'string' && id.startsWith(NEW);
export const newRecipientId = name => `${NEW}${name}`;

/** Resolve one mention to owner rows. A group name (부모님) means both people unless a choice says otherwise. */
export async function resolveMention(store, ownerId, name, choice = 'together') {
  const r = await findRecipient(store, ownerId, name, { choice });
  return r.status === 'found' ? r.recipients : [];
}

/**
 * R9: two people who share a group (['어머니','아버지']) become one display recipient (['부모님']).
 * Returns the display list for the state and the ids of every person behind it.
 */
export async function resolveRecipients(store, ownerId, names, { choice } = {}) {
  const rows = [], groups = [];
  for (const name of names) {
    const found = await resolveMention(store, ownerId, name, choice);
    rows.push(...found.filter(r => !rows.some(x => x.id === r.id)));
    groups.push(found.length === 1 ? (found[0].groupName ?? KNOWN_GROUPS[name] ?? null) : found.length > 1 ? name : (KNOWN_GROUPS[name] ?? null));
  }
  let display = [...new Set(names)];
  if (display.length > 1 && groups.every(g => g && g === groups[0])) display = [groups[0]];
  if (choice && choice !== 'together' && rows.length === 1 && rows[0].id === choice) display = [rows[0].name]; // "어머니만"
  // A person without a row keeps a placeholder so a purchase or a confirmed memory can still be linked later.
  const ids = [...rows.map(r => r.id)];
  for (const name of names) {
    if ((await resolveMention(store, ownerId, name, choice)).length) continue;
    const people = KNOWN_GROUPS[name] ? [name] : Object.keys(KNOWN_GROUPS).filter(k => KNOWN_GROUPS[k] === name);
    for (const person of people.length ? people : [name]) if (!ids.includes(newRecipientId(person))) ids.push(newRecipientId(person));
  }
  return { display, ids, rows };
}

/**
 * Link each memory candidate to a person. A group mention (부모님) expands to every member.
 * A person without a row gets a `new:<name>` placeholder; a row is created only if the user confirms.
 */
export async function linkCandidates(store, ownerId, candidates) {
  const out = [];
  for (const c of candidates) {
    const rows = await resolveMention(store, ownerId, c.recipientName);
    const members = Object.keys(KNOWN_GROUPS).filter(k => KNOWN_GROUPS[k] === c.recipientName);
    const targets = rows.length ? rows.map(r => ({ id: r.id, name: r.name }))
      : (members.length ? members : [c.recipientName]).map(name => ({ id: newRecipientId(name), name }));
    for (const t of targets) {
      const linked = { ...c, recipientId: t.id, recipientName: t.name };
      if (!out.some(x => x.recipientId === linked.recipientId && x.key === linked.key && x.polarity === linked.polarity)) out.push(linked);
    }
  }
  return out;
}

/** Create rows for confirmed items whose person did not exist yet. Returns the items with real ids. */
export async function materialize(store, ownerId, items) {
  const made = new Map();
  const out = [];
  for (const c of items) {
    if (!isNewRecipientId(c.recipientId)) { out.push(c); continue; }
    const name = c.recipientId.slice(NEW.length);
    if (!made.has(name)) {
      const existing = await resolveMention(store, ownerId, name);
      made.set(name, existing.length === 1 ? existing[0] : await store.createRecipient(ownerId, {
        name, aliases: KNOWN_ALIASES[name] ?? [], groupName: KNOWN_GROUPS[name] ?? null,
      }));
    }
    out.push({ ...c, recipientId: made.get(name).id });
  }
  return out;
}
