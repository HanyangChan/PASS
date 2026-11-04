// Condition merge (TRD §4 step 4). Pure: no store, no LLM, no ranking.
// Priority: this utterance > confirmed memory > gift history (> rag mapping, which only adds preferences).
// Allergies never shrink. Excluded categories are a union. Budget is never filled from memory or recipient caps (R3).
import { initial } from '../../../src/vendor/engine.mjs';
import { checkedPatch } from '../../../src/contracts.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const uniq = a => [...new Set(a)];
const GOOD_SATISFACTION = 4;

/**
 * @param {object} p
 * @param {object} p.state              current baseline state
 * @param {object} p.utterancePatch     patch from the utterance, a chip edit or the LLM (all treated alike)
 * @param {object} p.memory             result of loadMemory()
 * @param {object[]} p.products         engine products (only to map gift-history products to categories)
 * @param {{field:string,value:string,from?:string}[]} [p.ragCandidates]  ③ preference mapping
 * @param {object} [p.previousProvenance]  provenance saved with the session, for values already in state
 * @returns {{patch:object, provenance:object, questions:object[], suppressed:object[]}}
 */
export function mergeConditions({ state, utterancePatch, memory, products = [], ragCandidates = [], previousProvenance = {} }) {
  const u = structuredClone(utterancePatch ?? {});
  checkedPatch(state, u); // refuses unknown keys and bad shapes before anything is merged
  const changed = Object.hasOwn(u, 'recipients') && !same(u.recipients, state.recipients);
  const base = changed ? initial() : state; // baseline resets all conditions when recipients change
  const patch = u;
  const provenance = {};
  const questions = [], suppressed = [];

  const add = (field, value, source) => {
    const list = (provenance[field] ??= []);
    const hit = list.find(e => same(e.value, value));
    if (hit) { if (!hit.sources.includes(source)) hit.sources.push(source); } else list.push({ value, sources: [source] });
  };
  for (const [field, value] of Object.entries(u)) {
    if (Array.isArray(value)) value.forEach(v => add(field, v, 'utterance')); else add(field, value, 'utterance');
  }
  const inherited = (field, value) => previousProvenance[field]?.find(e => same(e.value, value))?.sources ?? ['utterance'];
  const keepBase = (field, value) => { if (!changed) for (const s of inherited(field, value)) add(field, value, s); };
  const memItems = field => (memory?.items ?? []).filter(i => i.field === field);
  const categoryOf = id => products.find(p => p.id === id)?.category;

  // excluded categories: (utterance ?? base) ∪ memory dislikes
  {
    const start = u.excluded_categories ?? base.excluded_categories;
    if (!Object.hasOwn(u, 'excluded_categories')) start.forEach(v => keepBase('excluded_categories', v));
    const result = [...start];
    for (const i of memItems('excluded_categories')) { add('excluded_categories', i.value, `memory:${i.memoryId}`); if (!result.includes(i.value)) result.push(i.value); }
    if (Object.hasOwn(u, 'excluded_categories') || !same(result, base.excluded_categories)) patch.excluded_categories = uniq(result);
  }
  const excludedCategories = patch.excluded_categories ?? base.excluded_categories;

  // excluded ingredients (allergies): base ∪ utterance ∪ memory. Never shrinks.
  {
    base.excluded_ingredients.forEach(v => keepBase('excluded_ingredients', v));
    const result = uniq([...base.excluded_ingredients, ...(u.excluded_ingredients ?? [])]);
    for (const i of memItems('excluded_ingredients')) { add('excluded_ingredients', i.value, `memory:${i.memoryId}`); if (!result.includes(i.value)) result.push(i.value); }
    if (Object.hasOwn(u, 'excluded_ingredients')) {
      const removed = base.excluded_ingredients.filter(v => !u.excluded_ingredients.includes(v));
      if (removed.length) {
        const memoryIds = memItems('excluded_ingredients').filter(i => removed.includes(i.value)).map(i => i.memoryId);
        questions.push({ type: 'allergy_release', ingredients: removed, memoryIds, text: '기억에서도 삭제할까요?' });
      }
    }
    if (Object.hasOwn(u, 'excluded_ingredients') || !same(result, base.excluded_ingredients)) patch.excluded_ingredients = result;
  }

  // preferences: (utterance ?? base) + memory + gift history + rag; values the user removed this session stay removed
  {
    const hasU = Object.hasOwn(u, 'preferences');
    const start = hasU ? u.preferences : base.preferences;
    if (!hasU) start.forEach(v => keepBase('preferences', v));
    const removed = !changed && hasU ? base.preferences.filter(v => !u.preferences.includes(v)) : [];
    const result = [...start];
    const allowed = v => !removed.includes(v) && !(v.startsWith('category:') && excludedCategories.includes(v.slice(9)));
    for (const i of memItems('preferences')) {
      if (!allowed(i.value)) {
        if (removed.includes(i.value)) {
          let s = suppressed.find(x => x.value === i.value);
          if (!s) suppressed.push(s = { field: 'preferences', value: i.value, memoryIds: [] });
          s.memoryIds.push(i.memoryId);
        }
        continue;
      }
      add('preferences', i.value, `memory:${i.memoryId}`); if (!result.includes(i.value)) result.push(i.value);
    }
    for (const g of memory?.giftHistory ?? []) {
      const c = categoryOf(g.productId), v = c && `category:${c}`;
      if (!v || !(g.satisfaction >= GOOD_SATISFACTION) || !allowed(v)) continue;
      add('preferences', v, `history:${g.id}`); if (!result.includes(v)) result.push(v);
    }
    for (const r of ragCandidates) {
      if (r.field !== 'preferences' || !allowed(r.value)) continue;
      add('preferences', r.value, 'rag'); if (r.from) add('preferences', r.value, r.from);
      if (!result.includes(r.value)) result.push(r.value);
    }
    if (hasU || !same(result, base.preferences)) patch.preferences = uniq(result);
  }

  // packaging: utterance > memory > base
  if (!Object.hasOwn(u, 'packaging')) {
    const m = memItems('packaging');
    if (m.length) {
      const pick = m.find(i => i.value === memory.conditions.packaging) ?? m[0];
      add('packaging', pick.value, `memory:${pick.memoryId}`);
      if (pick.value !== base.packaging) patch.packaging = pick.value;
    } else if (base.packaging !== null) keepBase('packaging', base.packaging);
  }

  checkedPatch(base, patch); // K3: whatever we send has passed the common validator
  return { patch, provenance, questions, suppressed };
}
