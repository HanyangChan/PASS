// Inbox sorting for manually saved search pages: save every page into ONE folder (PATHS.inbox), and this
// moves each page (and its <name>_files folder) to manual/<site>/<occasion>/<slug>.html.
//
// A page is recognised by its file name (the slug the helper puts on the clipboard; Chrome's " (1)" suffix is
// ignored), and otherwise by the search query in the page's <title>. Nothing is overwritten: a page whose target already exists, or that matches no seed
// keyword, stays in the inbox and is reported.
// Usage: SEEDS=extra node scripts/catalog/web/sort-inbox.mjs --site naver [--dry-run]
import { closeSync, existsSync, mkdirSync, openSync, readSync, readdirSync, renameSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { PATHS, loadSeeds } from './config.mjs';

const nfc = text => text.normalize('NFC');

/** Seed rows with their final save path for one site. */
export const rowsFor = site => loadSeeds().items.map(item => ({
  ...item, file: join(PATHS.manual, site, item.occasion, `${item.slug}.html`),
}));

// Chrome records "about:internet" as the source of a saved page, so the search query comes from the page's
// own <title> ("<검색어> : 네이버+ 스토어 검색").
function pageQuery(file) {
  const fd = openSync(file, 'r');
  try {
    const buffer = Buffer.alloc(65536);
    const head = buffer.toString('utf8', 0, readSync(fd, buffer, 0, buffer.length, 0));
    const title = /<title>([^<]*?)\s*:\s*네이버[^<]*<\/title>/.exec(head)?.[1];
    return title ? nfc(title.replaceAll('&amp;', '&').trim()) : null;
  } catch { return null; } finally { closeSync(fd); }
}

/** Moves every identifiable page out of the inbox. Returns { moved, skipped } (skipped keep their reason). */
export function sortInbox({ site, rows = rowsFor(site), inbox = PATHS.inbox, dryRun = false } = {}) {
  const moved = [], skipped = [];
  if (!existsSync(inbox)) return { moved, skipped };
  for (const entry of readdirSync(inbox, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.html?$/i.test(entry.name)) continue;
    const source = join(inbox, entry.name);
    const stem = entry.name.replace(/\.html?$/i, '');
    const name = nfc(stem).replace(/\s*\(\d+\)$/, '');
    const query = pageQuery(source);
    const row = rows.find(r => nfc(r.slug) === name) ?? (query && rows.find(r => nfc(r.keyword) === query));
    if (!row) { skipped.push({ file: entry.name, reason: 'no seed keyword matches the file name or the page title' }); continue; }
    if (existsSync(row.file)) { skipped.push({ file: entry.name, reason: `already saved: ${row.occasion}/${row.slug}` }); continue; }
    // Chrome names the assets folder after the file; macOS may store it decomposed, so match by NFC.
    const assets = readdirSync(inbox, { withFileTypes: true })
      .find(e => e.isDirectory() && nfc(e.name) === nfc(`${stem}_files`))?.name;
    if (!dryRun) {
      mkdirSync(dirname(row.file), { recursive: true });
      renameSync(source, row.file);
      if (assets) renameSync(join(inbox, assets), join(dirname(row.file), `${row.slug}_files`));
    }
    moved.push({ file: entry.name, to: `${row.occasion}/${basename(row.file)}`, assets: Boolean(assets), keyword: row.keyword });
  }
  return { moved, skipped };
}
