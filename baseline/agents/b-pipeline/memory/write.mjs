// Memory write side (TRD §5.3). Nothing here trusts the caller's candidates: every call re-validates.
// propose() never writes. confirm() writes only candidates that pass the same checks again.
import { checkKey, conflicts, isAllergyKey, keyLabel, parseKey, MemoryError } from './keys.mjs';
import { mentionedAllergens } from '../../../src/vendor/allergens.mjs';

const fail = code => { throw new MemoryError(code); };

export function createMemoryWriter({ store }) {
  /** Classify one candidate against what is already stored. */
  async function judge(ownerId, c, existingByRecipient) {
    const key = c?.key;
    const check = checkKey(key, c?.polarity);
    if (!check.ok) return { rejected: { candidate: c, reason: 'unknown_key' } };
    const allergy = isAllergyKey(key);
    if (c.basis !== 'explicit') return { rejected: { candidate: c, reason: 'not_explicit' } };
    if (c.source !== undefined && c.source !== 'explicit') return { rejected: { candidate: c, reason: allergy ? 'allergy_explicit_only' : 'not_explicit' } };
    if (typeof c.evidence !== 'string' || !c.evidence.trim() || c.evidence.length > 200) return { rejected: { candidate: c, reason: 'no_evidence' } };
    if (allergy && check.negation) return { rejected: { candidate: c, reason: 'allergy_cannot_decrease' } };
    if (allergy && !mentionedAllergens(c.evidence).includes(parseKey(key).value)) return { rejected: { candidate: c, reason: 'allergy_needs_explicit_mention' } };
    if (!existingByRecipient.has(c.recipientId)) existingByRecipient.set(c.recipientId, await store.listMemories(ownerId, c.recipientId));
    const existing = existingByRecipient.get(c.recipientId);
    const clash = existing.find(m => m.status === 'confirmed' && conflicts(m, c));
    if (clash) return { conflict: { candidate: c, existing: clash, question: '기억을 바꿀까요?' } };
    if (check.negation) return { rejected: { candidate: c, reason: 'nothing_to_negate' } };
    if (existing.some(m => m.key === c.key && m.polarity === c.polarity && m.status === 'confirmed')) return { duplicate: true };
    return { accepted: c };
  }

  async function classify(ownerId, candidates) {
    const out = { accepted: [], conflicts: [], rejected: [], duplicates: 0 };
    const cache = new Map();
    for (const c of candidates) {
      const r = await judge(ownerId, c, cache);
      if (r.accepted) out.accepted.push(r.accepted);
      else if (r.conflict) out.conflicts.push(r.conflict);
      else if (r.rejected) out.rejected.push(r.rejected);
      else out.duplicates++;
    }
    return out;
  }

  return {
    /** Session end: what would be remembered. Writes nothing (AC4: declining leaves no trace). */
    async propose(ownerId, candidates) {
      const r = await classify(ownerId, candidates);
      return { ...r, prompt: r.accepted.length ? { type: 'memory_prompt', text: '다음에도 기억할까요?', candidates: r.accepted.map(c => ({ ...c, label: keyLabel(c.key) })) } : null };
    },

    /** The user accepted. Re-validates, then writes confirmed/explicit rows. Conflicts are never overwritten. */
    async confirm(ownerId, candidates) {
      const r = await classify(ownerId, candidates);
      const saved = [];
      for (const c of r.accepted) {
        saved.push(await store.addMemory(ownerId, {
          recipientId: c.recipientId, key: c.key, polarity: c.polarity, strength: 0.7, status: 'confirmed', source: 'explicit', evidence: c.evidence,
        }));
      }
      return { saved, conflicts: r.conflicts, rejected: r.rejected };
    },

    /** "기억을 바꿀까요?" answer. accept removes the old memory; allergies can never be removed this way. */
    async resolveConflict(ownerId, { existingId, accept }) {
      const m = await store.getMemory(ownerId, existingId);
      if (!m) fail('not_found');
      if (!accept) return { changed: false };
      if (isAllergyKey(m.key)) fail('allergy_cannot_decrease');
      await store.deleteMemory(ownerId, existingId);
      return { changed: true };
    },

    /** Rule 3. Stores/extends a suggested memory; a second session in the same direction asks for confirmation. */
    async recordFeedback(ownerId, { recipientId, key, polarity, sessionId, productId }) {
      const check = checkKey(key, polarity);
      if (!check.ok || check.negation) return { memory: null, prompt: null, rejected: { reason: 'unknown_key' } };
      if (isAllergyKey(key)) return { memory: null, prompt: null, rejected: { reason: 'allergy_explicit_only' } };
      const existing = await store.listMemories(ownerId, recipientId);
      const clash = existing.find(m => m.status === 'confirmed' && conflicts(m, { key, polarity }));
      if (clash) return { memory: null, prompt: null, conflict: { existing: clash, question: '기억을 바꿀까요?' } };
      const same = existing.find(m => m.status === 'suggested' && m.key === key && m.polarity === polarity);
      if (!same) {
        const memory = await store.addMemory(ownerId, { recipientId, key, polarity, strength: 0.5, status: 'suggested', source: 'feedback', evidence: `feedback:${sessionId}`.slice(0, 200) });
        return { memory, prompt: null };
      }
      const sessions = same.evidence.replace(/^feedback:/, '').split(',');
      if (sessions.includes(sessionId)) return { memory: same, prompt: null };
      const memory = await store.updateMemory(ownerId, same.id, { evidence: `feedback:${[...sessions, sessionId].join(',')}`.slice(0, 200) });
      return { memory, prompt: { type: 'memory_prompt', text: '다음에도 기억할까요?', candidates: [{ memoryId: memory.id, recipientId, key, polarity, label: keyLabel(key) }] } };
    },

    /** The user said yes to a suggested memory. Allergies are never suggested, so none can be promoted here. */
    async acceptSuggested(ownerId, memoryIds) {
      const out = [];
      for (const id of memoryIds) {
        const m = await store.getMemory(ownerId, id);
        if (!m || m.status !== 'suggested' || isAllergyKey(m.key)) fail('not_found');
        out.push(await store.updateMemory(ownerId, id, { status: 'confirmed' }));
      }
      return out;
    },

    /** Rule 6: purchases are history, not preferences. */
    recordPurchase: (ownerId, { recipientId, productId, occasion, givenAt }) => store.addGift(ownerId, { recipientId, productId, occasion, givenAt }),
    rateGift: (ownerId, giftId, satisfaction) => store.updateGift(ownerId, giftId, { satisfaction }),
    async pendingSatisfaction(ownerId, recipientId) { return (await store.listGifts(ownerId, recipientId)).filter(g => g.satisfaction === null); },

    /** My-page edit. Allergies: only the evidence sentence may change. */
    async edit(ownerId, memoryId, patch) {
      const m = await store.getMemory(ownerId, memoryId);
      if (!m) fail('not_found');
      const keys = Object.keys(patch);
      if (isAllergyKey(m.key)) { if (keys.some(k => k !== 'evidence')) fail('allergy_cannot_decrease'); }
      else if (keys.some(k => !['evidence', 'strength'].includes(k))) fail('not_editable');
      return store.updateMemory(ownerId, memoryId, patch);
    },

    /** Rule 7 and the only way an allergy leaves the DB: the user's explicit deletion. Real delete. */
    remove: (ownerId, memoryId) => store.deleteMemory(ownerId, memoryId),
  };
}
