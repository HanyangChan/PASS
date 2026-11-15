// Manual-save helper (spec §1 fallback). Opens each search URL in a Chrome incognito window and
// copies the target file name to the clipboard; the person saves the page with Cmd+S themselves.
// No Playwright, no simulated key presses.
// Usage: node scripts/catalog/web/manual-helper.mjs --site naver [--occasion holiday]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { PATHS, SITES, path } from './config.mjs';

const { values: args } = parseArgs({ options: { site: { type: 'string' }, occasion: { type: 'string' } } });
if (!SITES[args.site]) {
  console.error(`Usage: node scripts/catalog/web/manual-helper.mjs --site ${Object.keys(SITES).join('|')} [--occasion <id>]`);
  process.exit(1);
}
const list = resolve(PATHS.manual, `${args.site}-urls.tsv`);
if (!existsSync(list)) {
  console.error(`${list} 이 없습니다. 먼저 node scripts/catalog/web/collect.mjs --site ${args.site} --manual-list 를 실행하세요.`);
  process.exit(1);
}
const rows = readFileSync(list, 'utf8').trim().split('\n').slice(1)
  .map(line => { const [occasion, keyword, url, saveAs] = line.split('\t'); return { occasion, keyword, url, file: path(saveAs) }; })
  .filter(row => !args.occasion || row.occasion === args.occasion);
if (!rows.length) {
  console.error(`--occasion ${args.occasion} 에 해당하는 URL이 없습니다.`);
  process.exit(1);
}

const MIN_BYTES = 50_000; // A real result page is hundreds of KB; a tiny file is usually an error or check page.
const saved = row => existsSync(row.file) && statSync(row.file).size > 0;
const terminal = createInterface({ input: process.stdin, output: process.stdout });
terminal.on('SIGINT', () => { console.log('\n중단했습니다. 다시 실행하면 저장된 파일은 건너뜁니다.'); process.exit(130); });
let finished = false;
terminal.on('close', () => { if (!finished) { console.log('\n입력이 끝나 중단했습니다. 다시 실행하면 저장된 파일은 건너뜁니다.'); process.exit(130); } });

try {
  for (const [index, row] of rows.entries()) {
    const progress = `${index + 1}/${rows.length}`;
    if (saved(row)) { console.log(`[${progress}] 이미 저장됨: ${row.keyword}`); continue; }
    mkdirSync(dirname(row.file), { recursive: true });
    execFileSync('open', ['-na', 'Google Chrome', '--args', '--incognito', row.url]);
    execFileSync('pbcopy', { input: basename(row.file) });
    console.log(`\n[${progress}] ${row.occasion} · ${row.keyword}`);
    console.log(`  파일명(클립보드에 복사됨): ${basename(row.file)}`);
    console.log(`  저장 폴더: ${dirname(row.file)}`);
    console.log('  Cmd+S → 형식 "웹페이지, 전체" → Cmd+Shift+G로 위 폴더 이동 → 파일명 붙여넣기');
    for (;;) {
      const answer = (await terminal.question('  저장했으면 Enter (s: 건너뛰기, q: 종료) ')).trim().toLowerCase();
      if (answer === 'q') { finished = true; process.exit(0); }
      if (answer === 's') break;
      if (!saved(row)) { console.log(`  파일이 아직 없습니다: ${row.file}`); continue; }
      const size = statSync(row.file).size;
      if (size < MIN_BYTES) console.log(`  경고: 파일이 ${Math.round(size / 1024)}KB로 작습니다. 보안 확인·오류 페이지가 아닌지 확인하세요.`);
      break;
    }
  }
} finally {
  finished = true;
  terminal.close();
}
const done = rows.filter(saved).length;
console.log(`\n완료: ${done}/${rows.length} 저장됨${done < rows.length ? ' (건너뛴 항목은 다시 실행하면 이어서 엽니다)' : ''}`);
