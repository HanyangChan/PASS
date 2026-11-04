import { createAgentRunner } from '../runtime.mjs';
import { createLlm } from './llm/index.mjs';
import { createDialogue, toPort } from './dialogue/agent.mjs';

// No key (or an unusable provider setting) means no LLM: free sentences get the unresolved question, as before.
const envLlm = () => { try { return createLlm(); } catch { return null; } };

/** Port for the common runTurn. Called only after parseRules could not resolve the message. */
export async function interpretMessage({ text, state }) {
  return toPort(createDialogue({ llm: envLlm() }))({ text, state });
}

export function createAgent({ interpret = interpretMessage } = {}) {
  return { id: 'b-pipeline', runTurn: createAgentRunner({ interpret }) };
}
