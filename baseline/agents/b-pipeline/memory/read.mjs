// Memory read side (TRD §5.4, §3 step ②). Everything goes through owner-filtered store calls.
import { keyToField, keyLabel, parseKey, checkKey } from './keys.mjs';

const norm = s => String(s ?? '').normalize('NFC').trim();

/**
 * Resolve a mention ("엄마", "부모님") to the owner's recipients.
 * @returns {{status:'found', recipients:[]}|{status:'ambiguous', chips:[]}|{status:'none'}}
 */
export async function findRecipient(store, ownerId, mention, { choice } = {}) {
  const word = norm(mention);
  const mine = await store.listRecipients(ownerId);
  const byName = mine.filter(r => [r.name, ...r.aliases].some(n => norm(n) === word));
  if (byName.length === 1) return { status: 'found', recipients: byName };
  const group = byName.length ? byName : mine.filter(r => r.groupName && norm(r.groupName) === word);
  if (!group.length) return { status: 'none' };
  if (group.length === 1) return { status: 'found', recipients: group };
  if (choice === 'together') return { status: 'found', recipients: group };
  const picked = group.find(r => r.id === choice);
  if (picked) return { status: 'found', recipients: [picked] };
  return {
    status: 'ambiguous',
    chips: [{ label: '두 분 함께', choice: 'together' }, ...group.map(r => ({ label: `${r.name}만`, choice: r.id }))],
  };
}

const uniq = a => [...new Set(a)];

/**
 * Confirmed memories of the given recipients as engine conditions plus their sources.
 * Rows that are suggested, negated or outside the key vocabulary are ignored.
 */
export async function loadMemory(store, ownerId, recipientIds, { now = new Date().toISOString() } = {}) {
  const conditions = { preferences: [], excluded_categories: [], excluded_ingredients: [], packaging: null };
  const items = [], hobbies = [], giftHistory = [], used = [];
  for (const recipientId of recipientIds) {
    for (const m of await store.listMemories(ownerId, recipientId, { status: 'confirmed' })) {
      const check = checkKey(m.key, m.polarity);
      if (!check.ok || check.negation) continue;
      const mapped = keyToField(m.key);
      items.push({ memoryId: m.id, recipientId, key: m.key, field: mapped?.field ?? null, value: mapped?.value ?? null, label: keyLabel(m.key), evidence: m.evidence });
      used.push(m.id);
      if (!mapped) { const k = parseKey(m.key); if (k.kind === 'hobby') hobbies.push({ memoryId: m.id, recipientId, word: k.value }); continue; }
      if (mapped.field === 'packaging') conditions.packaging = conditions.packaging === 'formal' || mapped.value === 'formal' ? 'formal' : mapped.value;
      else conditions[mapped.field] = uniq([...conditions[mapped.field], mapped.value]);
    }
    giftHistory.push(...(await store.listGifts(ownerId, recipientId)).map(g => ({ ...g, recipientId })));
  }
  if (used.length) await store.touchMemories(ownerId, used, now);
  return { conditions, items, hobbies, giftHistory };
}
