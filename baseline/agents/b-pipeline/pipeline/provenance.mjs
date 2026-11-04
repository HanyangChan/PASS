// Removing a memory's contribution from the live session (AC9, and later R6 for the memory counterfactual).
// Only values whose every independent source is one of the removed memories are dropped; a value the user also
// said this session (utterance) stays. 'rag' is not independent: it is the mapping of a hobby memory or utterance.
import { checkedPatch } from '../../../src/contracts.mjs';

const LIST_FIELDS = ['preferences', 'excluded_categories', 'excluded_ingredients'];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** @returns {{patch:object, provenance:object, dropped:{field,value}[]}} patch is valid for checkedPatch(state, patch) */
export function dropMemories(state, provenance, memoryIds) {
  const gone = new Set(memoryIds.map(id => `memory:${id}`));
  const next = structuredClone(provenance ?? {});
  const patch = {}, dropped = [];
  const onlyGone = sources => {
    const rest = sources.filter(s => s !== 'rag' && !gone.has(s));
    return sources.some(s => gone.has(s)) && rest.length === 0;
  };
  for (const field of [...LIST_FIELDS, 'packaging']) {
    const entries = next[field] ?? [];
    const removed = entries.filter(e => onlyGone(e.sources));
    next[field] = entries.filter(e => !onlyGone(e.sources)).map(e => ({ ...e, sources: e.sources.filter(s => !gone.has(s)) }));
    if (!next[field].length) delete next[field];
    if (!removed.length) continue;
    if (field === 'packaging') {
      if (removed.some(e => same(e.value, state.packaging))) { patch.packaging = null; dropped.push({ field, value: state.packaging }); }
      continue;
    }
    const values = state[field].filter(v => !removed.some(e => same(e.value, v)));
    if (values.length !== state[field].length) {
      patch[field] = values;
      for (const v of state[field]) if (!values.includes(v)) dropped.push({ field, value: v });
    }
  }
  checkedPatch(state, patch);
  return { patch, provenance: next, dropped };
}
