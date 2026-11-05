// Fake Gemini for proto llmTurn (P8). No network: a fetcher that answers generateContent with queued replies.
// A reply is {state, question?, memory?} (the L1 schema) or a function (input, body) -> reply | {status}.
// The key is a placeholder; proto only puts it in a header the fake never reads.
import { singleInitial, singleTurn } from '../../proto/lib/single-gift.mjs';

/** A complete public state from a partial one (unmentioned fields at their initial values). */
export const protoState = (patch = {}) => ({ ...singleInitial(), ...patch, budget: { ...singleInitial().budget, ...(patch.budget ?? {}) } });

export function fakeGemini(replies = []) {
  const queue = [...replies];
  const calls = [];
  async function fetcher(url, options) {
    const body = JSON.parse(options.body);
    const input = JSON.parse(body.contents[0].parts[0].text);
    calls.push({ url, input, body });
    let next = queue.shift();
    if (typeof next === 'function') next = next(input, body);
    if (!next) throw new Error('fake gemini: no reply queued');
    if (next.status) return { ok: false, status: next.status, json: async () => ({}), body: null };
    const answer = { state: next.state, question: next.question ?? null, ...(next.memory ? { memory: next.memory } : {}) };
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer) }] } }] }) };
  }
  return { llm: { apiKey: 'fake-key-not-a-secret', model: 'fake-model', fetcher, timeoutMs: 1000 }, calls, queue };
}

/** A fake LLM "brain" that answers like main's rules (singleTurn) on the state it is sent: for multi-turn tests. */
export const rulesReply = products => input => {
  const t = singleTurn({ state: input.state, issues: input.issues }, input.text, products);
  return { state: t.session.state, question: t.session.issues[0] ?? null };
};
