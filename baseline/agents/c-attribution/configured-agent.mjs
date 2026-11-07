// P5 assembly: P1 interpreter (real LLM) + P2 planner + P3 explanations + P4 memory.
// Server-side only. The key is read only from the `env` argument (Node process.env or a Worker env).
// Never used by npm test with a real key; tests pass a fake `fetcher`.
import { createLlmFromEnv } from '../../llm/index.mjs';
import { createMemoryStore } from './memory.mjs';
import { createPlannedAgent } from './planner.mjs';

/**
 * createConfiguredAgent(env, options) → {id, model, memory, runTurn({session, plannerState?, request, products, recipientId?})}
 * options: mixedPolicy, timeoutMs, maxTokens, reasoning, onStats, maxTurns, explanation,
 *          memory (a createMemoryStore() store; a new in-process store by default; null to turn memory off),
 *          fetcher (tests only: a fake transport).
 */
export function createConfiguredAgent(env, { fetcher, memory, ...options } = {}) {
  if (!env || typeof env !== 'object') throw new TypeError('env must be an object such as process.env');
  const llm = createLlmFromEnv(env, fetcher ? { fetcher } : {});
  const store = memory === undefined ? createMemoryStore() : memory;
  return { ...createPlannedAgent({ ...options, llm, memory: store }), model: llm.model, memory: store };
}
