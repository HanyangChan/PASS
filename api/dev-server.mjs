// Node adapter for the same Worker handler. Local limits are per process, not production limits.
import http from 'node:http';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import worker from './worker.mjs';
const values = {};
for (const path of [new URL('../mobile/.env.local', import.meta.url), new URL('./.dev.vars', import.meta.url)]) {
  try { for (const line of (await readFile(path, 'utf8')).split('\n')) { const match = /^([A-Z_]+)=(.*)$/.exec(line); if (match) values[match[1]] = match[2].trim().replace(/^['"]|['"]$/g, ''); } }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const localLimit = limit => {
  const buckets = new Map();
  return { async limit({ key }) {
    const now = Date.now();
    for (const [id, bucket] of buckets) if (bucket.expires <= now) buckets.delete(id);
    const bucket = buckets.get(key) ?? { expires: now + 60000, count: 0 };
    buckets.set(key, bucket); return { success: ++bucket.count <= limit };
  } };
};
const env = { ...values, SUPABASE_URL: values.SUPABASE_URL || values.EXPO_PUBLIC_SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: values.SUPABASE_PUBLISHABLE_KEY || values.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY, APP_ORIGINS: values.APP_ORIGINS || 'http://127.0.0.1:8766', IP_LIMITER: localLimit(120), USER_LIMITER: localLimit(30) };
const server = http.createServer(async (req, res) => {
  try {
    const request = new Request(`http://127.0.0.1:8788${req.url}`, { method: req.method, headers: { ...req.headers, 'CF-Connecting-IP': req.socket.remoteAddress }, ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: Readable.toWeb(req), duplex: 'half' }) });
    const response = await worker.fetch(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(503); res.end('API unavailable'); }
});
server.listen(8788, '127.0.0.1', () => console.log(`Recommendation API: http://127.0.0.1:8788 (${env.GEMINI_API_KEY ? 'Gemini enabled' : 'rules'})`));
