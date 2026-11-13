import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IMAGE_STORAGE_BASE, PATHS } from '../scripts/catalog/web/config.mjs';
import { collectImages, photoChecker } from '../scripts/catalog/web/images.mjs';
import { selectForKeyword } from '../scripts/catalog/web/select.mjs';

const web = JSON.parse(readFileSync(PATHS.products, 'utf8'));
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(8)]);

test('all 590 web products point at their photo in the Storage bucket, never at the seller', () => {
  assert.equal(web.length, 590);
  for (const item of web) {
    assert.equal(item.image_file, `${item.id}.webp`, item.id);
    assert.equal(item.image_url, `${IMAGE_STORAGE_BASE}/${item.image_file}`, item.id);
    assert.match(item.source_image_url, /^https:\/\/shopping-phinf\.pstatic\.net\//, item.id);
  }
});

// The photos are not in Git (data/ is ignored): this check runs where images.mjs has been run.
test('the local images folder holds a WebP photo for every web product', { skip: !existsSync(PATHS.images) && 'data/catalog/web/images/ 없음 (images.mjs 실행 전)' }, () => {
  const files = new Set(readdirSync(PATHS.images));
  const missing = web.filter(item => !files.has(item.image_file)).map(item => item.id);
  assert.deepEqual(missing, []);
  for (const item of web) assert.equal(readFileSync(join(PATHS.images, item.image_file)).toString('ascii', 8, 12), 'WEBP', item.id);
});

test('images.mjs copies saved photos, downloads the rest and stops at the first HTTP error', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pass-images-'));
  const savedFile = join(dir, 'saved.jpg');
  writeFileSync(savedFile, WEBP);
  const saved = new Map([['1.1.jpg', savedFile]]);
  const product = (id, file) => ({ id, image_url: `https://shopping-phinf.pstatic.net/main_1/${file}` });
  const asked = [];
  const fetcher = async (url, init) => {
    asked.push([url, init.headers.Accept]);
    return url.includes('blocked') ? new Response('', { status: 403 }) : new Response(WEBP, { headers: { 'content-type': 'image/webp' } });
  };
  const out = join(dir, 'images');
  const log = await collectImages([product('naver_1', '1.1.jpg'), product('naver_2', '2.1.jpg'), product('naver_3', 'blocked.jpg'), product('naver_4', '4.1.jpg')],
    { saved, dir: out, fetcher, sleep: async () => {} });
  assert.deepEqual([log.copied, log.downloaded], [['naver_1'], ['naver_2']]);
  assert.deepEqual(log.stopped, { id: 'naver_3', url: 'https://shopping-phinf.pstatic.net/main_1/blocked.jpg?type=f300_webp', status: 403 });
  assert.deepEqual(asked.map(([url]) => url.split('/').pop()), ['2.1.jpg?type=f300_webp', 'blocked.jpg?type=f300_webp']); // naver_4 never asked
  assert.ok(asked.every(([, accept]) => accept === 'image/webp'));
  const has = photoChecker({ saved, dir: out });
  assert.deepEqual(['naver_1', 'naver_2', 'naver_3'].map(id => has({ id, image_url: `https://x/${id === 'naver_1' ? '1.1.jpg' : 'none.jpg'}` })), [true, true, false]);
});

test('select replaces a product without a photo with the next ranked one, deterministically', () => {
  const priceBands = [{ id: 'b1', min: 0, max: 9999 }, { id: 'b2', min: 10000, max: 29999 }, { id: 'b3', min: 30000, max: 49999 }];
  const item = (id, price, mall) => ({ id, title: `한과 ${id}`, price, mall, brand: null, is_ad: false, sold_out: false });
  const items = [item('a', 5000, 'm1'), item('b', 15000, 'm2'), item('c', 35000, 'm3'), item('d', 16000, 'm4')];
  const hasPhoto = product => product.id !== 'b';
  const run = () => selectForKeyword(items, { keyword: '한과', priceBands, hasPhoto });
  const { picked, excluded } = run();
  assert.deepEqual(picked.map(p => p.id), ['a', 'c', 'd']); // d (next rank, same band as b) takes b's slot
  assert.deepEqual(excluded.filter(e => e.reason === 'no_photo'), [{ id: 'b', reason: 'no_photo' }]);
  assert.deepEqual(run().picked.map(p => p.id), picked.map(p => p.id));
  assert.deepEqual(selectForKeyword(items, { keyword: '한과', priceBands }).picked.map(p => p.id), ['a', 'b', 'c']);
});
