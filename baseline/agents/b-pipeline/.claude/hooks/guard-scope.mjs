#!/usr/bin/env node
// Claude Code PreToolUse hook. Exit 2 blocks the tool call and shows stderr to the agent.
// 1) File edits must stay inside baseline/agents/b-pipeline/.
// 2) git commit / git push must pass scripts/check-scope.mjs first.
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

// macOS reports this Korean folder name as NFD in some places and NFC in others; compare in NFC only.
const nfc = p => String(p).normalize('NFC');
const workspace = nfc(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..'));
const input = JSON.parse(readFileSync(0, 'utf8') || '{}');
const tool = input.tool_name ?? '';
const args = input.tool_input ?? {};
const block = msg => { console.error(msg); process.exit(2); };
const inside = (p, dir) => { const r = path.relative(nfc(dir), nfc(p)); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };

if (['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].includes(tool)) {
  const raw = args.file_path ?? args.notebook_path ?? '';
  const target = nfc(path.resolve(nfc(input.cwd ?? workspace), nfc(raw)));
  // Claude Code's own plan/memory files live under ~/.claude; scratch files under the OS temp dir.
  const allowed = [workspace, path.join(os.homedir(), '.claude'), os.tmpdir()];
  if (!allowed.some(dir => inside(target, dir)))
    block(`차단: ${target} 은(는) 작업 공간 밖입니다. baseline/agents/b-pipeline/ 안의 파일만 수정할 수 있습니다. 공통 코어·다른 폴더 변경이 필요하면 docs/decisions.md에 요청으로 적으세요.`);
}

if (tool === 'Bash') {
  const cmd = String(args.command ?? '');
  if (/\bgit\s+push\b[^\n]*(--force|\s-f\b)/.test(cmd)) block('차단: force push는 사용하지 않습니다.');
  const push = /\bgit\s+push\b/.test(cmd);
  if (push || /\bgit\s+commit\b/.test(cmd)) {
    try {
      execFileSync('node', [path.join(workspace, 'scripts', 'check-scope.mjs'), ...(push ? ['--push'] : [])], { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      block(String(e.stderr || e.stdout || '범위 확인 실패'));
    }
  }
}
process.exit(0);
