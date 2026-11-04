import { createGemini } from './gemini.mjs';
import { createOpenAiCompatible } from './openai-compatible.mjs';
import { createFakeLlm } from './fake.mjs';
export { LlmError } from './errors.mjs';
export { createFakeLlm };

// Empty strings count as unset: use ||, not ?? (TRD §8, earlier bug).
const env = (vars, name) => (vars[name] || '').trim() || null;

/**
 * createLlm({provider, env, fetcher, onUsage, fake}) -> {provider, canEmbed, json(), embed()} | null
 * Returns null when no provider is configured or its key/model is missing; every role then uses rules and templates.
 * Model names come from the environment only.
 */
export function createLlm({ provider, env: vars = process.env, fetcher = fetch, onUsage = () => {}, fake } = {}) {
  const chosen = (provider || '').trim() || env(vars, 'LLM_PROVIDER');
  if (!chosen) return null;
  if (chosen === 'fake') return createFakeLlm({ ...fake, onUsage });
  if (chosen === 'gemini') {
    const apiKey = env(vars, 'GEMINI_API_KEY'), model = env(vars, 'GEMINI_MODEL');
    if (!apiKey || !model) return null;
    return createGemini({ apiKey, model, embedModel: env(vars, 'GEMINI_EMBED_MODEL'), fetcher, onUsage });
  }
  if (chosen === 'openai-compatible') {
    const baseUrl = env(vars, 'OPENAI_COMPAT_BASE_URL'), apiKey = env(vars, 'OPENAI_COMPAT_API_KEY'), model = env(vars, 'OPENAI_COMPAT_MODEL');
    if (!baseUrl || !apiKey || !model) return null;
    return createOpenAiCompatible({ baseUrl, apiKey, model, fetcher, onUsage });
  }
  throw new RangeError('unknown LLM_PROVIDER');
}
