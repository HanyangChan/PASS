// Condition merge (TRD §4 step 4). Pure: no store, no LLM, no ranking.
// Priority: this utterance > confirmed memory (> rag mapping, which only adds preferences).
// Gift history never enters preferences: the engine gives category +3 and has no repeat avoidance. It is display-only;
// a preference from it exists only when the user presses a chip, which arrives here as an utterance patch.
// Allergies never shrink. Excluded categories are a union. Budget is never filled from memory or recipient caps (R3).
import { initial } from '../../../src/vendor/engine.mjs';
import { checkedPatch } from '../../../src/contracts.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const uniq = a => [...new Set(a)];

/**
 * @param {object} p
 * @param {object} p.state              current baseline state
 * @param {object} p.utterancePatch     patch from the utterance, a chip edit or the LLM (all treated alike)
 * @param {object} p.memory             result of loadMemory()
 * @param {object[]} [p.products]      engine products (unused for now; kept for the caller's signature)
 * @param {string[]} [p.confirmedReleases]  session-only allergies the user confirmed releasing (never applies to remembered ones)
 * @param {{field:string,value:string,from?:string}[]} [p.ragCandidates]  ③ preference mapping
 * @param {object} [p.previousProvenance]  provenance saved with the session, for values already in state
 * @param {{field:string,value:any}[]|null} [p.said]  list values the user actually said this turn (dialogue). When given,
 *   a list value that was already in the state and not said keeps its previous sources instead of becoming 'utterance'
 *   (an additive patch from ① repeats the old list; K44). null = every patch value counts as said (chip edits).
 * @param {boolean} [p.applyMemory]  P8 (main personalization rule 2): remembered preferences, dislikes and packaging fill the
 *   state only when the people are first set or change; false adds no new value from memory (a value the user cancelled in
 *   this session does not come back on the next message), but a value still in the state keeps its memory source (banner,
 *   AC9). Remembered allergies apply on every turn (always protected).
 * @returns {{patch:object, provenance:object, questions:object[], suppressed:object[]}}
 */
export function mergeConditions({ state, utterancePatch, memory, products = [], ragCandidates = [], previousProvenance = {}, confirmedReleases = [], said = null, applyMemory = true }) {
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
  const inherited = (field, value) => previousProvenance[field]?.find(e => same(e.value, value))?.sources ?? ['utterance'];
  const keepBase = (field, value) => { if (!changed) for (const s of inherited(field, value)) add(field, value, s); };
  const repeated = (field, v) => said !== null && !changed && Array.isArray(base[field]) && base[field].some(b => same(b, v))
    && !said.some(x => x.field === field && same(x.value, v));
  for (const [field, value] of Object.entries(u)) {
    if (Array.isArray(value)) value.forEach(v => (repeated(field, v) ? keepBase(field, v) : add(field, v, 'utterance')));
    else add(field, value, 'utterance');
  }
  const memItems = field => (memory?.items ?? []).filter(i => i.field === field);

  // excluded categories: (utterance ?? base) ∪ memory dislikes
  {
    const start = u.excluded_categories ?? base.excluded_categories;
    if (!Object.hasOwn(u, 'excluded_categories')) start.forEach(v => keepBase('excluded_categories', v));
    const result = [...start];
    for (const i of memItems('excluded_categories')) {
      if (!applyMemory && !result.includes(i.value)) continue;
      add('excluded_categories', i.value, `memory:${i.memoryId}`); if (!result.includes(i.value)) result.push(i.value);
    }
    if (Object.hasOwn(u, 'excluded_categories') || !same(result, base.excluded_categories)) patch.excluded_categories = uniq(result);
  }
  const excludedCategories = patch.excluded_categories ?? base.excluded_categories;

  // excluded ingredients (allergies): base ∪ utterance ∪ memory. Shrinks only for a session-only allergy the user confirmed.
  {
    const remembered = new Set(memItems('excluded_ingredients').map(i => i.value));
    const removed = Object.hasOwn(u, 'excluded_ingredients') ? base.excluded_ingredients.filter(v => !u.excluded_ingredients.includes(v)) : [];
    const released = removed.filter(v => !remembered.has(v) && confirmedReleases.includes(v));
    base.excluded_ingredients.filter(v => !released.includes(v)).forEach(v => keepBase('excluded_ingredients', v));
    const result = uniq([...base.excluded_ingredients, ...(u.excluded_ingredients ?? [])]).filter(v => !released.includes(v));
    for (const i of memItems('excluded_ingredients')) { add('excluded_ingredients', i.value, `memory:${i.memoryId}`); if (!result.includes(i.value)) result.push(i.value); }
    const inMemory = removed.filter(v => remembered.has(v));
    if (inMemory.length) {
      const memoryIds = memItems('excluded_ingredients').filter(i => inMemory.includes(i.value)).map(i => i.memoryId);
      questions.push({ type: 'allergy_release', ingredients: inMemory, memoryIds, text: '기억에서도 삭제할까요?' });
    }
    const pending = removed.filter(v => !remembered.has(v) && !released.includes(v));
    if (pending.length) questions.push({ type: 'allergy_release_session', ingredients: pending, text: '알레르기 제외를 해제할까요?' });
    if (Object.hasOwn(u, 'excluded_ingredients') || !same(result, base.excluded_ingredients)) patch.excluded_ingredients = result;
  }

  // preferences: (utterance ?? base) + memory + rag; values the user removed this session stay removed
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
      if (!applyMemory && !result.includes(i.value)) continue;
      add('preferences', i.value, `memory:${i.memoryId}`); if (!result.includes(i.value)) result.push(i.value);
    }
    for (const r of ragCandidates) {
      if (r.field !== 'preferences' || !allowed(r.value)) continue;
      if (!applyMemory && r.from !== 'utterance' && !result.includes(r.value)) continue; // a remembered hobby fills only with memory
      add('preferences', r.value, 'rag'); if (r.from) add('preferences', r.value, r.from);
      if (!result.includes(r.value)) result.push(r.value);
    }
    if (hasU || !same(result, base.preferences)) patch.preferences = uniq(result);
  }

  // packaging: utterance > memory > base
  if (!Object.hasOwn(u, 'packaging')) {
    const m = applyMemory ? memItems('packaging') : [];
    if (m.length) {
      const pick = m.find(i => i.value === memory.conditions.packaging) ?? m[0];
      add('packaging', pick.value, `memory:${pick.memoryId}`);
      if (pick.value !== base.packaging) patch.packaging = pick.value;
    } else if (base.packaging !== null) keepBase('packaging', base.packaging);
  }

  checkedPatch(base, patch); // K3: whatever we send has passed the common validator
  return { patch, provenance, questions, suppressed };
}
