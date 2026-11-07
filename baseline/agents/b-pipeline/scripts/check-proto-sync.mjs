#!/usr/bin/env node
// proto/ (main 6beb5af 복사본)와 app/ 의 각 파일이 proto/UPSTREAM.md 의 SHA-256 과 같은지 확인한다.
// 다르면 UPSTREAM.md 의 "패치된 파일" 표에 있어야 하고, 목록에 없는 새 파일은 "추가된 파일" 표에 있어야 한다.
// 또 proto/ 에는 main 테스트 파일이 들어오면 안 된다(baseline `node --test`가 하위 폴더 전체를 찾는다).
// 사용: node scripts/check-proto-sync.mjs  (또는 import { checkProtoSync })
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IGNORED_DIRS = new Set(['node_modules', 'dist', '.expo']);
const IGNORED_FILES = new Set(['.DS_Store']);
// Node 22 `node --test` 기본 패턴과 같은 이름의 파일.
const TEST_NAME = /(^|\/)(test\.[cm]?js|test-[^/]*\.[cm]?js|[^/]*[.\-_]test\.[cm]?js)$|(^|\/)test\/.*\.[cm]?js$/;

const sha256 = file => createHash('sha256').update(readFileSync(file)).digest('hex');

function walk(root) {
  const out = [];
  const visit = dir => {
    for (const name of readdirSync(dir)) {
      if (IGNORED_FILES.has(name)) continue;
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) { if (!IGNORED_DIRS.has(name)) visit(full); } else out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  if (existsSync(root)) visit(root);
  return out.sort();
}

// "## <제목>" 아래의 마크다운 표 행 `| \`경로\` | ... |` 을 읽는다.
export function parseUpstream(text) {
  const sections = {};
  let current = null;
  for (const line of text.split('\n')) {
    const heading = line.match(/^##\s+(.*)$/);
    if (heading) { current = heading[1].trim(); sections[current] = []; continue; }
    const row = line.match(/^\|\s*`([^`]+)`\s*\|(.*)\|\s*$/);
    if (row && current) sections[current].push({ file: row[1], cells: row[2].split('|').map(c => c.trim()) });
  }
  return sections;
}

export function checkProtoSync({ root = workspace } = {}) {
  const errors = [];
  const upstreamPath = path.join(root, 'proto', 'UPSTREAM.md');
  if (!existsSync(upstreamPath)) return ['proto/UPSTREAM.md 가 없습니다.'];
  const sections = parseUpstream(readFileSync(upstreamPath, 'utf8'));
  const hashes = new Map((sections['원본 해시'] ?? []).map(r => [r.file, r.cells[0]]));
  const patched = new Set((sections['패치된 파일'] ?? []).map(r => r.file));
  const added = new Set((sections['추가된 파일'] ?? []).map(r => r.file));
  if (!hashes.size) errors.push('UPSTREAM.md 에 "원본 해시" 표가 없습니다.');

  const present = new Set();
  for (const base of ['proto', 'app']) {
    for (const rel of walk(path.join(root, base))) {
      const key = `${base}/${rel}`;
      if (key === 'proto/UPSTREAM.md') continue;
      present.add(key);
      if (base === 'proto' && TEST_NAME.test(rel)) errors.push(`${key}: main 테스트 파일은 복사하지 않습니다 (K56).`);
      const expected = hashes.get(key);
      const actual = sha256(path.join(root, key));
      if (expected === undefined) {
        if (!added.has(key)) errors.push(`${key}: 원본 해시도 "추가된 파일" 목록도 없는 새 파일입니다.`);
      } else if (expected !== actual) {
        if (!patched.has(key)) errors.push(`${key}: 원본(main)과 다른데 "패치된 파일" 목록에 없습니다.`);
      } else if (patched.has(key)) {
        errors.push(`${key}: 원본과 같은데 "패치된 파일" 목록에 있습니다. 목록에서 지우세요.`);
      }
    }
  }
  for (const key of hashes.keys()) if (!present.has(key)) errors.push(`${key}: UPSTREAM.md 에 있지만 파일이 없습니다.`);
  for (const key of patched) if (!hashes.has(key)) errors.push(`${key}: "패치된 파일"인데 원본 해시가 없습니다.`);
  for (const key of added) if (hashes.has(key)) errors.push(`${key}: "추가된 파일"인데 원본 해시가 있습니다.`);
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkProtoSync();
  if (errors.length) { console.error('proto 동기화 확인 실패:'); for (const e of errors) console.error(`  - ${e}`); process.exit(1); }
  console.log('proto 동기화 확인 통과: 원본과 다른 파일은 모두 패치 목록에 있습니다.');
}
