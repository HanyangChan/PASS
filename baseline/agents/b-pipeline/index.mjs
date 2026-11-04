import { createAgentRunner } from '../runtime.mjs';
import { createLlm } from './llm/index.mjs';
import { createDialogue, toPort } from './dialogue/agent.mjs';

/**
 * LLM from the environment for the common port. null (rules + FALLBACK_QUESTION) when:
 *  - running under `node --test` (NODE_TEST_CONTEXT is set): baseline tests must never reach the network,
 *    even when a key is exported in the shell;
 *  - no key, or an unusable provider setting.
 */
export function llmFromEnv(vars = process.env) {
  if (vars.NODE_TEST_CONTEXT) return null;
  try { return createLlm({ env: vars }); } catch { return null; }
}

/** Port for the common runTurn. Called only after parseRules could not resolve the message. */
export async function interpretMessage({ text, state }) {
  return toPort(createDialogue({ llm: llmFromEnv() }))({ text, state });
}

export function createAgent({ interpret = interpretMessage } = {}) {
  return { id: 'b-pipeline', runTurn: createAgentRunner({ interpret }) };
}
