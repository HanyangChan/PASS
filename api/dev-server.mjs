// Node adapter for the same Worker handler. Local limits are per process, not production limits.
import http from 'node:http';
import { Readable } from 'node:stream';
import { loadLocalEnv } from './local-env.mjs';
import { localConfig } from './dev-config.mjs';
import { createApi } from './worker.mjs';
const worker=createApi({onDiagnostic:event=>console.warn(JSON.stringify(event))});
let config;
try { config=localConfig(await loadLocalEnv()); }
catch(error) { console.error(`API 시작 실패: ${error.message}`); process.exit(1); }
const localLimit = limit => {
  const buckets = new Map();
  return { async limit({ key }) {
    const now = Date.now();
    for (const [id, bucket] of buckets) if (bucket.expires <= now) buckets.delete(id);
    const bucket = buckets.get(key) ?? { expires: now + 60000, count: 0 };
    buckets.set(key, bucket); return { success: ++bucket.count <= limit };
  } };
};
const {port,llm}=config;
const env={...config.env,IP_LIMITER:localLimit(120),USER_LIMITER:localLimit(30)};
const server = http.createServer(async (req, res) => {
  const controller=new AbortController();
  const aborted=()=>controller.abort();
  const closed=()=>{if(!res.writableEnded)controller.abort();};
  req.once('aborted',aborted);res.once('close',closed);
  try {
    const request = new Request(`http://127.0.0.1:${port}${req.url}`, { signal: controller.signal, method: req.method, headers: { ...req.headers, 'CF-Connecting-IP': req.socket.remoteAddress }, ...(req.method === 'GET' || req.method === 'HEAD' ? {} : { body: Readable.toWeb(req), duplex: 'half' }) });
    const response = await worker.fetch(request, env);
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  } catch { if(!res.destroyed){res.writeHead(503);res.end('API unavailable');} }
  finally {req.removeListener('aborted',aborted);res.removeListener('close',closed);}
});
server.on('error',error=>{
  console.error(error.code==='EADDRINUSE'?`API 포트 ${port}가 이미 사용 중입니다. 기존 API를 종료하거나 API_PORT를 변경하세요.`:`API 시작 실패 (${error.code||'unknown'}).`);
  process.exitCode=1;
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Recommendation API: http://127.0.0.1:${port} (${llm.provider}: ${llm.options.model}, ${llm.options.apiKey ? 'LLM enabled' : '규칙 모드 가능 (A/B), C/D는 LLM_API_KEY 필요'})`);
});
