// Read-only review of an extra run (no network, writes nothing but data/catalog/web/review.extra.md):
//   1. keywords whose results look wrong (few picks, mostly irrelevant results, parse errors)
//   2. per-occasion product counts and price-band distribution
//   3. overlap with the committed products-kr.json
//   4. site categories the approved category maps do not cover, and old mappings reused in new contexts
// Usage: SEEDS=extra node scripts/catalog/web/review-extra.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { PATHS, SEED_SET, path, loadSeeds } from './config.mjs';
import { CATEGORY_MAP } from './enrich.mjs';
import { normalizeTitle } from './select.mjs';

if (SEED_SET !== 'extra') { console.error('SEEDS=extra 로 실행하세요.'); process.exit(1); }
const { keywords, photo_replacements: replaced = [] } = JSON.parse(readFileSync(PATHS.selected, 'utf8'));
const { priceBands, occasions, groups, perKeyword } = loadSeeds();
const existing = JSON.parse(readFileSync(PATHS.catalog, 'utf8'));
const out = [];
const say = (...lines) => out.push(...lines);
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');
const won = n => `${Math.round(n).toLocaleString('ko-KR')}원`;

// ---- 1. suspicious keywords ----
const flagged = [];
for (const k of keywords) {
  const organic = k.result_count - (k.excluded_counts.ad ?? 0);
  const irrelevant = k.excluded_counts.irrelevant ?? 0;
  const reasons = [];
  if (k.error) reasons.push(`parse:${k.error}`);
  if (k.picked.length < 3) reasons.push(`선정 ${k.picked.length}개(<3)`);
  else if (k.picked.length < perKeyword) reasons.push(`선정 ${k.picked.length}개(목표 ${perKeyword})`);
  if (organic > 0 && irrelevant / organic >= 0.6) reasons.push(`검색어와 무관한 결과 ${irrelevant}/${organic}`);
  if (reasons.length) flagged.push({ k, reasons, sample: k.picked.slice(0, 2).map(p => p.title.slice(0, 28)).join(' / ') });
}
say(`## 1. 이상한 검색어 (${flagged.length}/${keywords.length})`, '',
  flagged.length ? table(['상황', '검색어', '결과', '선정', '사유', '선정 상품 예'],
    flagged.map(({ k, reasons, sample }) => [k.occasion, k.keyword, k.result_count, k.picked.length, reasons.join('; '), sample || '-'])) : '없음', '');

// ---- 2. per occasion ----
const byOccasion = Object.groupBy(keywords, k => k.occasion);
const rows = Object.entries(occasions).map(([id, { label, group }]) => {
  const unique = [...new Map((byOccasion[id] ?? []).flatMap(k => k.picked).map(p => [p.id, p])).values()];
  const prices = unique.map(p => p.price).sort((a, b) => a - b);
  const bands = priceBands.map(b => unique.filter(p => p.price_band === b.id).length);
  return [group, `${label} (${id})`, unique.length, prices.length ? won(prices[prices.length >> 1]) : '-', ...bands];
});
say('## 2. 상황별 상품 수와 가격대', '', table(['그룹', '상황', '상품 수', '중앙값', ...priceBands.map(b => `${b.id} ${b.label}`)], rows), '');
const all = [...new Map(keywords.flatMap(k => k.picked).map(p => [p.id, p])).values()];
say(`선정 합계 ${keywords.reduce((n, k) => n + k.picked.length, 0)}개, 상황 간 중복을 합친 상품 ${all.length}개. 사진 때문에 교체된 선정 ${replaced.length}건.`, '');

// ---- 3. overlap with the committed catalog ----
const existingById = new Map(existing.map(p => [p.id, p]));
const existingByName = new Map(existing.filter(p => p.mall).map(p => [`${normalizeTitle(p.name)}|${p.mall}`, p]));
const overlap = all.filter(p => existingById.has(p.id) || existingByName.has(`${normalizeTitle(p.title)}|${p.mall}`));
const overlapIds = new Set(overlap.map(p => p.id));
const overlapRows = Object.entries(occasions).map(([id, { label }]) => {
  const unique = [...new Map((byOccasion[id] ?? []).flatMap(k => k.picked).map(p => [p.id, p])).values()];
  return [label, unique.length, unique.filter(p => overlapIds.has(p.id)).length];
}).filter(row => row[2]);
say(`## 3. 기존 ${existing.length}개와 겹치는 상품`, '',
  `새로 고른 상품 ${all.length}개 중 **${overlap.length}개**가 기존 카탈로그와 같은 상품(id, 또는 정규화한 상품명+판매처)입니다. 이 상품은 새로 추가되지 않고 기존 레코드에 occasions 태그만 붙습니다.`, '',
  overlapRows.length ? table(['상황', '상품 수', '기존과 겹침'], overlapRows) : '(상황별 겹침 없음)', '');
const existingOcc = Object.entries(Object.groupBy(overlap, p => existingById.get(p.id)?.occasions.join('+') ?? '(이름 일치)')).map(([k, v]) => `${k} ${v.length}`);
if (existingOcc.length) say(`겹친 상품의 기존 태그: ${existingOcc.join(', ')}`, '');

// ---- 4. category mapping ----
const known = new Set([...Object.keys(CATEGORY_MAP.by_site_category), ...Object.keys(CATEGORY_MAP.exclude_site_categories), ...Object.keys(CATEGORY_MAP.held_site_categories ?? {})]);
const leafOf = p => p.category_path?.[0] ?? '(없음)';
const picks = keywords.flatMap(k => k.picked.map(p => ({ ...p, keyword: k.keyword, occasion: k.occasion })));
const byLeaf = Object.groupBy(picks, leafOf);
const summarize = list => [...new Set(list.map(p => p.id))].length;
const unknownRows = Object.entries(byLeaf).filter(([leaf]) => !known.has(leaf)).sort((a, b) => b[1].length - a[1].length)
  .map(([leaf, list]) => [leaf, summarize(list), [...new Set(list.map(p => p.keyword))].slice(0, 3).join(', '), list.slice(0, 2).map(p => p.title.slice(0, 24)).join(' / ')]);
say(`## 4. 기존 20개 카테고리에 매핑이 없는 네이버 카테고리 (${unknownRows.length}개)`, '', unknownRows.length ? table(['네이버 카테고리', '상품', '검색어 예', '상품명 예'], unknownRows) : '없음', '');
const reused = Object.entries(byLeaf).filter(([leaf]) => known.has(leaf) && CATEGORY_MAP.by_site_category[leaf])
  .map(([leaf, list]) => [leaf, CATEGORY_MAP.by_site_category[leaf], summarize(list), [...new Set(list.map(p => p.keyword))].slice(0, 3).join(', ')]);
say('### 기존 매핑 재사용 (새 검색어에서 같은 네이버 카테고리가 나온 것)', '', table(['네이버 카테고리', '기존 매핑', '상품', '검색어 예'], reused.sort((a, b) => b[2] - a[2])), '');

writeFileSync(path('data/catalog/web/review.extra.md'), `# v2-extra 검토\n\n${out.join('\n')}\n`);
console.log(out.join('\n'));
console.log(`\n(저장: data/catalog/web/review.extra.md, 그룹 ${Object.keys(groups).join('/')})`);
