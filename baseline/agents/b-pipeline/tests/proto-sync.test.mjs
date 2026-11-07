// P7 / K56: proto/ and app/ stay in step with proto/UPSTREAM.md, and proto/ never holds main test files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, appendFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { checkProtoSync, parseUpstream } from '../scripts/check-proto-sync.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('real workspace: every file in proto/ and app/ matches UPSTREAM.md or is listed as patched/added', () => {
  assert.deepEqual(checkProtoSync(), []);
});

test('UPSTREAM.md pins main 6beb5af and has hashes for the copied lib files', () => {
  const text = readFileSync(path.join(workspace, 'proto', 'UPSTREAM.md'), 'utf8');
  assert.match(text, /6beb5af/);
  const hashes = parseUpstream(text)['원본 해시'].map(r => r.file);
  for (const f of ['proto/lib/engine.mjs', 'proto/lib/llm.mjs', 'proto/lib/single-gift.mjs', 'proto/api/worker.mjs']) assert.ok(hashes.includes(f), f);
  assert.ok(hashes.every(h => !/\.test\.|\/tests?\//.test(h)), '테스트 파일 해시가 목록에 있으면 안 된다');
});

test('proto/ has no file that `node --test` would pick up', () => {
  const text = readFileSync(path.join(workspace, 'proto', 'UPSTREAM.md'), 'utf8');
  const files = parseUpstream(text)['원본 해시'].map(r => r.file).filter(f => f.startsWith('proto/'));
  assert.ok(files.length >= 10);
  for (const f of files) assert.doesNotMatch(f, /(^|\/)(test-[^/]*\.[cm]?js|[^/]*[.\-_]test\.[cm]?js|test\.[cm]?js)$|\/test\//);
});

// A scratch copy of just proto/ + app/ (no node_modules) to break things on purpose.
function scratch() {
  const dir = mkdtempSync(path.join(tmpdir(), 'proto-sync-'));
  for (const d of ['proto', 'app']) cpSync(path.join(workspace, d), path.join(dir, d), { recursive: true, filter: s => !/node_modules|[/\\]dist([/\\]|$)|\.expo/.test(s) });
  return dir;
}
const withScratch = fn => () => { const dir = scratch(); try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); } };

test('an unlisted edit to a proto file is reported', withScratch(dir => {
  appendFileSync(path.join(dir, 'proto/lib/engine.mjs'), '\n// edited\n');
  const errors = checkProtoSync({ root: dir });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /proto\/lib\/engine\.mjs.*패치된 파일/);
}));

test('an unlisted new file in app/ is reported', withScratch(dir => {
  writeFileSync(path.join(dir, 'app/src/Surprise.tsx'), 'export {};\n');
  assert.match(checkProtoSync({ root: dir }).join('\n'), /app\/src\/Surprise\.tsx.*새 파일/);
}));

test('a main test file copied into proto/ is reported', withScratch(dir => {
  mkdirSync(path.join(dir, 'proto/api/tests'), { recursive: true });
  writeFileSync(path.join(dir, 'proto/api/tests/worker.test.mjs'), '');
  writeFileSync(path.join(dir, 'proto/lib/test-helpers.mjs'), '');
  const out = checkProtoSync({ root: dir }).join('\n');
  assert.match(out, /proto\/api\/tests\/worker\.test\.mjs.*테스트 파일/);
  assert.match(out, /proto\/lib\/test-helpers\.mjs.*테스트 파일/);
}));

test('a deleted proto file is reported', withScratch(dir => {
  rmSync(path.join(dir, 'proto/lib/language.mjs'));
  assert.match(checkProtoSync({ root: dir }).join('\n'), /proto\/lib\/language\.mjs.*파일이 없습니다/);
}));

test('a file listed as patched but identical to main is reported', withScratch(dir => {
  const up = path.join(dir, 'proto/UPSTREAM.md');
  const text = readFileSync(up, 'utf8').replace('## 패치된 파일', '## 패치된 파일\n\n| `proto/lib/engine.mjs` | 가짜 | — |');
  writeFileSync(up, text);
  assert.match(checkProtoSync({ root: dir }).join('\n'), /proto\/lib\/engine\.mjs.*원본과 같은데/);
}));
