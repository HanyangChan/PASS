import { createAgentRunner } from '../runtime.mjs';
import { attribute } from './attribute.mjs';

/**
 * Interpreter port for the common core: whose condition is it? Only the recipient's facts and
 * gift-level facts are returned as the patch; the giver's own tastes are reported, not applied.
 * Pass `llm` (see gemini.mjs) to interpret clauses the rules do not understand.
 */
export function createInterpreter({ llm } = {}) {
  return async ({ text, state }) => {
    const out = await attribute({ text, state, llm });
    return { patch: out.patch, questions: out.questions, unresolved: out.unresolved, attribution: out.items };
  };
}
export const interpretMessage = createInterpreter();

export function createAgent({ interpret = interpretMessage } = {}) {
  return { id: 'c-attribution', runTurn: createAgentRunner({ interpret }) };
}
