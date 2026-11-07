// Real LLM wiring. Server-side only: pass process.env (Node) or the Worker env. Never used by npm test.
import { createLlmFromEnv } from '../../llm/index.mjs';
import { createAgent } from './index.mjs';

/** options: {mixedPolicy, timeoutMs, maxTokens, reasoning, onStats} — see createInterpreter. */
export function createConfiguredAgent(env, options = {}) {
  const llm = createLlmFromEnv(env);
  return { ...createAgent({ llm, ...options }), model: llm.model };
}
