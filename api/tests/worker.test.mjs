import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../worker.mjs';
import { singleInitial, finishSingle } from '../../lib/single-gift.mjs';
const env = () => ({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', APP_ORIGINS: 'https://app.example', IP_LIMITER: { limit: async () => ({ success: true }) }, USER_LIMITER: { limit: async () => ({ success: true }) } });
const body = (values = {}) => ({ operation: 'turn', session: { state: singleInitial(), issues: [] }, text: '부모님 예산 5만원', history: [], ...values });
const request = (value = body(), headers = {}) => new Request('https://api.example/api/chat', { method: 'POST', headers: { Authorization: 'Bearer test.jwt.value', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(value) });
const verified = async () => Response.json({ id: 'verified-owner', role: 'authenticated' });

test('authenticated browser and native turns use server engine and return matching ranking', async () => {
  const api = createApi({ fetcher: verified });
  const response = await api.fetch(request(body(), { Origin: 'https://app.example' }), env());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://app.example');
  const turn = await response.json();
  assert.equal(turn.session.state.budget.amount_krw, 50000);
  assert.deepEqual(turn.session.state.recipients, ['부모님']);
  assert.equal(turn.view.question.key, turn.question.key);
  assert.equal((await api.fetch(request(), env())).status, 200);
});
test('disallowed CORS origins and preflight do not call auth or the model', async () => {
  const api = createApi({ fetcher: () => { throw Error('must not call'); } });
  assert.equal((await api.fetch(request(body(), { Origin: 'https://evil.example' }), env())).status, 403);
  const response = await api.fetch(new Request('https://api.example/api/chat', { method: 'OPTIONS', headers: { Origin: 'https://app.example' } }), env());
  assert.equal(response.status, 204);
  assert.match(response.headers.get('access-control-allow-headers'), /Authorization/);
});
test('forged/missing tokens and revoked tokens are rejected before model work', async () => {
  const api = createApi({ fetcher: async () => new Response(null, { status: 401 }) });
  assert.equal((await api.fetch(request(body(), { Authorization: '' }), env())).status, 401);
  assert.equal((await api.fetch(request(), env())).status, 401);
});
test('rate limiting uses verified identity and fails closed when bindings are missing', async () => {
  const config = env(); let key;
  config.USER_LIMITER.limit = async value => { key = value.key; return { success: false }; };
  const response = await createApi({ fetcher: verified }).fetch(request(body({ user_id: 'spoofed' })), config);
  assert.equal(key, 'verified-owner'); assert.equal(response.status, 429); assert.equal(response.headers.get('retry-after'), '60');
  delete config.USER_LIMITER;
  assert.equal((await createApi({ fetcher: verified }).fetch(request(), config)).status, 503);
});
test('streaming body bounds and invalid condition patches do not reach model', async () => {
  const api = createApi({ fetcher: verified, extract: () => { throw Error('must not call'); } });
  const oversized = new Request('https://api.example/api/chat', { method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' }, body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('a'.repeat(33000))); controller.close(); } }), duplex: 'half' });
  assert.equal((await api.fetch(oversized, env())).status, 413);
  assert.equal((await api.fetch(request(body({ operation: 'conditions', patch: { budget: { amount_krw: -1 } } })), env())).status, 400);
  assert.equal((await api.fetch(request(body({ operation: 'conditions', patch: { quantity: 5 } })), env())).status, 400);
  assert.equal((await api.fetch(request(body({ operation: 'conditions', patch: { budget: null } })), env())).status, 400);
});
test('condition edits and quick replies preserve constraints and are ranked server-side', async () => {
  const api = createApi({ fetcher: verified });
  const initial = { state: { ...singleInitial(), recipients: ['부모님'], budget: { amount_krw: 50000, shipping_included: null } }, issues: [] };
  const quick = await (await api.fetch(request(body({ session: initial, text: '배송비 포함', source: 'quick_reply' })), env())).json();
  assert.equal(quick.mode, 'rules_fast'); assert.equal(quick.session.state.budget.shipping_included, true);
  const edited = await (await api.fetch(request(body({ operation: 'conditions', session: quick.session, patch: { budget: { amount_krw: 70000 } } })), env())).json();
  assert.equal(edited.session.state.budget.shipping_included, true); assert.equal(edited.session.state.budget.amount_krw, 70000);
  assert.ok(edited.view.result.items.every(item => item.total <= 70000));
});
test('Gemini is server-only and provider failure does not silently change conditions', async () => {
  const config = { ...env(), GEMINI_API_KEY: 'secret-test' };
  let received;
  const api = createApi({ fetcher: verified, extract: async (input, products, options) => { received = options.apiKey; return finishSingle(input.state, { ...input.state, recipients: ['부모님'] }, [], products); } });
  const response = await api.fetch(request(), config); const text = await response.text();
  assert.equal(received, 'secret-test'); assert.equal(JSON.parse(text).mode, 'llm'); assert.ok(!text.includes('secret-test'));
  const failed = await createApi({ fetcher: verified, extract: async () => { throw Error('secret-test raw input'); } }).fetch(request(), config);
  assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes('secret-test'));
});
