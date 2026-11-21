// Manual-save helper (spec §1 fallback). Opens each search URL in a Chrome incognito window and
// copies the target file name to the clipboard; the person saves the page with Cmd+S themselves.
// No Playwright, no simulated key presses.
// Usage: node scripts/catalog/web/manual-helper.mjs --site naver [--occasion holiday] [--occasion-group care] [--inbox]
// --inbox: save every page into one folder (data/catalog/web/manual/_inbox); the helper files each page under
// manual/<site>/<occasion>/ by itself (inbox.mjs), so the save dialog never needs another folder.
// SEEDS=extra reads naver-urls.extra.tsv (the v2-extra run); the default is the v1.2 list.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { PATHS, SITES, loadSeeds, path } from './config.mjs';
import { sortInbox } from './inbox.mjs';

const { values: args } = parseArgs({ options: { site: { type: 'string' }, occasion: { type: 'string' }, 'occasion-group': { type: 'string' }, inbox: { type: 'boolean' } } });
if (!SITES[args.site]) {
  console.error(`Usage: node scripts/catalog/web/manual-helper.mjs --site ${Object.keys(SITES).join('|')} [--occasion <id>] [--occasion-group <group>] [--inbox]`);
  process.exit(1);
}
const list = resolve(PATHS.urlList(args.site));
const { groups } = loadSeeds();
if (args['occasion-group'] && !groups[args['occasion-group']]) {
  console.error(`--occasion-group must be one of: ${Object.keys(groups).join(', ') || '(this seed set has no groups)'}`);
  process.exit(1);
}
if (!existsSync(list)) {
  console.error(`${list} 이 없습니다. 먼저 node scripts/catalog/web/collect.mjs --site ${args.site} --manual-list 를 실행하세요.`);
  process.exit(1);
}
const rows = readFileSync(list, 'utf8').trim().split('\n').slice(1)
  .map(line => { const [occasion, keyword, url, saveAs, group = ''] = line.split('\t'); return { occasion, keyword, url, group, file: path(saveAs) }; })
  .filter(row => (!args.occasion || row.occasion === args.occasion) && (!args['occasion-group'] || row.group === args['occasion-group']));
if (!rows.length) {
  console.error(`--occasion ${args.occasion ?? ''} --occasion-group ${args['occasion-group'] ?? ''} 에 해당하는 URL이 없습니다.`);
  process.exit(1);
}

if (args.inbox) { mkdirSync(PATHS.inbox, { recursive: true }); const first = sortInbox({ site: args.site }); if (first.moved.length) console.log(`inbox에 있던 ${first.moved.length}개를 분류했습니다.`); }
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
    mkdirSync(args.inbox ? PATHS.inbox : dirname(row.file), { recursive: true });
    execFileSync('open', ['-na', 'Google Chrome', '--args', '--incognito', row.url]);
    execFileSync('pbcopy', { input: basename(row.file) });
    console.log(`\n[${progress}] ${row.occasion} · ${row.keyword}`);
    console.log(`  파일명(클립보드에 복사됨): ${basename(row.file)}`);
    console.log(`  저장 폴더: ${args.inbox ? PATHS.inbox : dirname(row.file)}${args.inbox ? ' (모든 항목 같은 폴더)' : ''}`);
    console.log(args.inbox ? '  Cmd+S → 형식 "웹페이지, 전체" → 파일명 붙여넣기 (폴더는 처음 한 번만 Cmd+Shift+G로 이동, 이후 Chrome이 기억함)' : '  Cmd+S → 형식 "웹페이지, 전체" → Cmd+Shift+G로 위 폴더 이동 → 파일명 붙여넣기');
    for (;;) {
      const answer = (await terminal.question('  저장했으면 Enter (s: 건너뛰기, q: 종료) ')).trim().toLowerCase();
      if (answer === 'q') { finished = true; process.exit(0); }
      if (answer === 's') break;
      if (args.inbox) for (const m of sortInbox({ site: args.site }).moved) console.log(`  분류: ${m.keyword} → ${m.to}`);
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
if (args.inbox) { const rest = sortInbox({ site: args.site }); for (const s of rest.skipped) console.log(`inbox에 남음: ${s.file} — ${s.reason}`); }
const done = rows.filter(saved).length;
console.log(`\n완료: ${done}/${rows.length} 저장됨${done < rows.length ? ' (건너뛴 항목은 다시 실행하면 이어서 엽니다)' : ''}`);
