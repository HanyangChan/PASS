// LOCAL E2E ONLY: runs the Worker with a seeded catalog and the demo token from mock-supabase.js.
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createApi } from '../../../../api/worker.mjs';
import { loadLocalEnv } from '../../../../api/local-env.mjs';
import { toEngineProduct, todayKst } from '../../../../lib/catalog.mjs';

const rows = JSON.parse(readFileSync(new URL('../../../../supabase/seed/products-amazon.json', import.meta.url)));
const api = createApi({
  catalog: async () => rows.map(r => toEngineProduct(r, todayKst())),
  fetcher: async (url, options) => String(url).endsWith('/auth/v1/user')
    ? (options.headers.Authorization === 'Bearer demo-token' ? Response.json({ id: 'demo-user', role: 'authenticated' }) : new Response(null, { status: 401 }))
    : fetch(url, options),
});
const unlimited = { limit: async () => ({ success: true }) };
const env = {
  ...await loadLocalEnv(), CHAT_AGENT: 'a-router',
  SUPABASE_URL: 'https://pass-mock.test', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_demo',
  APP_ORIGINS: 'http://127.0.0.1:8767', IP_LIMITER: unlimited, USER_LIMITER: unlimited,
};
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const request = new Request(`http://127.0.0.1:8788${req.url}`, { method: req.method, headers: req.headers, ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) });
  const started = Date.now();
  const response = await api.fetch(request, env);
  const body = Buffer.from(await response.arrayBuffer());
  if (req.method === 'POST') { try { const j = JSON.parse(body); console.log(`${response.status} ${j.agent ?? j.code} llm=${j.routing?.llmCalls ?? '-'} ${Date.now() - started}ms`); } catch {} }
  res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(body);
}).listen(8788, '127.0.0.1', () => console.log('local demo API http://127.0.0.1:8788'));
