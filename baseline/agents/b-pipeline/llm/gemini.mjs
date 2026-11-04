import { checkSchema, fetchJson, parseJsonText, LlmError } from './errors.mjs';

const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Gemini adapter. The key goes in a header, never in the URL, so it cannot leak into request logs. */
export function createGemini({ apiKey, model, embedModel = null, fetcher = fetch, onUsage = () => {} }) {
  const headers = { 'content-type': 'application/json', 'x-goog-api-key': apiKey };
  return {
    provider: 'gemini',
    canEmbed: Boolean(embedModel),
    async json({ system, input, schema, timeoutMs = 8000, role = null }) {
      const started = Date.now();
      let ok = false, usage = {};
      try {
        const body = {
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: JSON.stringify(input) }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0 },
        };
        const data = await fetchJson(fetcher, `${BASE}/${encodeURIComponent(model)}:generateContent`, { method: 'POST', headers, body: JSON.stringify(body) }, timeoutMs);
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
