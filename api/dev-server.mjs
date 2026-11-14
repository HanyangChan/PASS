// Node adapter for the same Worker handler. Local limits are per process, not production limits.
import http from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { loadLocalEnv } from './local-env.mjs';
import { localConfig } from './dev-config.mjs';
import { createApi } from './worker.mjs';
import { todayKst } from '../lib/catalog.mjs';
import { CATALOG_IMAGE_PATH, catalogSource, fromWebItem, mergeCatalogs } from '../lib/catalog-source.mjs';
import webCatalog from '../supabase/seed/products-kr.json' with { type: 'json' };
let config;
let flowerAdvice;
let catalog;
let shoppingText;
// Web catalog photos are committed in supabase/seed/images-kr/ and served at /catalog-images/<file>.
const IMAGES_DIR = fileURLToPath(new URL('../supabase/seed/images-kr/', import.meta.url));
let apiBase;
try {
  config=localConfig(await loadLocalEnv());
  apiBase = `http://127.0.0.1:${config.port}`;
  if (process.env.FLOWER_DB_PATH) {
    const { createFlowerAdvice } = await import('./flower-season.mjs');
    flowerAdvice = createFlowerAdvice(process.env.FLOWER_DB_PATH);
  }
  const shoppingDbPath = process.env.SHOPPING_DB_PATH;
  if (shoppingDbPath) {
    const { readShoppingCatalog, rewriteShoppingRequest } = await import('./local-shopping-catalog.mjs');
    shoppingText = rewriteShoppingRequest;
    // The snapshot holds the Amazon rows plus PR #17 observations; CATALOG_SOURCE decides which base list
    // goes with the observations, and only the same product is dropped when lists overlap.
    const source = catalogSource(config.env.CATALOG_SOURCE);
    const build = today => {
      const rows = readShoppingCatalog(shoppingDbPath, today);
      const observations = rows.filter(product => product.id.startsWith('searchapi-'));
      const amazon = source === 'web' ? [] : rows.filter(product => !product.id.startsWith('searchapi-'));
      const web = source === 'amazon' ? [] : webCatalog.map(item => fromWebItem(item, today, { apiBase }));
      return mergeCatalogs(amazon, web, observations);
    };
    let day = todayKst();
    let products = build(day);
    catalog = () => {
      const today = todayKst();
      if (day !== today) {
        products = build(today);
        day = today;
      }
      return products;
    };
  }
}
catch(error) { console.error(`API 시작 실패: ${error.message}`); process.exit(1); }
const worker=createApi({catalog,flowerAdvice,shoppingText,onDiagnostic:event=>console.warn(JSON.stringify(event))});
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
  const image = req.method === 'GET' ? req.url.match(CATALOG_IMAGE_PATH) : null;
  if (image) {
    const file = IMAGES_DIR + image[1];
    if (!existsSync(file)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'image/webp', 'Cache-Control': 'max-age=3600' });
    createReadStream(file).pipe(res);
    return;
  }
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
