import { createAgentRunner } from '../runtime.mjs';
import { createInterpreter } from './interpreter.mjs';

export { createInterpreter, DEFAULT_TIMEOUT_MS } from './interpreter.mjs';
export { PROMPT_VERSION } from './prompts.mjs';

/**
 * Default interpreter: giver/recipient attribution by rules only. It never calls the network.
 * Anything the rules cannot decide becomes unresolved:true with one template question.
 */
export const interpretMessage = createInterpreter();

/**
 * createAgent() → rules-only agent (used by the common tests and demo).
 * createAgent({interpret}) → uses the injected interpreter unchanged.
 * createAgent({llm, mixedPolicy, timeoutMs, onStats}) → attribution interpreter with an injected llm.
 */
export function createAgent({ interpret, llm, ...options } = {}) {
  const useDefault = interpret === undefined && llm === undefined && Object.values(options).every(v => v === undefined);
  const chosen = interpret ?? (useDefault ? interpretMessage : createInterpreter({ llm: llm ?? null, ...options }));
  return { id: 'c-attribution', runTurn: createAgentRunner({ interpret: chosen }) };
}
