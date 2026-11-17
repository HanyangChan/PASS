// Capture actual catalog facts for a separate LLM review. No model calls or online writes.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { catalog } from '../tests/scenarios/recommend-eval.mjs';
import { initial, recommend, APP_RANKING } from '../lib/engine.mjs';
const label = process.argv.find(a => a.startsWith('--label='))?.slice(8) || 'after';
const cases = [
  { id: 'G01', request: '어머니 생신에 드릴 꽃다발, 배송비 포함 5만원', recipient: '어머니', occasion: '생일', budget: 50000, category: 'flower', type: 'type:bouquet' },
  { id: 'G02', request: '아버지 생신에 손목시계, 배송비 포함 10만원', recipient: '아버지', occasion: '생일', budget: 100000, category: 'watch' },
  { id: 'G03', request: '새집에 이사한 삼촌께 차 선물, 배송비 포함 5만원', recipient: '삼촌', occasion: '집들이', budget: 50000, category: 'coffee_tea', type: 'type:tea' },
  { id: 'G04', request: '시험을 앞둔 고등학생 조카에게 필기구, 배송비 포함 3만원', recipient: '고등학생 조카', occasion: '수험', budget: 30000, category: 'stationery', type: 'type:writing' },
  { id: 'G05', request: '단 것을 싫어하시는 할머니께 건강 선물, 배송비 포함 5만원', recipient: '할머니', occasion: '생일', budget: 50000, category: 'health', avoidSweet: true },
  { id: 'G06', request: '술을 못 드시는 직장 상사께 감사 선물, 배송비 포함 5만원', recipient: '상사', occasion: '감사', budget: 50000, excluded: ['liquor'] },
];
const results = [], hashes = {};
for (const source of ['amazon', 'web', 'both']) {
  const products = catalog(source, '2026-11-16');
  hashes[source] = createHash('sha256').update(JSON.stringify(products)).digest('hex');
  for (const task of cases) {
    const state = { ...initial(), recipients: [task.recipient], occasion: task.occasion, quantity: 1, same_product: true,
      budget: { amount_krw: task.budget, scope: 'per_set', shipping_included: true },
      preferences: [...(task.category ? [`category:${task.category}`] : []), ...(task.type ? [task.type] : []), ...(task.avoidSweet ? ['less_sweet'] : [])],
      excluded_categories: task.excluded || [] };
    const result = recommend(products, state, APP_RANKING);
    results.push({ source, id: task.id, request: task.request, state, result });
    console.log(JSON.stringify({ source, id: task.id, request: task.request, products: result.items.map(p => ({ id: p.id, name: p.name, category: p.category, cost: p.total })) }));
  }
}
const output = new URL('../work/unseen-evaluation/', import.meta.url); await mkdir(output, { recursive: true });
const sources = ['lib/engine.mjs', 'lib/ranking.mjs', 'baseline/agents/a-router/parser.mjs'];
const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async p => [p, createHash('sha256').update(await readFile(new URL(`../${p}`, import.meta.url))).digest('hex')])));
await writeFile(new URL(`gift-suitability-${label}.json`, output), JSON.stringify({ label, hashes, sourceHashes, results }, null, 2) + '\n');
