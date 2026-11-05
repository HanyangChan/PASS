// Node adapter for the same Worker handler. Local limits are per process, not production limits.
import http from 'node:http';
import { Readable } from 'node:stream';
import { loadLocalEnv } from './local-env.mjs';
import { resolveLlm } from '../lib/llm-provider.mjs';
import worker from './worker.mjs';
const values = await loadLocalEnv();
const localLimit = limit => {
  const buckets = new Map();
  return { async limit({ key }) {
    const now = Date.now();
    for (const [id, bucket] of buckets) if (bucket.expires <= now) buckets.delete(id);
    const bucket = buckets.get(key) ?? { expires: now + 60000, count: 0 };
    buckets.set(key, bucket); return { success: ++bucket.count <= limit };
  } };
};
const env = { ...values, CHAT_AGENT: process.env.CHAT_AGENT || values.CHAT_AGENT || 'a-router', SUPABASE_URL: values.SUPABASE_URL || values.EXPO_PUBLIC_SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: values.SUPABASE_PUBLISHABLE_KEY || values.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, APP_ORIGINS: values.APP_ORIGINS || 'http://127.0.0.1:8766', IP_LIMITER: localLimit(120), USER_LIMITER: localLimit(30) };
const server = http.createServer(async (req, res) => {
  const controller=new AbortController();
  const aborted=()=>controller.abort();
  const closed=()=>{if(!res.writableEnded)controller.abort();};
  req.once('aborted',aborted);res.once('close',closed);
  try {
    const request = new Request(`http://127.0.0.1:8788${req.url}`, { signal: controller.signal, method: req.method, headers: { ...req.headers, 'CF-Connecting-IP': req.socket.remoteAddress }, ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: Readable.toWeb(req), duplex: 'half' }) });
    const response = await worker.fetch(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  } catch { if(!res.destroyed){res.writeHead(503);res.end('API unavailable');} }
  finally {req.removeListener('aborted',aborted);res.removeListener('close',closed);}
});
server.listen(8788, '127.0.0.1', () => {
  try { const llm=resolveLlm(env); console.log(`Recommendation API: http://127.0.0.1:8788 (${llm.provider}: ${llm.options.model}, ${llm.options.apiKey ? 'LLM enabled' : 'key missing; rules only'})`); }
  catch { console.log('Recommendation API: invalid LLM configuration'); }
});
