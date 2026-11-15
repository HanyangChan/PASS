// ① collect: open one search result page per seed keyword and cache it verbatim.
// Usage: node scripts/catalog/web/collect.mjs --site naver|coupang [--occasion holiday] [--limit 3]
//        [--dry-run] [--manual-list] [--robots] [--refresh] [--capture-json]
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { PACING, PATHS, SITES, loadSeeds, randomBetween } from './config.mjs';

const { values: args } = parseArgs({ options: {
  site: { type: 'string' }, occasion: { type: 'string' }, limit: { type: 'string' },
  'dry-run': { type: 'boolean' }, 'manual-list': { type: 'boolean' }, robots: { type: 'boolean' },
  refresh: { type: 'boolean' }, 'capture-json': { type: 'boolean' },
} });

const { version, items: allItems } = loadSeeds();

if (args.robots) {
  mkdirSync(PATHS.robots, { recursive: true });
  for (const [name, site] of Object.entries(SITES)) {
    const response = await fetch(site.robots, { signal: AbortSignal.timeout(15000) });
    const body = await response.text();
    const day = new Date().toISOString().slice(0, 10);
    writeFileSync(join(PATHS.robots, `${name}-${day}.txt`), `# ${site.robots} HTTP ${response.status} fetched ${new Date().toISOString()}\n${body}`);
    console.log(`robots: ${name} HTTP ${response.status}`);
  }
  if (!args.site) process.exit(0);
}

const site = SITES[args.site];
if (!site) {
  console.error(`--site must be one of: ${Object.keys(SITES).join(', ')}`);
  process.exit(1);
}
let items = allItems.filter(item => !args.occasion || item.occasion === args.occasion);
if (args.occasion && !items.length) throw Error(`Unknown occasion: ${args.occasion}`);
if (args.limit) items = items.slice(0, Number(args.limit));
const rawPath = item => join(PATHS.raw, args.site, item.occasion, `${item.slug}.html`);

if (args['dry-run']) {
  for (const item of items) console.log(`${item.occasion}\t${item.keyword}\t${site.searchUrl(item.keyword)}`);
  console.log(`# ${items.length} URLs (seeds ${version}, site ${args.site})`);
  process.exit(0);
}

if (args['manual-list']) {
  // Manual fallback (spec §1): user opens each URL and saves with Cmd+S to the listed path.
  const file = join(PATHS.manual, `${args.site}-urls.tsv`);
  mkdirSync(dirname(file), { recursive: true });
  const lines = items.map(item => [item.occasion, item.keyword, site.searchUrl(item.keyword),
    join('data/catalog/web/manual', args.site, item.occasion, `${item.slug}.html`)].join('\t'));
  writeFileSync(file, ['occasion\tkeyword\turl\tsave_as', ...lines].join('\n') + '\n');
  console.log(`${items.length} URLs → ${file}`);
  process.exit(0);
}

const adapter = await import(`./sites/${args.site}.mjs`);
const { chromium } = await import('playwright');
const context = await chromium.launchPersistentContext(PATHS.profile, { headless: false, viewport: { width: 1280, height: 900 }, locale: 'ko-KR' });
const page = context.pages()[0] ?? await context.newPage();
const terminal = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : null;
// The user solves any check in the visible window; we never solve or bypass it.
async function waitForHuman() {
  if (terminal) return terminal.question('브라우저 창에서 직접 확인을 마친 뒤 Enter를 누르면 같은 페이지를 다시 엽니다. ');
  console.log('브라우저 창에서 직접 확인해 주세요. 3분 동안 기다린 뒤 같은 페이지를 한 번 더 엽니다.');
  await sleep(180000);
}
const failures = [];
let opened = 0;

try {
  for (const item of items) {
    const file = rawPath(item);
    if (existsSync(file) && !args.refresh) continue;
    if (opened && opened % PACING.restEvery === 0) {
      const rest = randomBetween(PACING.restMs);
      console.log(`rest ${Math.round(rest / 1000)}s`);
      await sleep(rest);
    } else if (opened) await sleep(randomBetween(PACING.delayMs));
    opened++;

    const url = site.searchUrl(item.keyword);
    const captured = [];
    const onResponse = async response => {
      if (!args['capture-json']) return;
      const type = response.headers()['content-type'] ?? '';
      if (!type.includes('json')) return;
      try { captured.push({ url: response.url(), status: response.status(), body: await response.text() }); } catch {}
    };
    page.on('response', onResponse);
    let blocked = false, status = null;
    for (let attempt = 1; ; attempt++) {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(error => ({ error }));
      status = response?.error ? null : response?.status() ?? null;
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
      blocked = Boolean(response?.error) || adapter.isBlocked({ status, html: await page.content(), url: page.url() });
      if (!blocked) break;
      console.log(`\n[차단/보안 확인] ${item.occasion} · ${item.keyword} (status ${status ?? response.error.message})`);
      if (attempt >= PACING.maxConsecutiveBlocks) break;
      await waitForHuman();
    }
    page.off('response', onResponse);

    const meta = { url, final_url: page.url(), site: args.site, occasion: item.occasion, keyword: item.keyword,
      season: item.season, seeds_version: version, collected_at: new Date().toISOString(), status, blocked };
    if (blocked) {
      failures.push(meta);
      const evidence = join(PATHS.raw, args.site, '_blocked', `${item.occasion}-${item.slug}.html`);
      mkdirSync(dirname(evidence), { recursive: true });
      writeFileSync(evidence, await page.content().catch(() => ''));
      writeFileSync(join(PATHS.web, `blocked-${args.site}.json`), JSON.stringify(failures, null, 1));
      console.log('같은 품목에서 두 번 연속 차단되어 오늘 수집을 중단합니다.');
      break;
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, await page.content());
    writeFileSync(file.replace(/\.html$/, '.meta.json'), JSON.stringify(meta, null, 1));
    if (captured.length) writeFileSync(file.replace(/\.html$/, '.responses.json'), JSON.stringify(captured));
    console.log(`ok ${item.occasion} · ${item.keyword}${captured.length ? ` (+${captured.length} json)` : ''}`);
  }
} finally {
  terminal?.close();
  await context.close();
}
console.log(JSON.stringify({ opened, failures: failures.length }));
