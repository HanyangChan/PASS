import { checkSchema, LlmError } from './errors.mjs';

/**
 * Test double. `json` is a queue: each entry is a value, a function(call) -> value, or an Error to throw.
 * `embed` is null (no embeddings) or a function(texts) -> number[][].
 * Every call is recorded in `calls` (in memory only, never written to logs).
 */
export function createFakeLlm({ json = [], embed = null, onUsage = () => {} } = {}) {
  const queue = [...json];
  const calls = [];
  return {
    provider: 'fake',
    canEmbed: typeof embed === 'function',
    calls,
    async json(call) {
      calls.push({ method: 'json', ...structuredClone(call) });
      const started = Date.now();
      let ok = false;
      try {
        if (!queue.length) throw new LlmError('llm_fake_exhausted');
        const next = queue.shift();
        if (next instanceof Error) throw next;
        const out = structuredClone(typeof next === 'function' ? await next(call) : next);
        checkSchema(out, call.schema);
        ok = true;
        return out;
      } finally {
        onUsage({ provider: 'fake', role: call.role ?? null, model: 'fake', inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - started, ok });
      }
    },
    async embed(texts) {
      calls.push({ method: 'embed', texts: [...texts] });
      return typeof embed === 'function' ? embed(texts) : null;
    },
  };
}
