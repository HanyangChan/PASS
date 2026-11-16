// Run against an Expo process built with EXPO_NO_DOTENV=1 and pass-mock.test settings.
// All non-local network requests are intercepted; no real accounts or database writes.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createApi } from '../api/worker.mjs';
import { singleInitial } from '../lib/single-gift.mjs';
import { product, record, scope } from '../tests/fixtures/context-feedback.mjs';

const base = 'http://localhost:8771', output = new URL('../work/context-feedback/ui/', import.meta.url);
const products = [product('coffee-a', 'coffee_tea', { name: '커피 선물 세트 A', rating_count: 30 }),
  product('coffee-b', 'coffee_tea', { name: '커피 선물 세트 B', rating_count: 20 }),
  product('coffee-c', 'coffee_tea', { name: '커피 선물 세트 C', rating_count: 10 }),
  product('watch-a', 'watch', { name: '시계 선물 세트' })];
const state = { ...singleInitial(), recipients: ['어머니'], occasion: '생일', preferences: ['category:coffee_tea', 'type:coffee'], budget: { amount_krw: 50000, shipping_included: true } };
const owner = '00000000-0000-4000-8000-000000000001';
const user = { id: owner, aud: 'authenticated', role: 'authenticated', email: 'local@example.test', app_metadata: {}, user_metadata: {}, created_at: '2026-11-16T00:00:00Z' };
const token = [Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: owner, role: 'authenticated', exp: 4102444800 })).toString('base64url'), 'synthetic'].join('.');
const session = { access_token: token, refresh_token: 'synthetic-refresh', expires_at: 4102444800, expires_in: 3600, token_type: 'bearer', user };
const apiEnv = { CHAT_AGENT: 'a-router', SUPABASE_URL: 'https://pass-mock.test', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic',
  APP_ORIGINS: base, IP_LIMITER: { limit: async () => ({ success: true }) }, USER_LIMITER: { limit: async () => ({ success: true }) } };
const api = createApi({ catalog: async () => products, fetcher: async url => {
  assert.equal(String(url), 'https://pass-mock.test/auth/v1/user'); return Response.json(user);
} });
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.PASS_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' });
const report = [];
try {
  for (const account of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 430, height: 932 } });
    const errors = [], requests = [], writes = [];
    const vote = record(products[1], state);
    const rows = { gift_records: [], conversations: account ? [
      { id: 'active', user_id: owner, title: '현재 계정 대화', updated_at: '2026-11-16T02:00:00Z', conditions: { ...state, _pass: { version: 1, committed: true, message_ids: ['active-message'], issues: [], feedback: [vote] } } },
      { id: 'past', user_id: owner, title: '이전 친구 선물', updated_at: '2026-11-16T01:00:00Z', conditions: { ...state, recipients: ['친구'], _pass: { version: 1, committed: true, message_ids: ['past-message'], issues: [], feedback: [{ ...vote, kind: 'reason_helpfulness' }] } } },
    ] : [], messages: account ? [
      { id: 'active-message', conversation_id: 'active', user_id: owner, role: 'user', content: '어머니 생일 커피 선물', created_at: '2026-11-16T02:00:00Z' },
      { id: 'past-message', conversation_id: 'past', user_id: owner, role: 'user', content: '친구 선물 기록', created_at: '2026-11-16T01:00:00Z' },
    ] : [] };
    if (account) await context.addInitScript(({ session }) => localStorage.setItem('sb-pass-mock-auth-token', JSON.stringify(session)), { session });
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      const fulfill = body => route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Headers': '*' }, body: JSON.stringify(body) });
      if (url.origin === base) return route.continue();
      if (url.hostname === '127.0.0.1' && url.port === '18788') {
        if (url.pathname === '/health') return fulfill({ ok: true, catalog: 'amazon-kaggle-v1', availableAgents: ['a-router'] });
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
        const body = request.postDataJSON(); requests.push(structuredClone(body));
        const response = await api.fetch(new Request(request.url(), { method: request.method(), headers: request.headers(), body: request.postData() }), apiEnv);
        return route.fulfill({ status: response.status, headers: Object.fromEntries(response.headers), body: await response.text() });
      }
      if (url.hostname !== 'pass-mock.test') return route.abort();
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': base, 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS' } });
      if (url.pathname.startsWith('/auth/')) return fulfill(user);
      const table = url.pathname.split('/').at(-1);
      if (table === 'products') return fulfill(products.map(p => ({ ...p, stock: p.stock_sets, shipping_fee_krw: 0, arrival_days: 1, is_active: true })));
      if (!Object.hasOwn(rows, table)) return fulfill([]);
      let selected = rows[table].filter(row => [...url.searchParams].every(([key, filter]) => {
        if (key === 'conditions->_pass->>committed') return row.conditions?._pass?.committed === true;
        if (filter.startsWith('eq.')) return String(row[key]) === filter.slice(3);
        if (filter.startsWith('in.')) return filter.slice(3).replace(/^\(|\)$/g, '').split(',').includes(String(row[key]));
        return true;
      }));
      if (request.method() === 'GET') {
        if (table === 'conversations') selected.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
        if (url.searchParams.has('limit')) selected = selected.slice(0, Number(url.searchParams.get('limit')));
        return fulfill(request.headers().accept?.includes('application/vnd.pgrst.object+json') ? selected[0] ?? null : selected);
      }
      const payload = request.postDataJSON(); writes.push({ table, method: request.method() });
      if (request.method() === 'POST') for (const row of Array.isArray(payload) ? payload : [payload]) {
        const found = rows[table].find(old => old.id === row.id);
        if (found) { if (!request.headers().prefer?.includes('ignore-duplicates')) Object.assign(found, row); }
        else rows[table].push({ ...row, updated_at: new Date().toISOString() });
      }
      if (request.method() === 'PATCH') for (const row of selected) Object.assign(row, payload, { updated_at: new Date().toISOString() });
      return fulfill([]);
    });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`${base}/chat`, { waitUntil: 'domcontentloaded', timeout: 240000 });
      const input = page.getByLabel('선물 조건 입력', { exact: true });
      await input.waitFor({ timeout: 120000 });
      if (!account) {
        await input.fill('어머니 생일 선물 5만원 배송비 포함 커피 좋아하셔');
        await page.getByLabel('메시지 보내기', { exact: true }).click();
      }
      const giftLike = page.getByRole('button', { name: /이 상황에 좋아요$/ }).first();
      await giftLike.waitFor({ timeout: 60000 });
      if (await giftLike.getAttribute('aria-pressed') !== 'true') await giftLike.click();
      await page.waitForFunction(() => [...document.querySelectorAll('[aria-label]')].some(el =>
        el.getAttribute('aria-label')?.endsWith('이 상황에 좋아요') && el.getAttribute('aria-pressed') === 'true'));
      assert.equal(await giftLike.getAttribute('aria-pressed') ?? await giftLike.getAttribute('aria-selected'), 'true');
      const reasonLike = page.getByRole('button', { name: /추천 이유가 도움이 됐어요$/ }).first();
      await reasonLike.click();
      await input.fill('다시 추천해줘');
      await page.getByLabel('메시지 보내기', { exact: true }).click();
      await page.getByLabel('메시지 보내기', { exact: true }).waitFor({ state: 'visible' });
      // The empty composer keeps Send disabled even after a successful request.
      // Waiting for the input to become editable checks pending state instead.
      await input.fill('');
      if (account) {
        assert.ok(requests.some(r => r.feedback?.some(v => v.kind === 'gift_preference')));
        assert.ok(requests.every(r => !r.feedback?.some(v => v.kind === 'reason_helpfulness')));
        assert.ok(writes.length > 0);
      } else {
        assert.equal(requests.length, 0, 'guest stays on the device');
      }
      const toggle = page.getByRole('switch', { name: /상품 평가 사용/ });
      await toggle.click();
      assert.equal(await toggle.getAttribute('aria-checked'), 'false');
      await page.screenshot({ path: fileURLToPath(new URL(account ? 'account.png' : 'guest.png', output)), fullPage: true });
      if (!account) {
        await page.getByText('새 대화', { exact: true }).click();
        await input.fill('어머니 생신 꽃다발 5만원 배송비 포함. 땅콩 알레르기 있어요');
        await page.getByLabel('메시지 보내기', { exact: true }).click();
        await input.fill('');
        await page.getByText(/요청한 상품 종류에 맞는 후보를 찾지 못했어요/).first().waitFor();
        assert.equal(await page.getByRole('button', { name: /이 상황에 좋아요$/ }).count(), 0, 'missing flowers must not become coffee cards');
        await page.getByText('꽃다발 선호', { exact: false }).first().waitFor();
        assert.ok(!(await page.locator('body').innerText()).includes('type:bouquet'));
        await page.getByRole('button', { name: '예산을 직접 입력하기', exact: true }).click();
        assert.equal(await input.inputValue(), '예산을 ');
        assert.equal(await page.getByRole('button', { name: /이 상황에 좋아요$/ }).count(), 0);
        await input.fill('');
        await page.getByRole('button', { name: '상품 종류를 바꿔 입력하기', exact: true }).click();
        await page.getByText(/제외 조건은 그대로 유지해요/).first().waitFor();
        await page.getByText('조건 추가', { exact: true }).click();
        assert.equal(await page.getByLabel('피할 성분', { exact: true }).inputValue(), '땅콩');
        await page.getByRole('button', { name: '취소', exact: true }).click();
        await page.screenshot({ path: fileURLToPath(new URL('empty-request.png', output)), fullPage: true });
      }
      if (account) {
        await page.goto(`${base}/mypage`);
        await page.getByText('이전 친구 선물', { exact: true }).click({ timeout: 30000 });
        await page.getByText('친구 선물 기록', { exact: true }).waitFor();
      }
      assert.deepEqual(errors, []);
      report.push({ mode: account ? 'mock-account' : 'guest', pass: true, requests: requests.length, writes: writes.length, ...(!account ? { emptyRequestChecked: true } : {}) });
    } catch (error) {
      const giftButtons = page.getByRole('button', { name: /이 상황에 좋아요$/ });
      await writeFile(new URL(`${account ? 'account' : 'guest'}-failure.txt`, output), (await page.locator('body').innerText()) + '\n' + errors.join('\n') + '\n' +
        (await giftButtons.count() ? await giftButtons.first().evaluate(el => el.outerHTML) : 'no gift button'));
      throw error;
    } finally { await context.close(); }
  }
} finally {
  await browser.close();
  await writeFile(new URL('results.json', output), JSON.stringify(report, null, 2) + '\n');
}
console.log(JSON.stringify(report, null, 2));
