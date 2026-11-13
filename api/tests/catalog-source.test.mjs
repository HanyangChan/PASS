import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createApi } from '../worker.mjs';
import { singleInitial } from '../../lib/single-gift.mjs';

const web = JSON.parse(readFileSync(new URL('../../supabase/seed/products-kr.json', import.meta.url)));
const amazonRows = JSON.parse(readFileSync(new URL('../../supabase/seed/products-amazon.json', import.meta.url))).slice(0, 40);
const env = extra => ({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', APP_ORIGINS: 'https://app.example',
  IP_LIMITER: { limit: async () => ({ success: true }) }, USER_LIMITER: { limit: async () => ({ success: true }) }, ...extra });
function fakeSupabase() {
  const calls = [];
  const fetcher = async url => {
    calls.push(String(url));
    if (String(url).includes('/auth/v1/user')) return Response.json({ id: 'owner', role: 'authenticated' });
    if (String(url).includes('/rest/v1/products')) return Response.json(amazonRows);
    return new Response('not found', { status: 404 });
  };
  return { fetcher, calls };
}
const health = async (api, extra) => (await api.fetch(new Request('https://api.example/health'), env(extra))).json();
const chat = async (api, extra, text) => (await api.fetch(new Request('https://api.example/api/chat', {
  method: 'POST', headers: { Authorization: 'Bearer test.jwt.value', 'Content-Type': 'application/json' },
  body: JSON.stringify({ operation: 'turn', session: { state: singleInitial(), issues: [] }, text, history: [] }),
}), env(extra))).json();

test('CATALOG_SOURCE defaults to the Amazon catalog', async () => {
  const { fetcher, calls } = fakeSupabase();
  const result = await health(createApi({ fetcher }), {});
  assert.equal(result.products, amazonRows.length);
  assert.equal(result.catalog, 'amazon-kaggle-v1');
  assert.ok(calls.some(url => url.includes('/rest/v1/products')));
});

test('CATALOG_SOURCE=web serves the Korean catalog without reading Supabase products', async () => {
  const { fetcher, calls } = fakeSupabase();
  const result = await health(createApi({ fetcher }), { CATALOG_SOURCE: 'web' });
  assert.equal(result.products, web.length);
  assert.equal(result.catalog, 'naver-web-v1');
  assert.ok(!calls.some(url => url.includes('/rest/v1/products')));
});

test('CATALOG_SOURCE=both merges the two catalogs', async () => {
  const { fetcher } = fakeSupabase();
  const result = await health(createApi({ fetcher }), { CATALOG_SOURCE: 'both' });
  assert.equal(result.products, amazonRows.length + web.length);
});

test('an unknown CATALOG_SOURCE is reported, not silently replaced', async () => {
  const { fetcher } = fakeSupabase();
  const response = await createApi({ fetcher }).fetch(new Request('https://api.example/health'), env({ CATALOG_SOURCE: 'naver' }));
  assert.equal(response.status, 503);
});

for (const agent of ['a-router', 'langgraph-advisors', 'legacy']) {
  test(`${agent} recommends from the web catalog when CATALOG_SOURCE=web`, async () => {
    const { fetcher } = fakeSupabase();
    const turn = await chat(createApi({ fetcher }), { CATALOG_SOURCE: 'web', CHAT_AGENT: agent }, '부모님 명절 선물 예산 5만원');
    assert.equal(turn.catalog, 'naver-web-v1');
    assert.ok(turn.view.result.items.length > 0, JSON.stringify(turn.view.result).slice(0, 200));
    assert.ok(turn.view.result.items.every(item => item.id.startsWith('naver_')
      && item.image === `https://zenmtrokvnwsekidcniy.supabase.co/storage/v1/object/public/product-images-kr/${item.id}.webp`));
  });
}

test('WEB_IMAGE_BASE serves web photos from another copy (the local dev server) and is reported on /health', async () => {
  const { fetcher } = fakeSupabase();
  const api = createApi({ fetcher });
  const base = 'http://127.0.0.1:8788/catalog-images';
  const health = await (await api.fetch(new Request('https://api.example/health'), env({ CATALOG_SOURCE: 'web', WEB_IMAGE_BASE: base }))).json();
  assert.equal(health.webImageBase, base);
  const turn = await chat(api, { CATALOG_SOURCE: 'web', CHAT_AGENT: 'a-router', WEB_IMAGE_BASE: base }, '부모님 명절 선물 예산 5만원');
  assert.ok(turn.view.result.items.length && turn.view.result.items.every(item => item.image === `${base}/${item.id}.webp`));
  const plain = await (await api.fetch(new Request('https://api.example/health'), env({ CATALOG_SOURCE: 'web' }))).json();
  assert.equal(plain.webImageBase, undefined);
});
