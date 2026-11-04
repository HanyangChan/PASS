import { runTurn } from '../src/index.mjs';

/** Attach an interpreter while retaining the common state and result checks. */
export function createAgentRunner({ interpret }) {
  if (typeof interpret !== 'function') throw new TypeError('interpret must be a function');
  return ({ session, request, products }) => runTurn({ session, request, products, interpret });
}
