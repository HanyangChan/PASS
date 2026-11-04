// Price/satisfaction options (TRD §6, F4, AC13–15). Every amount is a real re-run of the common engine on a copy of
// the session; the real session budget changes only when the user picks an option (orchestrator ladder_pick).
//  - up:   budgetAlternatives() alternatives with effect top_changed/first_match, kept only past the
//          config/value-ladder.v1.json thresholds for the session sensitivity. Never offered with a budget cap (R3).
//  - down: the cheapest product with the SAME engine score as rank 1 and a lower cost; its cost is re-run as a budget.
// costDelta = cost of the new rank 1 − cost of the current rank 1 (what the user would spend more/less, K40).
import { readFileSync } from 'node:fs';
import { budgetAlternatives } from '../../../src/index.mjs';
import { budgetCost, rankProducts, apply } from '../../../src/vendor/engine.mjs';
import { SENSITIVITIES } from '../db/contract.mjs';
import { rankedFor, whatIfOf } from './engine-facts.mjs';

const CONFIG_URL = new URL('../config/value-ladder.v1.json', import.meta.url);
export const NO_BETTER_UP = '예산을 올려도 지금보다 더 맞는 상품이 없어요';
const bad = () => Object.assign(new Error('invalid_value_ladder'), { code: 'invalid_value_ladder' });

export function loadLadderConfig(raw = JSON.parse(readFileSync(CONFIG_URL, 'utf8'))) {
  const table = t => t && SENSITIVITIES.every(s => typeof t[s] === 'number' && t[s] >= 0);
  if (!raw || !table(raw.minScoreGain) || !table(raw.minPopularityGainPer10k)) throw bad();
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
    const alts = budgetAlternatives(products, state).alternatives.filter(a => ['top_changed', 'first_match'].includes(a.effect));
    for (const a of alts) {
      if (out.up.length >= config.maxUpOptions) break;
      const r = await whatIfOf(session, state, products, a.amount);
      const newTop = r.kind === 'comparison' ? r.result.cards[0] : null;
      if (!newTop || newTop.id === top.id) continue;
      const engineTop = rankProducts(products, apply(state, { budget: { amount_krw: a.amount } })).items[0];
      const costDelta = newTop.budget_cost_krw - topCost;
      if (engineTop?.id !== newTop.id || costDelta <= 0) continue;
      const scoreGain = engineTop.score - top.score;
      const popularityGainPer10k = (engineTop.popularity - top.popularity) / (costDelta / 10000);
      const moreReviews = (engineTop.rating_count ?? 0) > (top.rating_count ?? 0);
      const reason = scoreGain >= config.minScoreGain[s] ? 'score'
        : popularityGainPer10k >= config.minPopularityGainPer10k[s] && moreReviews ? 'popularity' : null;
      if (!reason) continue;
      out.up.push({ direction: 'up', amount_krw: a.amount, costDelta, newTopId: newTop.id, newTopName: newTop.name, newTopCost: newTop.budget_cost_krw, reason, scoreGain,
        ratingCount: { from: top.rating_count ?? 0, to: engineTop.rating_count ?? 0 } });
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
