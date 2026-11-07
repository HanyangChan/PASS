// Test helpers only. This file name does not match node --test discovery patterns.
// No real API keys and no network: every LLM here is a mock or uses a fake fetcher.
import { LlmError, createLlmClient } from '../../../llm/index.mjs';
import { createSession, runTurn } from '../../../src/index.mjs';
import { products } from '../../../examples/catalog.mjs';

export { products };

export const READY_PATCH = {
  recipients: ['어머니'], quantity: 1, same_product: true,
  budget: { amount_krw: 50000, scope: 'per_set', shipping_included: true },
};

/** A session (version 1) whose required conditions are complete. */
export async function readySession({ recipients = ['어머니'], ...extra } = {}) {
  const out = await runTurn({
    session: createSession('c-attribution-test'), products,
    request: { kind: 'patch', expectedVersion: 0, patch: { ...READY_PATCH, recipients, ...extra } },
  });
  return out.session;
}

/** Send one message through the common core with the given interpreter. */
export function runMessage(session, text, interpret) {
  return runTurn({ session, products, request: { kind: 'message', expectedVersion: session.version, text }, interpret });
}

export const claim = (span, kind, value = null, polarity = null, strength = null) => ({ span, kind, value, polarity, strength });

/** Reads the claim ids that the interpreter sent to the classification step. */
export function sentClaimIds(request) {
  const input = JSON.parse(request.messages.at(-1).content);
  return input.claims.map(c => c.id);
}

/** Mock classification answer: every sent claim gets the same owner. */
export const classifyAll = owner => request => ({ owners: sentClaimIds(request).map(id => ({ id, owner })) });

/**
 * Fake llm with the same completeJson contract as baseline/llm/index.mjs:
 * runs validate and turns false/throw into LlmError('invalid_response').
 * Each queued answer is data, an Error to throw, or a function(request) returning data.
 */
export function mockLlm(answers = []) {
  const queue = [...answers];
  const calls = [];
  return {
    provider: 'mock', model: 'mock-model', configured: true, calls,
    async completeJson(request) {
      calls.push(request);
      if (!queue.length) throw new Error('mock llm: unexpected call');
      const next = queue.shift();
      const value = typeof next === 'function' ? await next(request) : next;
      if (value instanceof Error) throw value;
      let ok;
      try { ok = request.validate ? await request.validate(value) : true; } catch { ok = false; }
      if (ok === false) throw new LlmError('invalid_response');
      return { data: value, text: JSON.stringify(value), provider: 'mock', model: 'mock-model', usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
    },
  };
}

/** OpenAI-compatible HTTP body for a fake fetcher. */
export function chatResponse(content, status = 200) {
  return new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }), {
    status, headers: { 'content-type': 'application/json' },
  });
}

/** Real transport (createLlmClient) with a fake fetcher. handler(n, init) returns a Response or throws. */
export function fetcherLlm(handler, options = {}) {
  const counter = { fetches: 0 };
  const llm = createLlmClient({
    apiKey: 'test', timeoutMs: 2000, ...options,
    fetcher: async (url, init) => { counter.fetches++; return handler(counter.fetches, init); },
  });
  return { llm, counter };
}

/** Claim ids inside a raw HTTP request body built by the transport. */
export function sentClaimIdsFromBody(init) {
  const body = JSON.parse(init.body);
  return sentClaimIds({ messages: body.messages });
}
