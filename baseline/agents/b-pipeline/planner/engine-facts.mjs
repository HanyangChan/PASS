// Read-only engine facts for the planner (TRD §6). The order and scores come from the common rankProducts;
// nothing here sorts or scores on its own (K1). Every hypothetical goes back through the common runTurn.
import { runTurn } from '../../../src/index.mjs';
import { rankProducts } from '../../../src/vendor/engine.mjs';

export class PlannerError extends Error {
  constructor(code) { super(code); this.code = code; }
}

/** Ranked engine products (with score, popularity) for the state; the cards must be its first entries. */
export function rankedFor(products, state, cards) {
  const items = rankProducts(products, state).items;
  if (cards.some((c, i) => items[i]?.id !== c.id)) throw new PlannerError('cards_not_engine_order');
  return items;
}

/** runTurn on a throwaway copy of the session: the real session is never touched (K4). */
export async function viewOf(session, state, products) {
  const copy = { id: session.id, version: session.version, state: structuredClone(state) };
  return runTurn({ session: copy, request: { kind: 'view', expectedVersion: copy.version }, products });
}

export async function whatIfOf(session, state, products, amount) {
  const copy = { id: session.id, version: session.version, state: structuredClone(state) };
  return runTurn({ session: copy, request: { kind: 'what_if_budget', amount_krw: amount, expectedVersion: copy.version }, products });
}

/** The engine's own preference points for one product (same rule as rankProducts; used only to say WHICH preference matched). */
export function matchedPreferences(product, state) {
  return state.preferences.filter(x => x === `category:${product.category}`
    || (x === 'unsweetened' && product.sweetness === 'unsweetened')
    || (x === 'less_sweet' && ({ unsweetened: 2, naturally_sweet: 1 }[product.sweetness] ?? 0) > 0));
}
