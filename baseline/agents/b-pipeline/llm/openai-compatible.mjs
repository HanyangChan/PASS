import { checkSchema, parseJsonText, LlmError } from './errors.mjs';

/** Chat-completions URL: accepts a base with or without a trailing /v1. */
export const chatUrl = baseUrl => `${baseUrl.replace(/\/+$/, '').replace(/\/v1$/, '')}/v1/chat/completions`;

/** LLM_REASONING: 'off' (default) sends reasoning:{enabled:false}; 'on' leaves the field out (server default). */
export const reasoningMode = value => (String(value ?? '').trim().toLowerCase() === 'on' ? 'on' : 'off');

/**
 * JSON mode on chat completions (K72): response_format json_object has no schema, so the schema goes into the system
 * prompt (and the word "json", which OpenAI-style servers require for json_object). The answer is still validated.
 */
export const jsonSystem = (system, schema) => [
  system,
  'Answer with one json object only, no prose and no code fence.',
  ...(schema ? [`The json object must match this JSON Schema: ${JSON.stringify(schema)}`] : []),
].join('\n\n');

/**
 * The one generation client (K72): llmTurn (① + L1 memory candidates), the explainer (④) and the common-port dialogue
 * all call json(). Only message.content is read: reasoning_content and provider_specific_fields are never parsed,
 * returned, logged or put in a trace. No embeddings: embed() returns null and callers use keyword search.
 */
export function createOpenAiCompatible({ baseUrl, apiKey, model, reasoning = 'off', fetcher = fetch, onUsage = () => {} }) {
  const headers = { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` };
  const url = chatUrl(baseUrl);
  const mode = reasoningMode(reasoning);
  return {
    provider: 'openai-compatible',
    canEmbed: false,
    reasoning: mode,
    /**
     * json({system, input, schema, timeoutMs, role, validate?}) -> object
     * validate(value) may throw (e.g. proto `validate`): that counts as llm_schema.
     * Errors: llm_http (detail = status), llm_timeout, llm_network, llm_parse, llm_schema,
     *         llm_config (detail 'reasoning': the server rejected reasoning:{enabled:false}; not retried, K72).
     */
    async json({ system, input, schema, timeoutMs = 8000, role = null, validate = null }) {
      const started = Date.now();
      let ok = false, usage = {};
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const body = {
          model, temperature: 0, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: jsonSystem(system, schema) }, { role: 'user', content: JSON.stringify(input) }],
          ...(mode === 'off' ? { reasoning: { enabled: false } } : {}),
        };
        let data;
        try {
          const res = await fetcher(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
          if (!res.ok) {
            // read the error body only to see whether it names the reasoning field; it is never kept (it may echo input)
            const named = mode === 'off' && (res.status === 400 || res.status === 422) && typeof res.text === 'function'
              && /reasoning/i.test(await res.text().catch(() => ''));
            if (named) throw new LlmError('llm_config', 'reasoning');
            throw new LlmError('llm_http', String(res.status));
          }
          data = await res.json();
        } catch (e) {
          if (e instanceof LlmError) throw e;
          if (e?.name === 'AbortError' || ctrl.signal.aborted) throw new LlmError('llm_timeout');
          throw new LlmError('llm_network');
        }
        usage = data?.usage ?? {};
        const out = parseJsonText(data?.choices?.[0]?.message?.content);
        checkSchema(out, schema);
        if (validate) { try { validate(out); } catch { throw new LlmError('llm_schema', 'validate'); } }
        ok = true;
        return out;
      } finally {
        clearTimeout(timer);
        onUsage({
          provider: 'openai-compatible', role, model,
          inputTokens: usage.prompt_tokens ?? null, outputTokens: usage.completion_tokens ?? null,
          reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? null,
          latencyMs: Date.now() - started, ok,
        });
      }
    },
    async embed() { return null; },
  };
}

/**
 * LlmError -> main's failure code (proto geminiFailure names, kept for the trace and the 503 text):
 * 401/403 auth_failed · 429 quota_exceeded · 404 model_not_found · 5xx/network provider_unavailable · timeout ·
 * other 4xx and llm_config request_rejected · parse/schema invalid_response.
 */
export function failureCode(error) {
  const code = error?.code, status = Number(error?.detail) || 0;
  if (code === 'llm_timeout') return 'timeout';
  if (code === 'llm_network') return 'provider_unavailable';
  if (code === 'llm_config') return 'request_rejected';
  if (code === 'llm_http') {
    if (status === 401 || status === 403) return 'auth_failed';
    if (status === 429) return 'quota_exceeded';
    if (status === 404) return 'model_not_found';
    if (status >= 500) return 'provider_unavailable';
    return 'request_rejected';
  }
  return 'invalid_response';
}
