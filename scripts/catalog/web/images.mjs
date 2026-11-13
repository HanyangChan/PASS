// ⑤ images: product photos for the picked products → data/catalog/web/images/<id>.webp (never committed).
// 1. Copy the photo the saved search page already holds (<page>_files/<image file name>).
// 2. Otherwise download it from image_url (shopping-phinf.pstatic.net) at 1–2 s intervals, as the
//    search page did (?type=f300_webp). Any 4xx/5xx stops the run; no proxies or disguised clients.
// Products still without a photo are dropped by select.mjs (rule: photo required) on the next run.
// Usage: node scripts/catalog/web/images.mjs [--no-download]
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IMAGE_PACING_MS, IMAGE_QUERY, PATHS, imageFile } from './config.mjs';

export const sourceFileName = imageUrl => basename(new URL(imageUrl).pathname);
const isJpeg = buffer => buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8;
// A few saved thumbnails are 300px JPEG instead of WebP; cwebp (libwebp) converts them when installed.
function toWebp(source, target) {
  try { execFileSync('cwebp', ['-quiet', '-q', '85', source, '-o', target]); return true; } catch { return false; }
}
const usable = file => { const head = readFileSync(file).subarray(0, 12); return isWebp(head) || isJpeg(head); };
const isWebp = buffer => buffer.length > 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';

/** Image files inside the saved pages' *_files folders, by file name (NFC; macOS stores names decomposed). */
export function savedImages(root = join(PATHS.manual, 'naver')) {
  const files = new Map();
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (dir.endsWith('_files') && /\.(jpe?g|png|webp)$/i.test(entry.name)) {
        const name = entry.name.normalize('NFC');
        if (!files.has(name)) files.set(name, full);
      }
    }
  };
  if (existsSync(root)) walk(root);
  return files;
}

/** Photo check used by select.mjs: a local file already exists, or a saved page holds it. */
export function photoChecker({ saved = savedImages(), dir = PATHS.images } = {}) {
  return item => existsSync(join(dir, imageFile(item.id)))
    || (!!item.image_url && saved.has(sourceFileName(item.image_url)) && usable(saved.get(sourceFileName(item.image_url))));
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const pace = () => IMAGE_PACING_MS[0] + Math.random() * (IMAGE_PACING_MS[1] - IMAGE_PACING_MS[0]);

export async function collectImages(products, { saved = savedImages(), dir = PATHS.images, download = true, fetcher = fetch, sleep = wait } = {}) {
  mkdirSync(dir, { recursive: true });
  const log = { copied: [], converted: [], downloaded: [], existing: [], missing: [], stopped: null };
  let first = true;
  for (const product of products) {
    const target = join(dir, imageFile(product.id));
    if (existsSync(target)) { log.existing.push(product.id); continue; }
    if (!product.image_url) { log.missing.push({ id: product.id, reason: 'no_image_url' }); continue; }
    const local = saved.get(sourceFileName(product.image_url));
    if (local && isWebp(readFileSync(local))) { copyFileSync(local, target); log.copied.push(product.id); continue; }
    if (local && isJpeg(readFileSync(local)) && toWebp(local, target)) { log.converted.push(product.id); continue; }
    if (!download) { log.missing.push({ id: product.id, reason: 'not_saved' }); continue; }
    if (!first) await sleep(pace());
    first = false;
    const url = `${product.image_url}?${IMAGE_QUERY}`;
    const response = await fetcher(url, { headers: { Accept: 'image/webp' } });
    if (!response.ok) {
      log.stopped = { id: product.id, url, status: response.status };
      break;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!isWebp(buffer)) { log.missing.push({ id: product.id, reason: `not_webp:${response.headers.get('content-type')}` }); continue; }
    writeFileSync(target, buffer);
    log.downloaded.push(product.id);
  }
  return log;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { keywords } = JSON.parse(readFileSync(PATHS.selected, 'utf8'));
  const products = [...new Map(keywords.flatMap(entry => entry.picked).map(p => [p.id, p])).values()];
  const log = await collectImages(products, { download: !process.argv.includes('--no-download') });
  const previous = existsSync(PATHS.imagesLog) ? JSON.parse(readFileSync(PATHS.imagesLog, 'utf8')) : {};
  writeFileSync(PATHS.imagesLog, JSON.stringify({ ...previous, [new Date().toISOString()]: log }, null, 1));
  const size = readdirSync(PATHS.images).reduce((n, f) => n + statSync(join(PATHS.images, f)).size, 0);
  console.log(JSON.stringify({ products: products.length, copied: log.copied.length, converted: log.converted.length, downloaded: log.downloaded.length,
    existing: log.existing.length, missing: log.missing, stopped: log.stopped, folder_mb: +(size / 1e6).toFixed(1) }));
  if (log.stopped) {
    console.error(`이미지 서버가 HTTP ${log.stopped.status}로 응답해 멈췄습니다 (${log.stopped.id}). 우회하지 않고 여기서 중단합니다.`);
    process.exit(2);
  }
}
