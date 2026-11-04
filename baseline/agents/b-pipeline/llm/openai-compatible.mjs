import { checkSchema, fetchJson, parseJsonText } from './errors.mjs';

/** Chat-completions URL: accepts a base with or without a trailing /v1. */
export const chatUrl = baseUrl => `${baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')}/v1/chat/completions`;

/** OpenAI-compatible chat adapter (e.g. VibeHub). No embeddings: embed() returns null and callers use keyword search. */
export function createOpenAiCompatible({ baseUrl, apiKey, model, fetcher = fetch, onUsage = () => {} }) {
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` };
  return {
    provider: 'openai-compatible',
    canEmbed: false,
    async json({ system, input, schema, timeoutMs = 8000, role = null }) {
      const started = Date.now();
      let ok = false, usage = {};
      try {
        const body = {
          model, temperature: 0, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(input) }],
        };
        const data = await fetchJson(fetcher, chatUrl(baseUrl), { method: 'POST', headers, body: JSON.stringify(body) }, timeoutMs);
        usage = data.usage ?? {};
        const out = parseJsonText(data.choices?.[0]?.message?.content);
        checkSchema(out, schema);
        ok = true;
        return out;
      } finally {
        onUsage({ provider: 'openai-compatible', role, model, inputTokens: usage.prompt_tokens ?? null, outputTokens: usage.completion_tokens ?? null, latencyMs: Date.now() - started, ok });
      }
    },
    async embed() { return null; },
  };
}
