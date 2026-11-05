import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApi } from '../worker.mjs';
import { singleInitial } from '../../lib/single-gift.mjs';
import { toEngineProduct, todayKst } from '../../lib/catalog.mjs';

// The agent graph needs this folder's install; without it these tests skip.
const graph = await import('../../baseline/agents/d-langgraph/node_modules/@langchain/langgraph/package.json', { with: { type: 'json' } }).then(() => true, () => false);
const agentTest = graph ? test : (name, fn) => test(name, { skip: 'npm install in baseline/agents/d-langgraph' }, fn);

const rows = JSON.parse(readFileSync(new URL('../../supabase/seed/products-amazon.json', import.meta.url)));
const products = rows.map(r => toEngineProduct(r, todayKst()));
const catalog = async () => products;
const env = (extra = {}) => ({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', APP_ORIGINS: 'https://app.example', IP_LIMITER: { limit: async () => ({ success: true }) }, USER_LIMITER: { limit: async () => ({ success: true }) }, AGENTS_MODE: 'on', ...extra });
const mother = { state: { ...singleInitial(), recipients: ['어머니'], budget: { amount_krw: 50000, shipping_included: true } }, issues: [] };
const agents = (extra = {}) => ({ enabled: true, disabled: [], memory: null, purchases: [], calendar: [], ...extra });
const body = (values = {}) => ({ operation: 'turn', session: mother, text: '나는 과자 좋아하는데 엄마는 견과류 알레르기가 있어', history: [], agents: agents(), ...values });
const request = value => new Request('https://api.example/api/chat', { method: 'POST', headers: { Authorization: 'Bearer test.jwt.value', 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
const verified = async () => Response.json({ id: 'verified-owner', role: 'authenticated' });
const send = async (value, extra, fetcher = verified) => (await createApi({ catalog, fetcher }).fetch(request(value), env(extra))).json();

agentTest('agent mode separates the giver\'s taste from the recipient\'s allergy', async () => {
  const turn = await send(body());
  assert.equal(turn.mode, 'agents');
  assert.deepEqual(turn.session.state.excluded_ingredients, ['견과류']);
  assert.deepEqual(turn.session.state.preferences, []);
  assert.ok(turn.agents.attribution.some(a => a.holder === 'giver' && a.value === 'category:snack' && !a.applied));
  assert.ok(turn.view.result.items.every(p => !p.allergens_declared.includes('견과류')));
  assert.deepEqual(turn.agents.memoryProposals[0].excluded_ingredients, ['견과류']);
});

agentTest('without AGENTS_MODE the agent field is ignored and the classic path answers', async () => {
  const turn = await send(body({ text: '어머니 예산 5만원' }), { AGENTS_MODE: undefined });
  assert.notEqual(turn.mode, 'agents');
  assert.equal(turn.agents, undefined);
});

agentTest('an unclear allergy owner becomes the open question and keeps the conditions', async () => {
  const turn = await send(body({ text: '아빠랑 엄마 중에 한 분이 견과류 알레르기야' }));
  assert.match(turn.session.issues[0], /견과류 알레르기는 누구/);
  assert.equal(turn.view.question.key, 'issue');
  assert.deepEqual(turn.session.state, mother.state);
});

agentTest('toggling an agent off recomputes from the view without the LLM', async () => {
  let gemini = 0;
  const fetcher = async url => String(url).includes('generativelanguage') ? (gemini++, Response.json({})) : verified();
  const context = agents({ purchases: [{ category: 'beauty', price_krw: 38000, feedback: 'liked' }] });
  const on = await send(body({ operation: 'view', agents: context }), { GEMINI_API_KEY: 'k' }, fetcher);
  assert.deepEqual(on.agents.autoApplied, ['category:beauty']);
  assert.ok(on.view.result.items.some(p => p.category === 'beauty'));
  const off = await send(body({ operation: 'view', agents: { ...context, disabled: ['taste'] } }), { GEMINI_API_KEY: 'k' }, fetcher);
  assert.deepEqual(off.agents.autoApplied, []);
  assert.deepEqual(off.session.state, on.session.state);
  assert.equal(gemini, 0);
});

agentTest('suggestions are applied only through a later condition edit', async () => {
  const soon = new Date(Date.parse(`${todayKst()}T00:00:00Z`) + 10 * 864e5).toISOString().slice(5, 10);
  const context = agents({ calendar: [{ title: '엄마 생일', date: soon, kind: 'birthday' }] });
  const turn = await send(body({ operation: 'view', agents: context }));
  const formal = turn.agents.suggestions.find(s => s.id === 'occasion:deadline');
  assert.ok(formal, 'an occasion suggestion is offered');
  assert.equal(turn.session.state.delivery_by, null);
  const applied = await send(body({ operation: 'conditions', patch: formal.patch, agents: context }));
  assert.deepEqual(Object.entries(formal.patch).every(([k, v]) => JSON.stringify(applied.session.state[k]) === JSON.stringify(v)), true);
});

agentTest('the attribution LLM gets the server key and the model setting, never the response', async () => {
  let seen;
  const fetcher = async (url, options) => {
    if (!String(url).includes('generativelanguage')) return verified();
    seen = { url: String(url), key: options.headers['x-goog-api-key'] };
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ items: [{ holder: 'recipient', person: '어머니', field: 'preference_category', category: 'beauty', ingredient: null, amount_krw: null, date: null }], question: null }) }] } }] });
  };
  const response = await createApi({ catalog, fetcher }).fetch(request(body({ text: '어머니는 피부 관리에 관심이 많으셔' })), env({ GEMINI_API_KEY: 'secret-key', AGENTS_MODEL: 'test-model' }));
  const text = await response.text();
  assert.equal(seen.key, 'secret-key');
  assert.match(seen.url, /models\/test-model:generateContent/);
  assert.ok(!text.includes('secret-key'));
  assert.deepEqual(JSON.parse(text).session.state.preferences, ['category:beauty']);
});

test('malformed agent context is rejected before any agent work', async () => {
  for (const bad of [{ enabled: 'yes' }, agents({ disabled: ['nope'] }), agents({ purchases: [{ category: 'cars', price_krw: 1, feedback: 'liked' }] }), agents({ calendar: [{ title: 'x', date: '2026-12-24', kind: 'birthday' }] })]) {
    const response = await createApi({ catalog, fetcher: verified, agentTurn: async () => { throw Error('must not run'); } }).fetch(request(body({ agents: bad })), env());
    assert.equal(response.status, 400);
  }
});

agentTest('AGENTS_LLM=deepseek sends attribution to the configured OpenAI-compatible endpoint', async () => {
  let seen;
  const fetcher = async (url, options) => {
    if (!String(url).includes('/chat/completions')) return verified();
    seen = { url: String(url), auth: options.headers.Authorization, model: JSON.parse(options.body).model };
    return Response.json({ choices: [{ message: { content: JSON.stringify({ items: [{ holder: 'recipient', person: '어머니', field: 'preference_category', category: 'beauty', ingredient: null, amount_krw: null, date: null }], question: null }) } }] });
  };
  const response = await createApi({ catalog, fetcher }).fetch(request(body({ text: '어머니는 피부 관리에 관심이 많으셔' })), env({ AGENTS_LLM: 'deepseek', DEEPSEEK_API_KEY: 'ds-secret', DEEPSEEK_BASE_URL: 'https://proxy.example/v1/', GEMINI_API_KEY: 'g' }));
  const text = await response.text();
  assert.equal(seen.url, 'https://proxy.example/v1/chat/completions');
  assert.equal(seen.auth, 'Bearer ds-secret');
  assert.equal(seen.model, 'deepseek-chat');
  assert.ok(!text.includes('ds-secret'));
  assert.deepEqual(JSON.parse(text).session.state.preferences, ['category:beauty']);
});
