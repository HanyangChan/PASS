import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApi } from '../worker.mjs';
import { singleInitial } from '../../lib/single-gift.mjs';
import { toEngineProduct, todayKst } from '../../lib/catalog.mjs';

const rows = JSON.parse(readFileSync(new URL('../../supabase/seed/products-amazon.json', import.meta.url)));
const products = rows.map(r => toEngineProduct(r, todayKst()));
const catalog = async () => products;
const env = (extra = {}) => ({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', APP_ORIGINS: 'https://app.example', IP_LIMITER: { limit: async () => ({ success: true }) }, USER_LIMITER: { limit: async () => ({ success: true }) }, ...extra });
const mother = { state: { ...singleInitial(), recipients: ['어머니'], budget: { amount_krw: 50000, shipping_included: true } }, issues: [] };
const agents = (extra = {}) => ({ disabled: [], calendar: [], ...extra });
const body = (values = {}) => ({ operation: 'turn', agentMode: 'langgraph-advisors', session: mother, text: '나는 과자 좋아하는데 엄마는 견과류 알레르기가 있어', history: [], agents: agents(), ...values });
const request = value => new Request('https://api.example/api/chat', { method: 'POST', headers: { Authorization: 'Bearer test.jwt.value', 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
const verified = async () => Response.json({ id: 'verified-owner', role: 'authenticated' });
const send = async (value, extra, fetcher = verified) => (await createApi({ catalog, fetcher }).fetch(request(value), env(extra))).json();

test('agent mode separates the giver\'s taste from the recipient\'s allergy', async () => {
  const turn = await send(body());
  assert.equal(turn.mode, 'agents');
  assert.deepEqual(turn.session.state.excluded_ingredients, ['견과류']);
  assert.deepEqual(turn.session.state.preferences, []);
  assert.ok(turn.agents.attribution.some(a => a.holder === 'giver' && a.value === 'category:snack' && !a.applied));
  assert.ok(turn.view.result.items.every(p => !p.allergens_declared.includes('견과류')));
  assert.deepEqual(turn.agents.memoryProposals[0].excluded_ingredients, ['견과류']);
});

test('advisor context does not activate B without a mode selection', async () => {
  const turn = await send(body({ agentMode: undefined, text: '어머니 예산 5만원' }), { CHAT_AGENT: 'a-router' });
  assert.notEqual(turn.mode, 'agents');
  assert.equal(turn.agents, undefined);
});

test('an unclear allergy owner becomes the open question and keeps the conditions', async () => {
  const turn = await send(body({ text: '아빠랑 엄마 중에 한 분이 견과류 알레르기야' }));
  assert.match(turn.session.issues[0], /견과류 알레르기는 누구/);
  assert.equal(turn.view.question.key, 'issue');
  assert.deepEqual(turn.session.state, mother.state);
});

test('toggling an advisor off recomputes from the view without the LLM', async () => {
  const settings = { LLM_PROVIDER: 'openai-compatible', LLM_API_KEY: 'synthetic' };
  const on = await send(body({ operation: 'view' }), settings);
  assert.ok(on.agents.opinions.some(o => o.agent === 'relationship' && o.enabled));
  const off = await send(body({ operation: 'view', agents: agents({ disabled: ['relationship'] }) }), settings);
  assert.ok(off.agents.opinions.some(o => o.agent === 'relationship' && !o.enabled));
  assert.deepEqual(off.session.state, on.session.state);
  assert.equal(off.routing.llmCalls, 0);
});

test('suggestions are applied only through a later condition edit', async () => {
  const soon = new Date(Date.parse(`${todayKst()}T00:00:00Z`) + 10 * 864e5).toISOString().slice(5, 10);
  const context = agents({ calendar: [{ title: '엄마 생일', date: soon, kind: 'birthday' }] });
  const turn = await send(body({ operation: 'view', agents: context }));
  const formal = turn.agents.suggestions.find(s => s.id === 'occasion:deadline');
  assert.ok(formal, 'an occasion suggestion is offered');
  assert.equal(turn.session.state.delivery_by, null);
  const applied = await send(body({ operation: 'conditions', patch: formal.patch, agents: context }));
  assert.deepEqual(Object.entries(formal.patch).every(([k, v]) => JSON.stringify(applied.session.state[k]) === JSON.stringify(v)), true);
});

test('malformed agent context is rejected before any agent work', async () => {
  for (const bad of [[], agents({ disabled: ['nope'] }), agents({ calendar: [{ title: 'x', date: '2026-12-24', kind: 'birthday' }] })]) {
    const response = await createApi({ catalog: async () => assert.fail('must not load the catalog'), fetcher: verified }).fetch(request(body({ agents: bad })), env());
    assert.equal(response.status, 400);
  }
});

test('B uses the configured OpenAI-compatible endpoint and keeps its key server-side', async () => {
  let seen;
  const fetcher = async (url, options) => {
    if (!String(url).includes('/chat/completions')) return verified();
    seen = { url: String(url), auth: options.headers.Authorization, model: JSON.parse(options.body).model };
    return Response.json({ choices: [{ message: { content: JSON.stringify({ items: [{ holder: 'recipient', person: '어머니', field: 'preference_category', category: 'beauty', ingredient: null, amount_krw: null, date: null }], question: null }) } }] });
  };
  const response = await createApi({ catalog, fetcher }).fetch(request(body({ text: '어머니는 피부 관리에 관심이 많으셔' })), env({ LLM_PROVIDER: 'openai-compatible', LLM_API_KEY: 'synthetic-key', LLM_BASE_URL: 'https://proxy.example/v1/', LLM_MODEL: 'gpt-5.6-luna' }));
  const text = await response.text();
  assert.equal(seen.url, 'https://proxy.example/v1/chat/completions');
  assert.equal(seen.auth, 'Bearer synthetic-key');
  assert.equal(seen.model, 'gpt-5.6-luna');
  assert.ok(!text.includes('synthetic-key'));
  assert.deepEqual(JSON.parse(text).session.state.preferences, ['category:beauty']);
});
