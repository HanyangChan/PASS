// LOCAL E2E ONLY: serves the exported web app on http://127.0.0.1:8767 with the Supabase stand-in
// injected into every page, clean URLs (/chat → chat.html) and the catalog snapshot for the mock.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const web = new URL('./web/', import.meta.url);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };
const extra = { '/mock-supabase.js': new URL('./mock-supabase.js', import.meta.url), '/seed-products.json': new URL('../../../../supabase/seed/products-amazon.json', import.meta.url) };
async function load(path) {
  if (extra[path]) return [await readFile(extra[path]), extname(path)];
  const clean = decodeURIComponent(path).replace(/^\/+/, '').replace(/\.\.+/g, '') || 'index';
  for (const candidate of [clean, `${clean}.html`, `${clean}/index.html`]) {
    try { return [await readFile(new URL(candidate, web)), extname(candidate) || '.html']; } catch {}
  }
  return null;
}
http.createServer(async (req, res) => {
  const found = await load(new URL(req.url, 'http://x').pathname);
  if (!found) { res.writeHead(404); return res.end('not found'); }
  let [body, ext] = found;
  if (ext === '.html') body = body.toString('utf8').replace('<head>', '<head><script src="/mock-supabase.js"></script>');
  res.writeHead(200, { 'Content-Type': types[ext] ?? 'application/octet-stream' }); res.end(body);
}).listen(8767, '127.0.0.1', () => console.log('app http://127.0.0.1:8767/chat'));
