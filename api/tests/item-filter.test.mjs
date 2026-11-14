import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApi } from '../worker.mjs';
import { singleInitial } from '../../lib/single-gift.mjs';

const web = JSON.parse(readFileSync(new URL('../../supabase/seed/products-kr.json', import.meta.url)));
const isItem = (id, word) => { const p = web.find(x => x.id === id); return Boolean(p && (p.name.includes(word) || p.seed_keywords.some(k => k.includes(word)))); };
const isCarnation = id => { const p = web.find(x => x.id === id); return p && (p.name.includes('카네이션') || p.seed_keywords.some(k => k.includes('카네이션'))); };
const base = { CATALOG_SOURCE: 'web', SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', APP_ORIGINS: 'https://app.example',
  IP_LIMITER: { limit: async () => ({ success: true }) }, USER_LIMITER: { limit: async () => ({ success: true }) } };
const llmEnv = { LLM_PROVIDER: 'openai-compatible', LLM_API_KEY: 'test-secret', LLM_BASE_URL: 'https://llm.example', LLM_MODEL: 'test-model' };
const ready = () => ({ state: { ...singleInitial(), recipients: ['부모님'], budget: { amount_krw: 100000, shipping_included: true } }, issues: [] });

function api(actions = []) {
  return createApi({ fetcher: async (url, options) => {
    if (String(url).includes('/auth/v1/user')) return Response.json({ id: 'owner', role: 'authenticated' });
    const next = actions.shift();
    assert.ok(next, `unexpected request ${url}`);
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(next) } }] });
  } });
}
async function send(client, env, body) {
  const response = await client.fetch(new Request('https://api.example/api/chat', { method: 'POST',
    headers: { Authorization: 'Bearer fake.jwt', 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'turn', text: '어버이날 카네이션 꽃 선물', history: [], session: ready(), ...body }) }), env);
  return { status: response.status, data: await response.json() };
}

test('ITEM_FILTER off (default) leaves the list and the response unchanged', async () => {
  const { status, data } = await send(api(), { ...base, CHAT_AGENT: 'a-router' }, {});
  assert.equal(status, 200);
  assert.equal(data.itemFilter, undefined);
  assert.equal(Object.hasOwn(data.session, 'item_filter'), false);
  assert.ok(!data.view.result.items.every(p => isCarnation(p.id)));
});

for (const agent of ['a-router', 'langgraph-advisors', 'legacy']) {
  test(`${agent}: a named item narrows the recommendations and is carried in the session`, async () => {
    const env = { ...base, CHAT_AGENT: agent, ITEM_FILTER: 'on' };
    const body = agent === 'langgraph-advisors' ? { agentMode: agent, agents: {} } : {};
    const first = await send(api(), env, body);
    assert.equal(first.status, 200, JSON.stringify(first.data).slice(0, 200));
    assert.equal(first.data.itemFilter?.term, '카네이션');
    assert.equal(first.data.session.item_filter, '카네이션');
    assert.ok(first.data.view.result.items.length && first.data.view.result.items.every(p => isCarnation(p.id)));
    // A follow-up with no item keeps it; switching items follows the latest mention.
    const kept = await send(api(), env, { ...body, text: '배송비 포함', session: first.data.session });
    assert.equal(kept.data.session.item_filter, '카네이션');
    const switched = await send(api(), env, { ...body, text: '카네이션 말고 장미로', session: first.data.session });
    assert.equal(switched.data.session.item_filter, '장미');
    assert.ok(switched.data.view.result.items.length && switched.data.view.result.items.every(p => isItem(p.id, '장미')));
  });
}

test('condition edits keep the carried item without any text', async () => {
  const env = { ...base, CHAT_AGENT: 'a-router', ITEM_FILTER: 'on' };
  const first = await send(api(), env, {});
  const edited = await send(api(), env, { operation: 'conditions', patch: { budget: { amount_krw: 30000, shipping_included: false } }, session: first.data.session });
  assert.equal(edited.status, 200, JSON.stringify(edited.data).slice(0, 200));
  assert.equal(edited.data.session.item_filter, '카네이션');
  assert.ok(edited.data.view.result.items.every(p => isCarnation(p.id)));
});

for (const agent of ['full-chat', 'full-chat-feedback-2']) {
  test(`${agent}: the LLM agent works within the narrowed list (LLM calls unchanged)`, async () => {
    const env = { ...base, ...llmEnv, CHAT_AGENT: agent, ITEM_FILTER: 'on' };
    const actions = agent === 'full-chat' ? [{ action: 'respond', type: 'result' }]
      : [{ action: 'search_products' }, { verdict: 'pass', issues: [], feedback: '' }, { action: 'respond', type: 'result' }, { verdict: 'pass', issues: [], feedback: '' }];
    const { status, data } = await send(api(actions), env, { agentMode: agent });
    assert.equal(status, 200, JSON.stringify(data).slice(0, 300));
    assert.equal(data.itemFilter?.term, '카네이션');
    assert.ok(data.view.result.items.every(p => isCarnation(p.id)));
  });
}
