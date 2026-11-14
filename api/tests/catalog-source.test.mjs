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
      && item.image === `https://api.example/catalog-images/${item.id}.webp`)); // this API's own address
  });
}

test('the Worker serves web photos at /catalog-images/<file> from the ASSETS binding, and nothing else from it', async () => {
  const { fetcher } = fakeSupabase();
  const api = createApi({ fetcher });
  const asked = [];
  const ASSETS = { fetch: async url => {
    asked.push(new URL(url).pathname);
    try { return new Response(readFileSync(new URL(`../../supabase/seed/images-kr${new URL(url).pathname}`, import.meta.url))); }
    catch { return new Response(null, { status: 404 }); }
  } };
  const get = path => api.fetch(new Request(`https://api.example${path}`), env({ ASSETS }));
  const photo = await get(`/catalog-images/${web[0].image_file}`);
  assert.equal(photo.status, 200);
  assert.equal(photo.headers.get('content-type'), 'image/webp');
  assert.equal(Buffer.from(await photo.arrayBuffer()).toString('ascii', 8, 12), 'WEBP');
  assert.equal((await get('/catalog-images/naver_1.webp')).status, 404);
  for (const path of ['/catalog-images/../wrangler.jsonc', '/catalog-images/x.webp', `/${web[0].image_file}`]) assert.equal((await get(path)).status, 404, path);
  assert.deepEqual(asked, [`/${web[0].image_file}`, '/naver_1.webp']); // the file-name check runs before ASSETS
});
