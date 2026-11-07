import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { validateCatalog } from '../../../src/contracts.mjs';
import { ALLERGEN_NAMES } from '../../../src/vendor/allergens.mjs';
import { CATEGORIES } from '../../../src/vendor/catalog.mjs';
import { loadCatalog, snapshotSha256, expectedSha256, PROVENANCE } from '../data/load.mjs';
import { products as fixture } from './fixtures/catalog.mjs';

test('catalog snapshot matches recorded SHA-256 and carries attribution', () => {
  assert.equal(snapshotSha256(), expectedSha256());
  assert.ok(existsSync(new URL('../data/ATTRIBUTION.md', import.meta.url)));
  assert.match(PROVENANCE.referenceDate, /^\d{4}-\d{2}-\d{2}$/);
});

test('snapshot converts to valid engine products deterministically for a fixed reference date', () => {
  const a = loadCatalog(), b = loadCatalog();
  assert.equal(a.length, PROVENANCE.rows);
  assert.doesNotThrow(() => validateCatalog(a));
  assert.deepEqual(a, b);
  const later = loadCatalog({ referenceDate: '2027-01-01' });
  assert.notEqual(a[0].arrival_date, later[0].arrival_date);
  assert.throws(() => loadCatalog({ referenceDate: 'today' }), RangeError);
});

test('test fixture is a valid engine catalog using only common vocabularies', () => {
  assert.doesNotThrow(() => validateCatalog(fixture));
  for (const p of fixture) {
    assert.ok(CATEGORIES.includes(p.category), p.id);
    assert.ok(p.allergens_declared.every(a => ALLERGEN_NAMES.includes(a)), p.id);
  }
});
