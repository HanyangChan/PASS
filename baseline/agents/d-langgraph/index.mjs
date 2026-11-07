import { createAgentRunner } from '../runtime.mjs';
import { interpretMessage } from '../c-attribution/index.mjs';

// Registry entry: through the common interpreter port D behaves like C (attribution only).
// The full graph with the advisors is runAgentTurn, loaded lazily so the shared baseline
// tests do not need this folder's LangGraph install.
export { interpretMessage };
export function createAgent({ interpret = interpretMessage } = {}) {
  return { id: 'd-langgraph', runTurn: createAgentRunner({ interpret }) };
}
export async function runAgentTurn(args) {
  const { runAgentTurn: run } = await import('./orchestrator.mjs');
  return run(args);
}
