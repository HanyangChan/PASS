#!/usr/bin/env node
// Fails when anything outside baseline/agents/b-pipeline/ is changed, staged, untracked or about to be pushed.
// Usage: node scripts/check-scope.mjs [--push]
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (...args) => execFileSync('git', args, { cwd: workspace, encoding: 'utf8' });

const root = git('rev-parse', '--show-toplevel').trim();
const prefix = path.relative(root, workspace).split(path.sep).join('/') + '/';

const files = new Set();
// Working tree, staged and untracked files (porcelain -z: "XY path\0", renames add a second path).
const status = git('status', '--porcelain=v1', '-z', '--untracked-files=all').split('\0').filter(Boolean);
for (let i = 0; i < status.length; i++) {
  const entry = status[i];
  files.add(entry.slice(3));
  if (entry[0] === 'R' || entry[0] === 'C') files.add(status[++i]);
}
if (process.argv.includes('--push')) {
  let base = '';
  try { base = git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}').trim(); }
  catch { try { git('rev-parse', '--verify', 'origin/main'); base = 'origin/main'; } catch { base = ''; } }
  if (base) for (const f of git('diff', '--name-only', `${base}...HEAD`).split('\n').filter(Boolean)) files.add(f);
}

const outside = [...files].filter(f => !f.startsWith(prefix));
if (outside.length) {
  console.error(`범위 밖 변경이 있습니다. ${prefix} 안의 파일만 커밋·푸시할 수 있습니다.`);
  for (const f of outside) console.error(`  - ${f}`);
  console.error('되돌리기: git restore --staged <파일> && git restore <파일>  (새 파일이면 삭제)');
  process.exit(1);
}
console.log(`범위 확인 통과: 변경 ${files.size}개 모두 ${prefix} 안에 있습니다.`);
