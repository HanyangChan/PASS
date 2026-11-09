import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { readFlowerMonths } from '../../api/flower-season.mjs';

const dbPath = process.env.FLOWER_DB_PATH ?? fileURLToPath(new URL('../../data/shopping-poc/catalog.sqlite', import.meta.url));
const sourcePage = 'https://flower.at.or.kr/haa00_new/haa00_new.do';
const endpoint = 'https://flower.at.or.kr/haa00_new/selectMultiAuctionList.json';
const market = '0000000001'; // aT 양재
const giftTypes = [
  ['장미', '장미'], ['튜립', '튤립'], ['카네이션', '카네이션'], ['프리지아', '프리지아'],
  ['수국', '수국'], ['작약', '작약'], ['거베라', '거베라'], ['리시안사스', '리시안사스'],
  ['국화', '국화'], ['백합', '백합'], ['해바라기', '해바라기'], ['라넌큘러스', '라넌큘러스'],
  ['다알리아', '달리아'], ['알스트메리아', '알스트로메리아'],
];

async function fetchYear(year) {
  const body = new URLSearchParams({
    type: 'month', searchStrDate: `${year}-01`, searchEndDate: `${year}-12`,
    'flower[]': '1', 'market[]': market, 'gubn[]': '2',
  });
  const response = await fetch(endpoint, {
    method: 'POST', body, signal: AbortSignal.timeout(30000),
    headers: { Referer: sourcePage, 'X-Requested-With': 'XMLHttpRequest' },
  });
  if (!response.ok) throw Error(`aT ${year} HTTP ${response.status}`);
  const { list } = await response.json();
  if (!Array.isArray(list)) throw Error(`aT ${year} response has no list`);
  // Level 0 is the monthly variety row. Higher levels are subtotals.
  const rows = list.filter(row => row.DANCD === '0');
  const yearMonth = new RegExp(`^${year}-(0[1-9]|1[0-2])$`);
  if (new Set(rows.map(row => row.SALEDATE)).size !== 12 || rows.some(row =>
    !yearMonth.test(row.SALEDATE) || row.CMPCD !== market || row.FLOWERGUBN !== '1' ||
    !row.PUMNAME?.trim() || !row.GOODNAME?.trim() ||
    !Number.isSafeInteger(row.TOTQTY) || row.TOTQTY <= 0 ||
    !Number.isSafeInteger(row.TOTAMT) || row.TOTAMT <= 0
  )) throw Error(`aT ${year} monthly coverage or row format is invalid`);
  return rows;
}

async function importFlowers() {
  const yearly = [];
  for (const year of [2023, 2024, 2025]) yearly.push(await fetchYear(year));
  const sourceItems = new Set(yearly.flat().map(row => row.PUMNAME.trim()));
  for (const [item] of giftTypes) {
    if (!sourceItems.has(item)) throw Error(`Missing gift flower in source: ${item}`);
  }
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS flower_auction_monthly (
        month TEXT NOT NULL,
        market_code TEXT NOT NULL,
        item TEXT NOT NULL,
        variety TEXT NOT NULL,
        bunches INTEGER NOT NULL CHECK (bunches > 0),
        total_krw INTEGER NOT NULL CHECK (total_krw > 0),
        source_url TEXT NOT NULL,
        PRIMARY KEY (month, market_code, item, variety)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS flower_gift_types (
        source_item TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE
      ) STRICT;
      DROP VIEW IF EXISTS flower_gift_monthly;
      CREATE VIEW flower_gift_monthly AS
        SELECT a.month, f.name, SUM(a.bunches) AS bunches,
               SUM(a.total_krw) AS total_krw
        FROM flower_auction_monthly a JOIN flower_gift_types f ON a.item = f.source_item
        GROUP BY a.month, f.name;
    `);
    const clearYear = db.prepare('DELETE FROM flower_auction_monthly WHERE market_code = ? AND month BETWEEN ? AND ?');
    const insert = db.prepare('INSERT INTO flower_auction_monthly VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const rows of yearly) {
      const year = rows[0].SALEDATE.slice(0, 4);
      clearYear.run(market, `${year}-01`, `${year}-12`);
      for (const row of rows) {
        insert.run(row.SALEDATE, market, row.PUMNAME.trim(), row.GOODNAME.trim(), row.TOTQTY, row.TOTAMT, sourcePage);
      }
    }
    db.exec('DELETE FROM flower_gift_types');
    const addType = db.prepare('INSERT INTO flower_gift_types VALUES (?, ?)');
    for (const type of giftTypes) addType.run(...type);
    db.exec('COMMIT');
    console.log(JSON.stringify({ observations: yearly.flat().length, months: 36, giftTypes: giftTypes.length }));
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
}

const [start, end = start, extra] = process.argv.slice(2);
const isMonth = value => /^(0?[1-9]|1[0-2])$/.test(value ?? '');
if (start === 'import' && process.argv.length === 3) await importFlowers();
else if (!extra && isMonth(start) && isMonth(end)) console.table(readFlowerMonths(dbPath, Number(start), Number(end)));
else {
  console.error('Usage: node scripts/catalog/flowers-local.mjs import | <start month 1–12> [end month 1–12]');
  process.exitCode = 1;
}
