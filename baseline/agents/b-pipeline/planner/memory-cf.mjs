// Memory counterfactual (TRD §6, R6, AC10): for each confirmed memory that shaped this turn, drop ONLY the values
// whose every source is that memory (pipeline/provenance.mjs, same function as AC9), re-run the common runTurn on a
// copy of the session, and report the first memory whose removal changes rank 1. Allergy memories are never
// removed, and a hypothetical state with fewer allergies than the real one is never evaluated (AC7).
import { checkedPatch } from '../../../src/contracts.mjs';
import { dropMemories } from '../pipeline/provenance.mjs';
import { appliedMemoryIds } from '../pipeline/banner.mjs';
import { isAllergyKey } from '../memory/keys.mjs';
import { viewOf } from './engine-facts.mjs';

/** @returns {Promise<null | {memoryId, label, evidence, newTopId, newTopName, dropped}>} */
export async function planMemoryCf({ session, state, provenance, memory, products, cards, budgetCap = null }) {
  if (!cards.length) return null;
  const applied = appliedMemoryIds(provenance);
  const seen = new Set();
  for (const m of memory?.items ?? []) {
    if (!applied.has(m.memoryId) || seen.has(m.memoryId) || isAllergyKey(m.key)) continue;
    seen.add(m.memoryId);
    const d = dropMemories(state, provenance, [m.memoryId]);
    if (!Object.keys(d.patch).length || Object.hasOwn(d.patch, 'excluded_ingredients')) continue;
    const virtual = checkedPatch(state, d.patch);
    if (!state.excluded_ingredients.every(a => virtual.excluded_ingredients.includes(a))) continue; // AC7 guard
    const out = await viewOf(session, virtual, products);
    const newTop = out.kind === 'recommendation' ? out.result.cards[0] : null;
    const p = newTop && products.find(x => x.id === newTop.id);
    if (budgetCap !== null && p && p.price_krw + p.shipping_fee_per_set_krw > budgetCap) continue; // K37 / AC14
    if (newTop && newTop.id !== cards[0].id) {
      return { memoryId: m.memoryId, label: m.label, evidence: m.evidence, newTopId: newTop.id, newTopName: newTop.name, dropped: d.dropped };
    }
  }
  return null;
}
