import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createServerChatService } from '../src/services/serverChatService.ts';
import { agentContext, personalizeSession, emptyPersonalization } from '../src/services/personalization.ts';
import { createApi } from '../../api/worker.mjs';
import { singleInitial } from '../../lib/single-gift.mjs';
import { toEngineProduct, todayKst } from '../../lib/catalog.mjs';

const graph = await import('../../baseline/agents/d-langgraph/node_modules/@langchain/langgraph/package.json', { with: { type: 'json' } }).then(() => true, () => false);
const gift = (category, price) => ({ id: `${category}-${price}`, name: '선물', category, price, description: '', icon: 'gift' });
const data = {
  memories: [{ recipient: '어머니', preferences: ['category:coffee_tea'], excluded_categories: [], excluded_ingredients: ['견과류'], updatedAt: '2026-11-01' }],
  purchases: [
    { id: '1', recipient: '엄마', gift: gift('뷰티', 38000), feedback: 'liked', source: 'user_reported', recordedAt: '2026-10-01' },
    { id: '2', recipient: '친구', gift: gift('음향기기', 50000), feedback: 'liked', source: 'user_reported', recordedAt: '2026-10-02' },
  ],
};
const events = [{ id: 'a', title: '엄마 생일', date: '11-17', kind: 'birthday' }, { id: 'b', title: '친구 결혼식', date: '11-20', kind: 'etc' }];

test('agent context carries only the current recipient\'s memory, purchases and calendar', () => {
  const ctx = agentContext(data, ['어머니'], events);
  assert.deepEqual(ctx.memory.excluded_ingredients, ['견과류']);
  assert.deepEqual(ctx.purchases, [{ category: 'beauty', price_krw: 38000, feedback: 'liked' }]);
  assert.deepEqual(ctx.calendar.map(e => e.title), ['엄마 생일']);
  assert.deepEqual(agentContext(data, ['어머니', '아버지'], events), { memory: null, purchases: [], calendar: [] });
});

test('agent mode does not read the giver\'s taste from the whole message on the device', () => {
  const session = { state: { ...singleInitial(), recipients: ['어머니'] }, issues: [] };
  const text = '나는 과자 좋아하는데 엄마는 견과류 알레르기가 있어';
  assert.deepEqual(personalizeSession(session, emptyPersonalization(), text).session.state.preferences, ['category:snack']);
  assert.deepEqual(personalizeSession(session, emptyPersonalization(), text, undefined, false).session.state.preferences, []);
});

test('agent mode keeps the recipient when a message names several people, but switches for one', () => {
  const session = { state: { ...singleInitial(), recipients: ['어머니'], excluded_ingredients: ['견과류'] }, issues: [] };
  const several = personalizeSession(session, emptyPersonalization(), '아빠랑 엄마 중에 한 분이 우유 알레르기야', undefined, false).session.state;
  assert.deepEqual(several.recipients, ['어머니']);
  assert.deepEqual(several.excluded_ingredients, ['견과류']);
  assert.deepEqual(personalizeSession(session, emptyPersonalization(), '친구 선물 3만원', undefined, false).session.state.recipients, ['친구']);
});

test('agent mode leaves liked-purchase inference to the server but keeps remembered allergies', () => {
  const session = { state: singleInitial(), issues: [] };
  const classic = personalizeSession(session, { ...data, memories: [] }, '엄마 선물');
  assert.deepEqual(classic.session.state.preferences, ['category:beauty']);
  const agent = personalizeSession(session, data, '엄마 선물', undefined, false);
  assert.deepEqual(agent.session.state.excluded_ingredients, ['견과류']);
  assert.deepEqual(agent.session.state.preferences, ['category:coffee_tea']);
  assert.deepEqual(personalizeSession(session, emptyPersonalization(), '엄마 선물', undefined, false).session.state.preferences, []);
});

test('the server chat service sends the agent field and accepts the agent response', { skip: graph ? false : 'npm install in baseline/agents/d-langgraph' }, async () => {
  const rows = JSON.parse(readFileSync(new URL('../../supabase/seed/products-amazon.json', import.meta.url)));
  const products = rows.map(r => toEngineProduct(r, todayKst()));
  const api = createApi({ catalog: async () => products, fetcher: async () => Response.json({ id: 'owner', role: 'authenticated' }) });
  const env = { SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', APP_ORIGINS: '', AGENTS_MODE: 'on', IP_LIMITER: { limit: async () => ({ success: true }) }, USER_LIMITER: { limit: async () => ({ success: true }) } };
  const auth = { getSession: async () => ({ data: { session: { access_token: 'test.jwt', user: { id: 'owner' } } }, error: null }) };
  let posted;
  const service = createServerChatService('https://api.example/api/chat', auth, 'owner', async (url, options) => { posted = JSON.parse(options.body); return api.fetch(new Request(url, options), env); });
  const start = { state: { ...singleInitial(), recipients: ['어머니'], budget: { amount_krw: 50000, shipping_included: true } }, issues: [] };
  const turn = await service.send(start, '나는 과자 좋아하는데 엄마는 우유 알레르기가 있어', [], 'typed', undefined, undefined, { enabled: true, disabled: ['relationship'], ...agentContext(data, ['어머니'], events) });
  assert.deepEqual(posted.agents.disabled, ['relationship']);
  assert.equal(posted.agents.purchases.length, 1);
  assert.equal(turn.mode, 'agents');
  assert.deepEqual(turn.session.state.excluded_ingredients, ['우유']);
  assert.ok(turn.agents.opinions.some(o => o.agent === 'taste'));
  assert.ok(turn.agents.opinions.find(o => o.agent === 'relationship')?.enabled === false);
});
