import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../worker.mjs';
import { singleInitial } from '../../lib/single-gift.mjs';
import { products } from '../../baseline/examples/catalog.mjs';

test('B uses the shared Luna transport, keeps explicit constraints and ignores saved history', async () => {
  const env = {
    CHAT_AGENT: 'a-router', LLM_PROVIDER: 'openai-compatible', LLM_API_KEY: 'synthetic',
    LLM_MODEL: 'gpt-5.6-luna', LLM_REASONING_ENABLED: 'false',
    SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic',
    IP_LIMITER: { limit: async () => ({ success: true }) }, USER_LIMITER: { limit: async () => ({ success: true }) },
  };
  const state = { ...singleInitial(), recipients: ['어머니'], budget: { amount_krw: 50000, shipping_included: true } };
  const sent = [];
  const api = createApi({ catalog: async () => products, fetcher: async (url, options) => {
    if (String(url).endsWith('/auth/v1/user')) return Response.json({ id: 'owner', role: 'authenticated' });
    sent.push(JSON.parse(options.body));
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ items: [
      { holder: 'other', person: '엄마', field: 'preference_category', category: 'beauty', ingredient: null, amount_krw: null, date: null },
    ], question: null }) } }] });
  } });
  const send = async (text, agents) => {
    const response = await api.fetch(new Request('https://test/api/chat', {
      method: 'POST', headers: { Authorization: 'Bearer synthetic.jwt', 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'turn', agentMode: 'langgraph-advisors', session: { state, issues: [] }, text, history: [], agents }),
    }), env);
    assert.equal(response.status, 200);
    return response.json();
  };
  for (const [text, question] of [['예산 5만원 이하 최소 7만원', /예산 상한/], ['2026-02-30까지 도착해야 해', /마감일/], ['알레르기가 있어요', /알레르기 성분/]]) {
    const out = await send(text);
    assert.deepEqual(out.session.state, state);
    assert.match(out.question.text, question);
  }
  assert.equal(sent.length, 0);
  const result = await send('엄마는 피부 관리에 관심이 많으셔', {
    memory: { preferences: ['category:snack'], excluded_ingredients: ['견과류'] },
    purchases: [{ category: 'coffee_tea', price_krw: 38000, feedback: 'liked' }],
  });
  assert.equal(result.agent, 'langgraph-advisors');
  assert.deepEqual(result.session.state.preferences, ['category:beauty']);
  assert.deepEqual(result.session.state.excluded_ingredients, []);
  assert.ok(result.agents.opinions.every(o => !['memory', 'purchase_history'].includes(o.source)));
  assert.equal(result.routing.llmCalls, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].model, 'gpt-5.6-luna');
  assert.equal(sent[0].reasoning_effort, 'none');
});
