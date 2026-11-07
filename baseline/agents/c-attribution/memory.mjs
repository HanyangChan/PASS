// P4 recipient memory: in-process Map keyed by a host-supplied recipientId (never a display name).
// Facts are saved only after confirm. Deletion is explicit only. No inference from purchases.
import { checkedPatch } from '../../src/contracts.mjs';
import { claimPatchValue } from './attribution.mjs';
import { ALLERGEN_NAMES, CATEGORIES, SWEETNESS_VALUES } from './vocabulary.mjs';

export const DEFAULT_STALE_DAYS = 180;
const DAY_MS = 86400000;
const FIELDS = ['preferences', 'excluded_ingredients', 'excluded_categories'];

function checkRecipientId(recipientId) {
  if (typeof recipientId !== 'string' || !recipientId.trim() || recipientId.length > 200) throw new TypeError('recipientId must be a non-empty string (a stable id, not a display name)');
}
function checkFact(f) {
  const ok = f && typeof f === 'object' && typeof f.id === 'string' && f.id && typeof f.recipientId === 'string' && f.recipientId
    && typeof f.field === 'string' && Number.isFinite(f.savedAt) && typeof f.span === 'string' && typeof f.sensitive === 'boolean' && typeof f.source === 'string';
  if (!ok) throw new TypeError('invalid stored fact');
  return { id: f.id, recipientId: f.recipientId, field: f.field, value: f.value, span: f.span, sensitive: f.sensitive, savedAt: f.savedAt, source: f.source };
}

/** Is this stored value something the engine understands? (Checked again at apply time.) */
function validValue(field, value) {
  if (field === 'excluded_ingredients') return ALLERGEN_NAMES.includes(value);
  if (field === 'excluded_categories') return CATEGORIES.includes(value);
  if (field === 'preferences') return SWEETNESS_VALUES.includes(value) || (typeof value === 'string' && value.startsWith('category:') && CATEGORIES.includes(value.slice(9)));
  return false;
}

/** Does a recipient claim of the current turn contradict this remembered fact? Then the current request wins. */
function conflicts(fact, currentClaims) {
  const mine = currentClaims.filter(c => c.owner === 'recipient');
  const allows = c => c.polarity === 'allow' || c.polarity === 'prefer';
  if (fact.field === 'preferences' && SWEETNESS_VALUES.includes(fact.value)) return mine.some(c => c.kind === 'sweetness' && allows(c));
  if (fact.field === 'preferences') return mine.some(c => c.kind === 'category' && `category:${c.value}` === fact.value && c.polarity === 'avoid');
  const kind = fact.field === 'excluded_ingredients' ? 'ingredient' : 'category';
  return mine.some(c => c.kind === kind && c.value === fact.value && allows(c));
}

/**
 * memoryPatch({facts, state, currentClaims}) → {patch, applied, skipped}
 * Builds a patch for the common runTurn (kind:'patch'). Each applied item says where it came from.
 */
export function memoryPatch({ facts, state, currentClaims = [] }) {
  const skipped = [], candidates = [];
  const additions = Object.fromEntries(FIELDS.map(f => [f, []]));
  for (const fact of facts) {
    const note = reason => skipped.push({ factId: fact.id, field: fact.field, value: fact.value, reason });
    if (!FIELDS.includes(fact.field) || !validValue(fact.field, fact.value)) { note('invalid_value'); continue; }
    if (conflicts(fact, currentClaims)) { note('current_request_priority'); continue; }
    if (state[fact.field].includes(fact.value) || additions[fact.field].includes(fact.value)) { note('already_in_state'); continue; }
    additions[fact.field].push(fact.value);
    candidates.push({ field: fact.field, value: fact.value, source: 'memory', savedAt: fact.savedAt, span: fact.span, factId: fact.id });
  }
  const patch = {};
  for (const field of FIELDS) if (additions[field].length) patch[field] = [...state[field], ...additions[field]];
  try {
    checkedPatch(state, patch);
  } catch {
    return { patch: {}, applied: [], skipped: [...skipped, ...candidates.map(c => ({ factId: c.factId, field: c.field, value: c.value, reason: 'checked_patch_failed' }))] };
  }
  return { patch, applied: candidates, skipped };
}

/**
 * createMemoryStore({now, staleDays, facts}) → store
 * - propose(recipientId, claim, {source}) → {ok:true, proposal} | {ok:false, reason}
 * - confirm(proposalId) → saved fact;  pending(recipientId) → open proposals
 * - list(recipientId) → saved facts;  delete(recipientId, factId) → true/false (the only way to remove)
 * - listStale(recipientId) → facts older than staleDays (listed, never removed);  snapshot() → plain data for the host
 */
export function createMemoryStore({ now = Date.now, staleDays = DEFAULT_STALE_DAYS, facts = [] } = {}) {
  if (typeof now !== 'function') throw new TypeError('now must be a function');
  if (!Number.isSafeInteger(staleDays) || staleDays < 1 || staleDays > 3650) throw new TypeError('staleDays must be an integer 1..3650');
  if (!Array.isArray(facts)) throw new TypeError('facts must be an array');
  const saved = new Map(); // recipientId → fact[]
  const proposals = new Map(); // proposalId → proposal
  let seq = 0;
  const nextId = prefix => { let id; do id = `${prefix}${++seq}`; while (proposals.has(id) || [...saved.values()].some(list => list.some(f => f.id === id))); return id; };
  for (const raw of facts) { const f = checkFact(raw); saved.set(f.recipientId, [...(saved.get(f.recipientId) ?? []), f]); }

  function propose(recipientId, claim, { source = 'conversation' } = {}) {
    checkRecipientId(recipientId);
    if (source !== 'conversation') return { ok: false, reason: 'source_not_allowed' };
    if (claim?.owner !== 'recipient') return { ok: false, reason: 'not_recipient' };
    if (claim.reason === 'gift_instruction') return { ok: false, reason: 'instruction_not_fact' };
    const target = claimPatchValue(claim);
    if (!target) return { ok: false, reason: 'not_storable' };
    if ((saved.get(recipientId) ?? []).some(f => f.field === target.field && f.value === target.value)) return { ok: false, reason: 'already_saved' };
    if ([...proposals.values()].some(p => p.recipientId === recipientId && p.field === target.field && p.value === target.value)) return { ok: false, reason: 'already_pending' };
    const proposal = {
      id: nextId('proposal-'), recipientId, field: target.field, value: target.value, span: claim.span,
      sensitive: claim.kind === 'ingredient', requiresConfirmation: true,
    };
    proposals.set(proposal.id, proposal);
    return { ok: true, proposal: { ...proposal } };
  }

  function confirm(proposalId) {
    const p = proposals.get(proposalId);
    if (!p) throw new RangeError(`unknown proposal: ${proposalId}`);
    proposals.delete(proposalId);
    const fact = { id: nextId('fact-'), recipientId: p.recipientId, field: p.field, value: p.value, span: p.span, sensitive: p.sensitive, savedAt: now(), source: 'conversation' };
    saved.set(p.recipientId, [...(saved.get(p.recipientId) ?? []), fact]);
    return { ...fact };
  }

  const list = recipientId => { checkRecipientId(recipientId); return (saved.get(recipientId) ?? []).map(f => ({ ...f })); };
  const pending = recipientId => { checkRecipientId(recipientId); return [...proposals.values()].filter(p => p.recipientId === recipientId).map(p => ({ ...p })); };
  function remove(recipientId, factId) {
    checkRecipientId(recipientId);
    const facts = saved.get(recipientId) ?? [];
    const kept = facts.filter(f => f.id !== factId);
    if (kept.length === facts.length) return false;
    saved.set(recipientId, kept);
    return true;
  }
  const listStale = recipientId => list(recipientId).filter(f => now() - f.savedAt > staleDays * DAY_MS);
  const snapshot = () => [...saved.values()].flat().map(f => ({ ...f }));

  return Object.freeze({ propose, confirm, pending, list, delete: remove, listStale, snapshot });
}
