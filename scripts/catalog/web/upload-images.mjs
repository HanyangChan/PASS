// node --env-file=.env scripts/catalog/web/upload-images.mjs [--dry-run]
// .env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (team project admin only; never commit or deploy it).
// Uploads data/catalog/web/images/<id>.webp for every product in supabase/seed/products-kr.json to the
// Storage bucket IMAGE_BUCKET (created if missing, public read so the app can show it), with upsert.
// The files themselves never enter Git; products-kr.json already points image_url at this bucket.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IMAGE_BUCKET, PATHS } from './config.mjs';

export async function ensureBucket({ url, key, fetcher = fetch, bucket = IMAGE_BUCKET }) {
  const headers = { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'application/json' };
  const found = await fetcher(`${url}/storage/v1/bucket/${bucket}`, { headers });
  if (found.ok) return 'exists';
  const created = await fetcher(`${url}/storage/v1/bucket`, { method: 'POST', headers,
    body: JSON.stringify({ id: bucket, name: bucket, public: true, allowed_mime_types: ['image/webp'], file_size_limit: 1024 * 1024 }) });
  if (!created.ok) throw Error(`버킷을 만들지 못했습니다 (HTTP ${created.status}): ${await created.text()}`);
  return 'created';
}

export async function uploadImages(products, { url, key, dir = PATHS.images, fetcher = fetch, bucket = IMAGE_BUCKET }) {
  const result = { uploaded: 0, missing: [], failed: [] };
  for (const product of products) {
    const file = join(dir, product.image_file);
    if (!existsSync(file)) { result.missing.push(product.id); continue; }
    const response = await fetcher(`${url}/storage/v1/object/${bucket}/${encodeURIComponent(product.image_file)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, apikey: key, 'Content-Type': 'image/webp', 'x-upsert': 'true', 'Cache-Control': 'max-age=86400' },
      body: readFileSync(file),
    });
    if (response.ok) result.uploaded++;
    else result.failed.push({ id: product.id, status: response.status });
  }
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const products = JSON.parse(readFileSync(PATHS.products, 'utf8'));
  const missing = products.filter(p => !existsSync(join(PATHS.images, p.image_file))).map(p => p.id);
  if (process.argv.includes('--dry-run')) {
    console.log(JSON.stringify({ bucket: IMAGE_BUCKET, products: products.length, local_files: products.length - missing.length, missing }));
    process.exit(missing.length ? 1 : 0);
  }
  const { SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: key } = process.env;
  if (!url || !key) throw Error('SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY를 .env에 설정하세요.');
  if (missing.length) throw Error(`로컬 사진이 없는 상품 ${missing.length}개: 먼저 node scripts/catalog/web/images.mjs를 실행하세요.`);
  const bucket = await ensureBucket({ url, key });
  const result = await uploadImages(products, { url, key });
  console.log(JSON.stringify({ bucket: IMAGE_BUCKET, bucket_status: bucket, ...result }));
  if (result.failed.length) process.exit(1);
}
