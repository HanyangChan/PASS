// Factsheet (TRD §6): the only input of ④ explainer and ⑤ verifier. Built from engine facts and recomputation only.
// Condition A has NO contrast / memoryCf / valueLadder keys at all (AC12), and they are not even computed.
import { budgetCost, ALLERGY_NOTICE } from '../../../src/vendor/engine.mjs';
import { CATEGORY_NAMES } from '../../../src/vendor/catalog.mjs';
import { giftHistoryHit } from '../pipeline/banner.mjs';
import { rankedFor, matchedPreferences } from './engine-facts.mjs';
import { planContrast } from './contrast.mjs';
import { planMemoryCf } from './memory-cf.mjs';
import { planValueLadder } from './value-ladder.mjs';

/**
 * Applied memories relevant to one product, read from provenance (what each memory actually put into the state):
 * a preference value the product scores on (a hobby counts through the category it was mapped to), an exclusion
 * that filtered every card, or the packaging the product has.
 */
function usedMemoriesFor(product, state, memory, provenance) {
  const matched = new Set(matchedPreferences(product, state));
  const contributed = id => Object.entries(provenance ?? {}).flatMap(([field, entries]) =>
    (entries ?? []).filter(e => (e.sources ?? []).includes(`memory:${id}`)).map(e => ({ field, value: e.value })));
  return (memory?.items ?? []).filter(m => contributed(m.memoryId).some(({ field, value }) =>
    field === 'preferences' ? matched.has(value)
      : field === 'excluded_ingredients' || field === 'excluded_categories' ? state[field].includes(value)
        : field === 'packaging' ? product.packaging === value : false))
    .map(m => ({ id: m.memoryId, label: m.label, evidence: m.evidence }));
}

/**
 * @param {object} p
 * @param {object} p.session   the saved session (copied, never changed)
 * @param {object[]} p.cards   baseline result.cards
 * @param {object} p.state     evaluatedState of the turn
 * @param {'A'|'B'} p.experiment
 */
export async function buildFactsheet({ session, cards, products, state, provenance = {}, memory = null, experiment = 'B', sensitivity = 'balanced', budgetCap = null, now = new Date().toISOString(), config }) {
  const ranked = rankedFor(products, state, cards);
  const items = cards.map((c, i) => {
    const p = ranked[i], cost = budgetCost(p, state);
    return {
      id: p.id, name: p.name, rank: i + 1, categoryKo: CATEGORY_NAMES[p.category] ?? null,
      budgetCost: cost, budget: state.budget.amount_krw, headroom: state.budget.amount_krw - cost,
      ratingCount: p.rating_count ?? 0, sweetness: p.sweetness ?? 'unknown', matchedPreferences: matchedPreferences(p, state),
      usedMemories: usedMemoriesFor(p, state, memory, provenance),
      giftHistoryHit: giftHistoryHit(p.id, memory?.giftHistory, now),
      allergyNotice: state.excluded_ingredients.length ? ALLERGY_NOTICE : null,
    };
  });
  const sheet = { experiment, items };
  if (experiment !== 'B') return sheet;
  sheet.contrast = planContrast({ products, state, cards });
  sheet.memoryCf = await planMemoryCf({ session, state, provenance, memory, products, cards, budgetCap });
  sheet.valueLadder = await planValueLadder({ session, state, products, cards, sensitivity, budgetCap, ...(config ? { config } : {}) });
  return sheet;
}
