// Contrast chip facts (TRD §6): the one engine fact that differs between rank 1 and rank 2.
// Fixed priority (most decision-relevant first): a preference only rank 1 matches > less sweet (when a sweetness
// preference is set) > more reviews > lower cost > different category. Facts only; wording is the explainer's job.
import { budgetCost } from '../../../src/vendor/engine.mjs';
import { CATEGORY_NAMES } from '../../../src/vendor/catalog.mjs';
import { rankedFor } from './engine-facts.mjs';

const SWEET = { unsweetened: 0, naturally_sweet: 1, sweet: 2 };

/** @returns {null | {kind, topId, topName, secondId, secondName, ...}} */
export function planContrast({ products, state, cards }) {
  if (cards.length < 2) return null;
  const ranked = rankedFor(products, state, cards);
  const [top, second] = ranked;
  const base = { topId: top.id, topName: top.name, secondId: second.id, secondName: second.name };
  const pref = state.preferences.find(x => x === `category:${top.category}` && x !== `category:${second.category}`);
  if (pref) return { ...base, kind: 'preference', preference: pref, categoryKo: CATEGORY_NAMES[top.category] };
  const soft = state.preferences.includes('less_sweet') || state.preferences.includes('unsweetened');
  if (soft && top.sweetness in SWEET && second.sweetness in SWEET && SWEET[top.sweetness] < SWEET[second.sweetness]) {
    return { ...base, kind: 'sweetness', top: top.sweetness, second: second.sweetness };
  }
  const rt = top.rating_count ?? 0, rs = second.rating_count ?? 0;
  if (rt > rs) return { ...base, kind: 'rating_count', top: rt, second: rs, diff: rt - rs };
  const ct = budgetCost(top, state), cs = budgetCost(second, state);
  if (ct < cs) return { ...base, kind: 'budget_cost', top: ct, second: cs, diff: cs - ct };
  if (top.category !== second.category) return { ...base, kind: 'category', top: CATEGORY_NAMES[top.category], second: CATEGORY_NAMES[second.category] };
  return null;
}
