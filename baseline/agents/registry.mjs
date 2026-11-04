import { createAgent as create0 } from './a-router/index.mjs';
import { createAgent as create1 } from './b-pipeline/index.mjs';
import { createAgent as create2 } from './c-attribution/index.mjs';
import { createAgent as create3 } from './d-langgraph/index.mjs';
import { createAgent as create4 } from './e-tiered/index.mjs';

const factories = new Map([
  ['a-router', create0],
  ['b-pipeline', create1],
  ['c-attribution', create2],
  ['d-langgraph', create3],
  ['e-tiered', create4],
]);
export const agentIds = Object.freeze([...factories.keys()]);
export function loadAgent(id, options) {
  const factory = factories.get(id);
  if (!factory) throw new RangeError(`Unknown agent: ${id}. Choose ${agentIds.join(', ')}`);
  return factory(options);
}
