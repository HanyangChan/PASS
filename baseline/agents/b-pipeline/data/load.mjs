// Catalog snapshot loader for demo, server and eval (tests use tests/fixtures/catalog.mjs).
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { toEngineProduct } from '../../../src/vendor/catalog.mjs';
import { validateCatalog } from '../../../src/contracts.mjs';

const here = name => new URL(`./${name}`, import.meta.url);
export const PROVENANCE = JSON.parse(readFileSync(here('provenance.json'), 'utf8'));

export function expectedSha256() {
  const line = readFileSync(here(PROVENANCE.sha256File), 'utf8').trim();
  const [hash, file] = line.split(/\s+\*?/);
  if (file !== PROVENANCE.file || !/^[0-9a-f]{64}$/.test(hash)) throw new Error('catalog_sha256_file_invalid');
  return hash;
}

export function snapshotSha256() {
  return createHash('sha256').update(readFileSync(here(PROVENANCE.file))).digest('hex');
}

/** Returns engine products. Fails if the snapshot bytes do not match catalog.sha256. */
export function loadCatalog({ referenceDate = PROVENANCE.referenceDate } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate)) throw new RangeError('referenceDate must be YYYY-MM-DD');
  const bytes = readFileSync(here(PROVENANCE.file));
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual !== expectedSha256()) throw new Error('catalog_sha256_mismatch');
  const rows = JSON.parse(bytes.toString('utf8'));
  const products = rows.filter(r => r.is_active !== false).map(r => toEngineProduct(r, referenceDate));
  validateCatalog(products);
  return products;
}
