import { checkSchema, fetchJson, parseJsonText, LlmError } from './errors.mjs';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Gemini accepts only a subset of JSON Schema in responseJsonSchema; keep the structural keywords, drop the rest (maxLength...).
const KEEP = ['type', 'enum', 'required', 'minItems', 'maxItems'];
export function toResponseSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const k of KEEP) if (schema[k] !== undefined) out[k] = schema[k];
  if (schema.properties) out.properties = Object.fromEntries(Object.entries(schema.properties).map(([k, v]) => [k, toResponseSchema(v)]));
  if (schema.items) out.items = toResponseSchema(schema.items);
  return out;
}

/** Gemini adapter. The key goes in a header, never in the URL, so it cannot leak into request logs. */
export function createGemini({ apiKey, model, embedModel = null, fetcher = fetch, onUsage = () => {} }) {
  const headers = { 'content-type': 'application/json', 'x-goog-api-key': apiKey };
  let thinkingOff = true; // switched off for latency; dropped for good if the model rejects it (HTTP 400)
  return {
    provider: 'gemini',
    canEmbed: Boolean(embedModel),
    async json({ system, input, schema, timeoutMs = 8000, role = null }) {
      const started = Date.now();
      let ok = false, usage = {};
      try {
        const build = withThinking => JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: JSON.stringify(input) }] }],
          generationConfig: {
            responseMimeType: 'application/json', ...(schema ? { responseJsonSchema: toResponseSchema(schema) } : {}), temperature: 0,
            ...(withThinking ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
          },
        });
        const url = `${BASE}/${encodeURIComponent(model)}:generateContent`;
        let data;
        try { data = await fetchJson(fetcher, url, { method: 'POST', headers, body: build(thinkingOff) }, timeoutMs); }
        catch (e) {
          if (!(thinkingOff && e instanceof LlmError && e.code === 'llm_http' && e.detail === '400')) throw e;
          thinkingOff = false; // this model does not take thinkingConfig: ignore it from now on
          data = await fetchJson(fetcher, url, { method: 'POST', headers, body: build(false) }, timeoutMs);
        }
        usage = data.usageMetadata ?? {};
        const out = parseJsonText(data.candidates?.[0]?.content?.parts?.map(p => p.text ?? '').join(''));
        checkSchema(out, schema);
        ok = true;
        return out;
      } finally {
        onUsage({ provider: 'gemini', role, model, inputTokens: usage.promptTokenCount ?? null, outputTokens: usage.candidatesTokenCount ?? null, latencyMs: Date.now() - started, ok });
      }
    },
    /** One embedContent call per text (TRD §8). Returns null when no embedding model is configured. */
    async embed(texts, { timeoutMs = 8000 } = {}) {
      if (!embedModel) return null;
      const started = Date.now();
      let ok = false;
      try {
        const out = [];
        for (const text of texts) {
          const data = await fetchJson(fetcher, `${BASE}/${encodeURIComponent(embedModel)}:embedContent`, { method: 'POST', headers, body: JSON.stringify({ content: { parts: [{ text }] } }) }, timeoutMs);
          const values = data.embedding?.values;
          if (!Array.isArray(values) || !values.every(Number.isFinite)) throw new LlmError('llm_parse', 'embedding');
          out.push(values);
        }
        ok = true;
        return out;
      } finally {
        onUsage({ provider: 'gemini', role: 'embed', model: embedModel, inputTokens: null, outputTokens: null, latencyMs: Date.now() - started, ok, count: texts.length });
      }
    },
  };
}
