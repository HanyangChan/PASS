// LOCAL E2E ONLY: the real Worker handler, agent graph and Gemini; Supabase auth is stubbed for the
// demo token minted by mock-supabase.js. Run: node --env-file=<file with GEMINI_API_KEY> e2e/local-api.mjs
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createApi } from '../../../../api/worker.mjs';
import { toEngineProduct, todayKst } from '../../../../lib/catalog.mjs';

const rows = JSON.parse(readFileSync(new URL('../../../../supabase/seed/products-amazon.json', import.meta.url)));
const api = createApi({
  catalog: async () => rows.map(r => toEngineProduct(r, todayKst())),
  fetcher: async (url, options) => String(url).endsWith('/auth/v1/user')
    ? (options.headers.Authorization === 'Bearer demo-token' ? Response.json({ id: 'demo-user', role: 'authenticated' }) : new Response(null, { status: 401 }))
    : fetch(url, options),
});
const unlimited = { limit: async () => ({ success: true }) };
const env = { SUPABASE_URL: 'https://pass-mock.test', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_demo', APP_ORIGINS: 'http://127.0.0.1:8767', AGENTS_MODE: 'on', GEMINI_API_KEY: process.env.GEMINI_API_KEY, IP_LIMITER: unlimited, USER_LIMITER: unlimited };
http.createServer(async (req, res) => {
  const chunks = []; for await (const c of req) chunks.push(c);
  const request = new Request(`http://127.0.0.1:8788${req.url}`, { method: req.method, headers: req.headers, ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) });
  const started = Date.now();
  const response = await api.fetch(request, env);
  const body = Buffer.from(await response.arrayBuffer());
  if (req.method === 'POST') { try { const j = JSON.parse(body); console.log(`${response.status} ${j.mode ?? j.code} llm=${j.agents?.trace?.llmCalls ?? '-'} ${Date.now() - started}ms`); } catch {} }
  res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(body);
}).listen(8788, '127.0.0.1', () => console.log(`local API http://127.0.0.1:8788 (agents on, ${env.GEMINI_API_KEY ? 'Gemini' : 'rules only'})`));
