import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const dataDirectory = new URL('../../data/shopping-poc/', import.meta.url);
const dbPath = process.env.SHOPPING_DB_PATH ?? fileURLToPath(new URL('catalog.sqlite', dataDirectory));
const snapshotPath = process.argv[2] ?? new URL('searchapi-results.json', dataDirectory);
const { searches } = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const original = JSON.parse(readFileSync(new URL('../../supabase/seed/products-amazon.json', import.meta.url), 'utf8'));
const families = new Map([
  ['스팸 선물세트', /스팸/i],
  ['백설 식용유 선물세트', /백설\s*(?:식용유|해바라기씨유|카놀라유|포도씨유|올리브유|요리유|선물세트)/i],
  ['동원 참치 선물세트', /동원.*참치/i],
]);
if (!Array.isArray(searches) || [...families.keys()].some(query =>
  !searches.some(search => search.query === query && !search.error && Array.isArray(search.items)))) {
  throw Error('The snapshot must contain all three shopping searches.');
}

const setName = /세트|선물박스|gift\s*set/i;
const wholesale = /\d+\s*세트\s*[\/x×]\s*\d+\s*(?:박스|box)|세트\s*[x×]\s*[2-9]\d*\s*개\s*\(\s*1\s*box/i;
const validPrice = value => Number.isSafeInteger(value) && value > 0 ? value : null;
const observations = searches.filter(search => families.has(search.query)).flatMap(({ query, items }) => items.map(item => {
  if (typeof item.name !== 'string' || !item.name.trim()) throw Error('Missing shopping product name.');
  const id = 'searchapi-' + createHash('sha256').update(JSON.stringify([
    query, item.product_id, item.name, item.seller, item.price_text,
  ])).digest('hex').slice(0, 24);
  const price = validPrice(item.displayed_price_krw);
  const shipping = item.displayed_shipping_krw === 0 ? 0 : validPrice(item.displayed_shipping_krw);
  const eligible = price !== null && families.get(query).test(item.name) && setName.test(item.name) && !wholesale.test(item.name);
  return [id, query, item.name, price, shipping, JSON.stringify(item), eligible ? 'name_match' : 'review_only'];
}));
const eligibleCount = observations.filter(row => row[6] === 'name_match').length;
if (!eligibleCount) throw Error('The snapshot has no matching gift sets.');

mkdirSync(dirname(dbPath), { recursive: true });
const db = new DatabaseSync(dbPath);
try {
  db.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE IF NOT EXISTS original_products (id TEXT PRIMARY KEY, source_json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS shopping_observations (
      id TEXT PRIMARY KEY, query TEXT NOT NULL, title TEXT NOT NULL, price_krw INTEGER,
      shipping_krw INTEGER, source_json TEXT NOT NULL, eligibility TEXT NOT NULL
    );
    DELETE FROM original_products;
    DELETE FROM shopping_observations;
  `);
  const insertProduct = db.prepare('INSERT INTO original_products VALUES (?, ?)');
  for (const product of original) insertProduct.run(product.id, JSON.stringify(product));
  const insertObservation = db.prepare('INSERT INTO shopping_observations VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const row of observations) insertObservation.run(...row);
  db.exec('COMMIT');
  console.log(JSON.stringify({ original: original.length, observations: observations.length, giftSets: eligibleCount }));
} finally {
  db.close();
}
