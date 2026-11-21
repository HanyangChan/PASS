// Sorts manually saved search pages from the inbox folder into manual/<site>/<occasion>/ (see inbox.mjs).
// Usage: SEEDS=extra node scripts/catalog/web/sort-inbox.mjs --site naver [--dry-run]
import { parseArgs } from 'node:util';
import { PATHS, SITES } from './config.mjs';
import { sortInbox } from './inbox.mjs';

const { values: args } = parseArgs({ options: { site: { type: 'string' }, 'dry-run': { type: 'boolean' } } });
if (!SITES[args.site]) {
  console.error(`Usage: node scripts/catalog/web/sort-inbox.mjs --site ${Object.keys(SITES).join('|')} [--dry-run]`);
  process.exit(1);
}
const { moved, skipped } = sortInbox({ site: args.site, dryRun: args['dry-run'] });
for (const m of moved) console.log(`${args['dry-run'] ? 'would move' : 'moved'}: ${m.file} → ${m.to}${m.assets ? ' (+_files)' : ''}`);
for (const s of skipped) console.log(`left in inbox: ${s.file} — ${s.reason}`);
console.log(JSON.stringify({ inbox: PATHS.inbox, moved: moved.length, left: skipped.length }));
