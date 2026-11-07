// Errors carry a code only. Messages never include keys, prompts or user text.
export class LlmError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
    this.detail = detail; // schema paths / http status only: never user text
  }
}

/** Minimal JSON-schema subset check (type, properties, required, items, enum, maxItems, minItems, maxLength). */
export function checkSchema(value, schema, path = '$') {
  if (!schema) return;
  const fail = what => { throw new LlmError('llm_schema', `${path} ${what}`); };
  const type = schema.type;
  if (type === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('not object');
    for (const k of schema.required ?? []) if (!Object.hasOwn(value, k)) fail(`missing ${k}`);
    for (const [k, sub] of Object.entries(schema.properties ?? {})) if (Object.hasOwn(value, k)) checkSchema(value[k], sub, `${path}.${k}`);
  } else if (type === 'array') {
    if (!Array.isArray(value)) fail('not array');
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail('too many items');
    if (schema.minItems !== undefined && value.length < schema.minItems) fail('too few items');
    value.forEach((v, i) => checkSchema(v, schema.items, `${path}[${i}]`));
  } else if (type === 'string') {
    if (typeof value !== 'string') fail('not string');
    if (schema.maxLength !== undefined && value.length > schema.maxLength) fail('too long');
  } else if (type === 'integer') {
    if (!Number.isSafeInteger(value)) fail('not integer');
  } else if (type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail('not number');
  } else if (type === 'boolean') {
    if (typeof value !== 'boolean') fail('not boolean');
  }
  if (schema.enum && !schema.enum.includes(value)) fail('not in enum');
}

/** fetch with an abort timeout; maps failures to LlmError codes. */
export async function fetchJson(fetcher, url, init, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetcher(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new LlmError('llm_http', String(res.status));
    return await res.json();
  } catch (e) {
    if (e instanceof LlmError) throw e;
    if (e?.name === 'AbortError') throw new LlmError('llm_timeout');
    throw new LlmError('llm_network');
  } finally {
    clearTimeout(timer);
  }
}

export function parseJsonText(text) {
  if (typeof text !== 'string') throw new LlmError('llm_parse', 'no text');
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(trimmed); } catch { throw new LlmError('llm_parse'); }
}
