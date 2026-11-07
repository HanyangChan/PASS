// Price/satisfaction options (TRD §6, F4, AC13–15). Rank and cost always come from the common engine; nothing sorts or scores here.
//  - up ("올리기", K50): NOT a budget change. From the engine's rankProducts list (same state, same budget) the products with
//          the SAME score as rank 1, a HIGHER rating, and a cost increase within config maxUpCostDeltaKrw[sensitivity] are offered as
//          "+N원 · 평점 a → b". Picking one only adds it to the compare tray (ladder_compare); budget and card order stay.
//          Never offered with a budget cap (R3).
//  - down: the cheapest product with the SAME engine score as rank 1 and a lower cost; its cost is re-run as a budget (ladder_pick).
// costDelta = cost of that product − cost of the current rank 1 (what the user would spend more/less, K40).
import { readFileSync } from 'node:fs';
import { budgetCost, rankProducts, apply } from '../../../src/vendor/engine.mjs';
import { SENSITIVITIES } from '../db/contract.mjs';
import { rankedFor, whatIfOf } from './engine-facts.mjs';

const CONFIG_URL = new URL('../config/value-ladder.v1.json', import.meta.url);
export const NO_BETTER_UP = '같은 적합도에서 평점이 더 높은 상품이 없어요';
const bad = () => Object.assign(new Error('invalid_value_ladder'), { code: 'invalid_value_ladder' });

export function loadLadderConfig(raw = JSON.parse(readFileSync(CONFIG_URL, 'utf8'))) {
  if (!raw || !raw.maxUpCostDeltaKrw || !SENSITIVITIES.every(s => Number.isSafeInteger(raw.maxUpCostDeltaKrw[s]) && raw.maxUpCostDeltaKrw[s] > 0)) throw bad();
  for (const k of ['maxUpOptions', 'maxDownOptions']) if (!Number.isSafeInteger(raw[k]) || raw[k] < 0) throw bad();
  return raw;
}

/** One step toward value (down) or quality (up). */
export function shiftSensitivity(current, direction) {
  const i = SENSITIVITIES.indexOf(current), j = direction === 'down' ? i - 1 : i + 1;
  return SENSITIVITIES[Math.max(0, Math.min(SENSITIVITIES.length - 1, j))] ?? 'balanced';
}

/**
 * @returns {Promise<{sensitivity, budgetCap, up:object[], down:object[], upNotice:string|null}>}
 */
export async function planValueLadder({ session, state, products, cards, sensitivity = 'balanced', budgetCap = null, config = loadLadderConfig() }) {
  const s = SENSITIVITIES.includes(sensitivity) ? sensitivity : 'balanced';
  const out = { sensitivity: s, budgetCap, up: [], down: [], upNotice: null };
  if (!cards.length) return out;
  const ranked = rankedFor(products, state, cards);
  const top = ranked[0], topCost = budgetCost(top, state);

  if (budgetCap === null) {
    const limit = config.maxUpCostDeltaKrw[s];
    for (const p of ranked) {
      if (out.up.length >= config.maxUpOptions) break;
      const costDelta = budgetCost(p, state) - topCost;
      if (p.id === top.id || p.score !== top.score || !(p.rating > top.rating) || costDelta <= 0 || costDelta > limit) continue;
      out.up.push({ direction: 'up', productId: p.id, productName: p.name, costDelta, reason: 'rating', rating: { from: top.rating, to: p.rating } });
    }
    if (!out.up.length) out.upNotice = NO_BETTER_UP;
  }

  const cheaper = ranked.filter(p => p.score === top.score && budgetCost(p, state) < topCost);
  if (cheaper.length && config.maxDownOptions > 0) {
    const amount = Math.min(...cheaper.map(p => budgetCost(p, state)));
    const r = await whatIfOf(session, state, products, amount);
    const newTop = r.kind === 'comparison' ? r.result.cards[0] : null;
    const engineTop = newTop && rankProducts(products, apply(state, { budget: { amount_krw: amount } })).items[0];
    if (newTop && engineTop?.id === newTop.id && engineTop.score === top.score) {
      out.down.push({ direction: 'down', amount_krw: amount, costDelta: newTop.budget_cost_krw - topCost, newTopId: newTop.id, newTopName: newTop.name, newTopCost: newTop.budget_cost_krw, reason: 'same_score' });
    }
  }
  return out;
}
