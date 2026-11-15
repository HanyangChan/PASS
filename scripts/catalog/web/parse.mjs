// ② parse (no network): cached search pages → data/catalog/web/parsed.jsonl, one line per keyword.
// Usage: node scripts/catalog/web/parse.mjs --site naver
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { parseArgs } from 'node:util';
import { PATHS, SITES, loadSeeds, path } from './config.mjs';

const { values: args } = parseArgs({ options: { site: { type: 'string' } } });
if (!SITES[args.site]) {
  console.error(`--site must be one of: ${Object.keys(SITES).join(', ')}`);
  process.exit(1);
}
const adapter = await import(`./sites/${args.site}.mjs`);
const { version, items: seeds } = loadSeeds();

// An automated capture wins over a manual save of the same keyword.
function sourceOf(seed) {
  const auto = join(PATHS.raw, args.site, seed.occasion, `${seed.slug}.html`);
  if (existsSync(auto)) {
    const meta = JSON.parse(readFileSync(auto.replace(/\.html$/, '.meta.json'), 'utf8'));
    return { file: auto, mode: 'auto', collected_at: meta.collected_at };
  }
  const manual = join(PATHS.manual, args.site, seed.occasion, `${seed.slug}.html`);
  if (existsSync(manual)) return { file: manual, mode: 'manual', collected_at: statSync(manual).mtime.toISOString() };
  return null;
}

const lines = [], summary = { parsed: 0, missing: 0, blocked: 0, empty: 0 };
for (const seed of seeds) {
  const source = sourceOf(seed);
  const base = { site: args.site, seeds_version: version, occasion: seed.occasion, keyword: seed.keyword, season: seed.season, slug: seed.slug };
  if (!source) { summary.missing++; continue; }
  const html = readFileSync(source.file, 'utf8');
  const record = { ...base, mode: source.mode, file: relative(path('.'), source.file), collected_at: source.collected_at };
  if (adapter.isBlocked({ status: null, html })) {
    summary.blocked++;
    lines.push({ ...record, error: 'blocked', items: [] });
    continue;
  }
  const items = adapter.parse(html);
  if (!items.length) summary.empty++;
  else summary.parsed++;
  lines.push({ ...record, result_count: items.length, items, ...(items.length ? {} : { error: 'no_products' }) });
}
writeFileSync(PATHS.parsed, lines.map(line => JSON.stringify(line)).join('\n') + (lines.length ? '\n' : ''));
console.log(JSON.stringify({ ...summary, out: relative(path('.'), PATHS.parsed) }));
