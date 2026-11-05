import { PERSON_FIELDS } from './attribute.mjs';
import { fromItems, instructions, schema } from './gemini.mjs';

export const DEEPSEEK_MODEL = 'deepseek-chat';
// DeepSeek's JSON mode guarantees JSON but not the schema, so the schema goes into the prompt
// and fromItems still drops anything outside the allowed values.
const system = `${instructions}\nReply with one JSON object that matches this JSON schema:\n${JSON.stringify(schema)}`;

/** One DeepSeek (OpenAI-compatible) call returning the labelled items, same shape as the Gemini call. */
export function createDeepSeekCall({ apiKey, model = DEEPSEEK_MODEL, baseUrl = 'https://api.deepseek.com', fetcher = fetch, timeoutMs = 12000, reasoning = 'off' }) {
  if (!apiKey) throw new TypeError('apiKey is required');
  return async ({ text, state }) => {
    const input = { message: text, current_recipient: state.recipients[0] ?? null, current: Object.fromEntries(PERSON_FIELDS.map(k => [k, state[k]])) };
    const options = {
      method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({ model, temperature: 0, max_tokens: reasoning === 'off' ? 800 : 2500, response_format: { type: 'json_object' },
        messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(input) }],
        // Through an OpenRouter-style proxy, deepseek-v4 models think before answering and can spend
        // the whole token budget doing so. 'off' disables it; 'low' keeps a short think with more room.
        // The official API does not take this field.
        ...(baseUrl.includes('api.deepseek.com') ? {} : { reasoning: reasoning === 'off' ? { enabled: false } : { effort: reasoning } }) }),
    };
    let response = await fetcher(`${baseUrl}/chat/completions`, options);
    if ([500, 502, 503, 504].includes(response.status)) { await response.body?.cancel(); response = await fetcher(`${baseUrl}/chat/completions`, options); }
    // Upstream error bodies can echo credentials or input, so only the status is kept.
    if (!response.ok) throw new Error(`deepseek_http_${response.status}`);
    const parsed = JSON.parse((await response.json()).choices?.[0]?.message?.content ?? '');
    // JSON mode does not enforce the schema; a missing question means none (items are still validated).
    if (!Array.isArray(parsed.items)) throw new Error('deepseek_invalid_output');
    parsed.question ??= null;
    return parsed;
  };
}

export function createDeepSeekAttributor(options) {
  const call = createDeepSeekCall(options);
  return async ({ text, state }) => fromItems(await call({ text, state }), state);
}
