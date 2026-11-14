// ⑤ report (no network): manifest.json, report.md and figures/ from the cached pipeline outputs.
// Usage: node scripts/catalog/web/report.mjs
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATEGORY_NAMES } from '../../../lib/catalog.mjs';
import { BLOCKED_TITLE_WORDS, COLLECTION_NOTES, GENERIC_WORDS, IMAGE_PACING_MS, OUTLIER_RATIO, PACING, PATHS, PER_KEYWORD, TERM_ALIASES, loadSeeds, path } from './config.mjs';
import { CATEGORY_MAP } from './enrich.mjs';

const OCCASIONS = { holiday: '명절', birthday: '생일', exam: '수험', flower: '꽃' };
const FIGURES = join(PATHS.web, 'figures');
const readJson = file => JSON.parse(readFileSync(file, 'utf8'));

const seeds = loadSeeds();
const parsed = readFileSync(PATHS.parsed, 'utf8').trim().split('\n').map(line => JSON.parse(line));
const { keywords, photo_replacements: photoReplacements = [] } = readJson(PATHS.selected);
const imagesLog = existsSync(PATHS.imagesLog) ? Object.values(readJson(PATHS.imagesLog)) : [];
const products = readJson(PATHS.products);
const amazon = readJson(path('supabase/seed/products-amazon.json'));

// ---------- helpers ----------
const sum = values => values.reduce((a, b) => a + b, 0);
const quantile = (sorted, q) => {
  const at = (sorted.length - 1) * q, lo = Math.floor(at), hi = Math.ceil(at);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (at - lo);
};
const won = n => `${Math.round(n).toLocaleString('ko-KR')}원`;
const pct = (a, b) => b ? `${(100 * a / b).toFixed(1)}%` : '-';
const table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');
const countBy = (list, key) => list.reduce((acc, item) => { const k = key(item); acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});
const forOccasion = occ => products.filter(p => p.occasions.includes(occ));
const priceStats = list => {
  const s = list.map(p => p.price ?? p.price_krw).sort((a, b) => a - b);
  return s.length ? { n: s.length, min: s[0], q1: quantile(s, 0.25), median: quantile(s, 0.5), q3: quantile(s, 0.75), max: s.at(-1) } : null;
};

// ---------- manifest ----------
const collected = parsed.map(line => line.collected_at).filter(Boolean).sort();
const blockedFiles = existsSync(PATHS.web) ? readdirSync(PATHS.web).filter(f => /^blocked-.*\.json$/.test(f)) : [];
const excludedTotals = keywords.reduce((acc, k) => { for (const [r, n] of Object.entries(k.excluded_counts)) acc[r] = (acc[r] ?? 0) + n; return acc; }, {});
const manifest = {
  generated_at: new Date().toISOString(),
  site: 'naver',
  source: 'search.shopping.naver.com/ns/search (기본 랭킹순, 검색 결과 첫 페이지)',
  method: {
    mode: [...new Set(parsed.map(l => l.mode))],
    manual_save: 'Chrome 시크릿 창에서 사람이 열고 "웹페이지, 전체"로 저장(로그인 없음, 스크롤 없음). scripts/catalog/web/manual-helper.mjs 사용',
    automated_pilot: COLLECTION_NOTES.automated_pilot,
    automated_pacing: PACING,
    parse: '페이지에 내장된 Next.js flight 데이터(self.__next_f)의 상품 카드 JSON. CSS 선택자 없음',
  },
  collection_period: { first: collected[0] ?? null, last: collected.at(-1) ?? null },
  seeds: { version: seeds.version, keywords: seeds.items.length, changes: COLLECTION_NOTES.seed_changes },
  robots: COLLECTION_NOTES.robots,
  selection: { per_keyword: PER_KEYWORD, outlier_ratio: OUTLIER_RATIO, price_bands: seeds.priceBands,
    blocked_title_words: BLOCKED_TITLE_WORDS, generic_words: GENERIC_WORDS, term_aliases: TERM_ALIASES,
    gift_set_rule: '"…선물세트" 시드는 제목에 선물/세트/기프트/박스/set이 있는 상품 우선, 2개 미만이면 완화하고 gift_set:false',
    photo_rule: '사진(저장 페이지의 파일 또는 images.mjs가 받은 파일)이 없는 상품은 건너뛰고 같은 품목의 다음 순위 상품을 고름' },
  photos: {
    storage: '팀 공유용으로 레포 supabase/seed/images-kr/에 포함, API가 /catalog-images/로 서빙. 원본 주소는 source_image_url. 논문 캡처에는 사용하지 않음',
    from_saved_pages: sum(imagesLog.map(l => l.copied.length + (l.converted?.length ?? 0))),
    downloaded: sum(imagesLog.map(l => l.downloaded.length)),
    download_pacing_ms: IMAGE_PACING_MS,
    download_stops: imagesLog.map(l => l.stopped).filter(Boolean),
    replaced_for_missing_photo: photoReplacements,
  },
  category_map: { version: CATEGORY_MAP.version, status: CATEGORY_MAP.status, excluded: CATEGORY_MAP.exclude_site_categories },
  counts: {
    pages: parsed.length, results: sum(parsed.map(l => l.items.length)),
    picked: sum(keywords.map(k => k.picked.length)), products: products.length,
    excluded_by_reason: excludedTotals,
  },
  keywords: keywords.map(k => ({ occasion: k.occasion, keyword: k.keyword, mode: k.mode, collected_at: k.collected_at,
    results: k.result_count, picked: k.picked.length, excluded: k.excluded_counts })),
  failures: {
    parse_errors: parsed.filter(l => l.error).map(l => ({ occasion: l.occasion, keyword: l.keyword, error: l.error })),
    under_two_picks: keywords.filter(k => k.picked.length < 2).map(k => ({ occasion: k.occasion, keyword: k.keyword, picked: k.picked.length })),
    blocked_logs: Object.fromEntries(blockedFiles.map(f => [f, readJson(join(PATHS.web, f))])),
  },
};
writeFileSync(PATHS.manifest, JSON.stringify(manifest, null, 1));

// ---------- figures ----------
mkdirSync(FIGURES, { recursive: true });
const C = { surface: '#fcfcfb', text: '#0b0b0b', text2: '#52514e', muted: '#8a8984', grid: '#e4e3df', series: '#2a78d6', seriesDark: '#184f95', empty: '#f0efec',
  ramp: ['#cde2fb', '#b7d3f6', '#9ec5f4', '#86b6ef', '#6da7ec', '#5598e7', '#3987e5', '#2a78d6', '#256abf', '#1c5cab', '#184f95', '#104281', '#0d366b'] };
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const svg = (w, h, body, title) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="'Pretendard','Apple SD Gothic Neo','Noto Sans KR',sans-serif" role="img" aria-label="${esc(title)}">
<title>${esc(title)}</title>
<rect width="${w}" height="${h}" fill="${C.surface}"/>
${body}
</svg>\n`;

// Box plot of product prices per occasion on a log axis (Tukey whiskers in log space).
function boxplot() {
  const W = 720, H = 360, left = 72, right = 24, top = 56, bottom = 48;
  const lo = Math.log10(200), hi = Math.log10(600000);
  const x = v => left + (Math.log10(v) - lo) / (hi - lo) * (W - left - right);
  const rowH = (H - top - bottom) / 4;
  const ticks = [[1000, '1천'], [10000, '1만'], [30000, '3만'], [100000, '10만'], [500000, '50만']];
  let body = `<text x="${left}" y="24" font-size="15" font-weight="600" fill="${C.text}">상황별 상품 가격 분포</text>
<text x="${left}" y="42" font-size="12" fill="${C.text2}">네이버 쇼핑 검색 결과에서 고른 상품, 가격 축은 로그 눈금(원). 상자=사분위, 선=중앙값, 수염=로그 눈금 기준 1.5×IQR</text>\n`;
  for (const [v, label] of ticks) {
    body += `<line x1="${x(v)}" x2="${x(v)}" y1="${top}" y2="${H - bottom}" stroke="${C.grid}" stroke-width="1"/>
<text x="${x(v)}" y="${H - bottom + 18}" font-size="11" fill="${C.text2}" text-anchor="middle">${label}</text>\n`;
  }
  Object.entries(OCCASIONS).forEach(([occ, label], i) => {
    const prices = forOccasion(occ).map(p => p.price).sort((a, b) => a - b);
    // Same quartiles as the report table; whiskers are measured in log space to match the axis.
    const [q1, med, q3] = [0.25, 0.5, 0.75].map(q => quantile(prices, q));
    const iqr = Math.log10(q3) - Math.log10(q1);
    const wLo = prices.find(p => Math.log10(p) >= Math.log10(q1) - 1.5 * iqr), wHi = [...prices].reverse().find(p => Math.log10(p) <= Math.log10(q3) + 1.5 * iqr);
    const cy = top + rowH * i + rowH / 2, bh = Math.min(28, rowH * 0.5);
    const tip = `${label} ${prices.length}개 · 중앙값 ${won(med)} · 사분위 ${won(q1)}~${won(q3)} · 범위 ${won(prices[0])}~${won(prices.at(-1))}`;
    body += `<g><title>${esc(tip)}</title>
<text x="${left - 12}" y="${cy + 4}" font-size="13" fill="${C.text}" text-anchor="end">${label}</text>
<line x1="${x(wLo)}" x2="${x(q1)}" y1="${cy}" y2="${cy}" stroke="${C.seriesDark}" stroke-width="2"/>
<line x1="${x(q3)}" x2="${x(wHi)}" y1="${cy}" y2="${cy}" stroke="${C.seriesDark}" stroke-width="2"/>
<line x1="${x(wLo)}" x2="${x(wLo)}" y1="${cy - 6}" y2="${cy + 6}" stroke="${C.seriesDark}" stroke-width="2"/>
<line x1="${x(wHi)}" x2="${x(wHi)}" y1="${cy - 6}" y2="${cy + 6}" stroke="${C.seriesDark}" stroke-width="2"/>
<rect x="${x(q1)}" y="${cy - bh / 2}" width="${x(q3) - x(q1)}" height="${bh}" rx="4" fill="${C.series}" fill-opacity="0.28" stroke="${C.series}" stroke-width="2"/>
<line x1="${x(med)}" x2="${x(med)}" y1="${cy - bh / 2}" y2="${cy + bh / 2}" stroke="${C.seriesDark}" stroke-width="3"/>
<text x="${x(med)}" y="${cy - bh / 2 - 6}" font-size="11" fill="${C.text2}" text-anchor="middle">${won(med)}</text>
</g>\n`;
    for (const p of prices.filter(v => v < wLo || v > wHi)) {
      body += `<circle cx="${x(p)}" cy="${cy}" r="4" fill="${C.surface}" stroke="${C.seriesDark}" stroke-width="2"><title>${esc(`${label} 이상값 ${won(p)}`)}</title></circle>\n`;
    }
  });
  return svg(W, H, body, '상황별 상품 가격 분포(로그 눈금)');
}

// Occasion × category product counts.
function heatmap() {
  const cats = Object.entries(countBy(products, p => p.category)).sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const cell = 34, left = 64, top = 140, W = left + cats.length * cell + 24, H = top + 4 * cell + 20;
  const counts = Object.keys(OCCASIONS).map(occ => cats.map(c => forOccasion(occ).filter(p => p.category === c).length));
  const max = Math.max(...counts.flat());
  const step = n => C.ramp[Math.min(C.ramp.length - 1, Math.floor(Math.sqrt(n / max) * (C.ramp.length - 1)))];
  const darkStep = n => C.ramp.indexOf(step(n)) >= 7;
  let body = `<text x="16" y="24" font-size="15" font-weight="600" fill="${C.text}">상황 × 카테고리 상품 수</text>
<text x="16" y="42" font-size="12" fill="${C.text2}">색이 진할수록 상품이 많음(제곱근 눈금, 최대 ${max}개). 빈 칸은 0개</text>\n`;
  cats.forEach((c, j) => {
    const cx = left + j * cell + cell / 2;
    body += `<text transform="translate(${cx + 4},${top - 8}) rotate(-55)" font-size="11" fill="${C.text2}">${esc(CATEGORY_NAMES[c] ?? c)}</text>\n`;
  });
  Object.values(OCCASIONS).forEach((label, i) => {
    const y = top + i * cell;
    body += `<text x="${left - 10}" y="${y + cell / 2 + 4}" font-size="13" fill="${C.text}" text-anchor="end">${label}</text>\n`;
    counts[i].forEach((n, j) => {
      const x0 = left + j * cell;
      const tip = `${label} · ${CATEGORY_NAMES[cats[j]] ?? cats[j]}: ${n}개`;
      body += `<g><title>${esc(tip)}</title><rect x="${x0 + 1}" y="${y + 1}" width="${cell - 2}" height="${cell - 2}" rx="4" fill="${n ? step(n) : C.empty}"/>${n ? `<text x="${x0 + cell / 2}" y="${y + cell / 2 + 4}" font-size="11" text-anchor="middle" fill="${darkStep(n) ? '#ffffff' : C.text}">${n}</text>` : ''}</g>\n`;
    });
  });
  return svg(W, H, body, '상황 × 카테고리 상품 수 히트맵');
}

writeFileSync(join(FIGURES, 'price-by-occasion.svg'), boxplot());
writeFileSync(join(FIGURES, 'occasion-category-heatmap.svg'), heatmap());

// ---------- report.md ----------
const bandRows = Object.entries(OCCASIONS).map(([occ, label]) => {
  const list = forOccasion(occ);
  return [label, list.length, ...seeds.priceBands.map(b => `${list.filter(p => p.price_band === b.id).length} (${pct(list.filter(p => p.price_band === b.id).length, list.length)})`)];
});
const statRows = Object.entries(OCCASIONS).map(([occ, label]) => {
  const s = priceStats(forOccasion(occ));
  return [label, s.n, won(s.min), won(s.q1), won(s.median), won(s.q3), won(s.max)];
});
const allCats = Object.entries(countBy(products, p => p.category)).sort((a, b) => b[1] - a[1]).map(([c]) => c);
const catRows = allCats.map(c => [`${CATEGORY_NAMES[c] ?? c} (${c})`, ...Object.keys(OCCASIONS).map(o => forOccasion(o).filter(p => p.category === c).length || ''), products.filter(p => p.category === c).length]);
const multi = products.filter(p => p.occasions.length > 1);
const pairCounts = countBy(multi, p => p.occasions.map(o => OCCASIONS[o]).join('+'));
const withReviews = products.filter(p => p.review_count > 0).length;
const amazonCats = countBy(amazon, p => p.category);
const compareCats = [...new Set([...Object.keys(amazonCats), ...allCats])];
const cmpRows = compareCats.map(c => {
  const a = priceStats(amazon.filter(p => p.category === c)), k = priceStats(products.filter(p => p.category === c));
  return [`${CATEGORY_NAMES[c] ?? c}`, amazonCats[c] ?? 0, a ? won(a.median) : '-', k?.n ?? 0, k ? won(k.median) : '-'];
});
const flowerSub = countBy(products.filter(p => p.category === 'flower'), p => p.flower_subtype);
const reasonNames = { ad: '광고', irrelevant: '관련성(핵심어 없음·금지어)', price_outlier: '가격 이상치', not_gift_set: '선물세트 아님', outside_bands: '가격대 밖(50만 원 초과)', no_price: '가격 없음', sold_out: '품절' };
const shippingKnown = products.filter(p => p.shipping_source === 'naver_listing');
const allAmazon = priceStats(amazon), allKr = priceStats(products);

const report = `# 한국 선물 상품 카탈로그 수집 보고서

생성 ${manifest.generated_at.slice(0, 10)} · 시드 ${seeds.version} · 카테고리 매핑 ${CATEGORY_MAP.version} · \`scripts/catalog/web/report.mjs\`로 재생성

## 1. 수집 개요

- **출처:** 네이버 쇼핑 검색 결과 첫 페이지(\`search.shopping.naver.com/ns/search\`, 기본 랭킹순). 상세 페이지·리뷰 본문·판매자 정보는 수집하지 않았다.
- **방식:** 사람이 Chrome 시크릿 창에서 검색 결과를 열고 "웹페이지, 전체"로 저장(로그인 없음). 자동 수집(Playwright, 창 표시 모드, 요청 간격 ${PACING.delayMs.map(v => v / 1000).join('~')}초)은 파일럿에서 두 사이트 모두 첫 품목에서 차단되어 쓰지 않았다.
- **기간:** ${manifest.collection_period.first?.slice(0, 10)} ~ ${manifest.collection_period.last?.slice(0, 10)}
- **규모:** 시드 ${seeds.items.length}개(4개 상황 × 50) → 페이지 ${parsed.length}개 → 결과 ${manifest.counts.results.toLocaleString()}개 → 선정 ${manifest.counts.picked}개 → 중복을 합친 상품 ${products.length}개
- **robots.txt:** 네이버는 HTTP 418 오류 페이지만 돌아와 **신뢰할 수 없음**. 조교의 크롤링 허락이 사이트 약관을 대신하지는 않는다.
- **시드 변경:** ${COLLECTION_NOTES.seed_changes.map(c => `${c.from} → ${c.to}`).join(', ')}

## 2. 상황별 상품 수와 가격

${table(['상황', '상품 수', ...seeds.priceBands.map(b => b.label)], bandRows)}

${table(['상황', 'n', '최저', '1사분위', '중앙값', '3사분위', '최고'], statRows)}

![상황별 가격 분포](figures/price-by-occasion.svg)

## 3. 카테고리 분포

${table(['카테고리', ...Object.values(OCCASIONS), '전체'], catRows)}

꽃 세부 유형: ${Object.entries(flowerSub).map(([k, v]) => `${k} ${v}`).join(', ')}

![상황 × 카테고리](figures/occasion-category-heatmap.svg)

## 4. 중복과 필드 보유율

- 상황 간 중복(같은 상품이 두 상황 이상): **${multi.length}개** — ${Object.entries(pairCounts).map(([k, v]) => `${k} ${v}`).join(', ') || '없음'}
- 리뷰 수 보유: ${withReviews}/${products.length} (${pct(withReviews, products.length)})
- 배송비(목록 기본 배송비) 보유: ${shippingKnown.length}/${products.length}, 그중 유료 ${shippingKnown.filter(p => p.shipping_fee > 0).length}개. 조건부 무료배송 기준 금액은 목록에 없어 전부 null
- 선물세트 규칙: ${products.filter(p => p.gift_set === true).length}개 true, ${products.filter(p => p.gift_set === false).length}개 false(규칙 완화)
- 주류: ${products.filter(p => p.alcohol).length}개, 모두 명절 태그만

## 5. 선정 과정에서 제외된 결과

${table(['사유', '건수'], Object.entries(excludedTotals).sort((a, b) => b[1] - a[1]).map(([r, n]) => [reasonNames[r] ?? r, n]))}

## 6. 아마존(Kaggle) 카탈로그와 비교

전체 중앙값: 아마존 ${won(allAmazon.median)}(n=${allAmazon.n}, 루피 환산값) · 네이버 ${won(allKr.median)}(n=${allKr.n}, 실제 원화)

${table(['카테고리', '아마존 n', '아마존 중앙값', '네이버 n', '네이버 중앙값'], cmpRows)}

## 7. 논문 데이터 파트 재료

- **수집:** ${manifest.collection_period.first?.slice(0, 10)}~${manifest.collection_period.last?.slice(0, 10)}, 네이버 쇼핑 검색 결과 첫 페이지, 수동 저장 ${parsed.length}페이지.
- **품목 선정:** 상황(명절·생일·수험·꽃)마다 서로 다른 품목 50개를 시드로 정했다(\`${seeds.version}\`).
- **상품 선정 규칙:** 광고·가격 없음·품절 제외 → 제목에 핵심어 필요(꽃다발·화분 같은 일반어 제외, 이표기 허용)와 금지어 제외 → 품목별 가격 중앙값의 ${OUTLIER_RATIO[0]}배 미만·${OUTLIER_RATIO[1]}배 초과 제외 → 서로 다른 가격대에서 순위가 가장 높은 상품부터 품목당 ${PER_KEYWORD}개 → 같은 판매처·브랜드 1개, 같은 상품 중복 제거. "…선물세트" 품목은 선물세트 표기 상품을 우선.
- **합성·대체 필드:** 도착일·포장·당도는 아마존 카탈로그와 같은 규칙(\`scripts/catalog/demo-rules.mjs\`)으로 합성했다. 도착일은 상품 id 해시로 2~4일, 포장은 상품명에 gift/hamper/combo/set/box·선물·세트·기프트·박스·바구니가 있으면 격식 포장, 당도는 무가당·무설탕·제로슈거·슈가프리·설탕무첨가(영문 sugar free 등)가 있으면 단맛 없음이다. 선물세트 여부(\`gift_set\`)는 포장과 따로 기록한다. 인기도는 검색 시점의 누적 리뷰 수. 배송비는 목록의 기본 배송비로, 지역 추가 요금과 조건부 무료는 반영하지 않았다. 알레르기는 상품명 키워드 추정이다.
- **한계:** 검색 랭킹(광고 제외)에 의존하고 랭킹 알고리즘은 공개되지 않았다. 가격·리뷰 수는 수집 시점 값이다. 브랜드 필드가 없어 판매처 기준으로만 다양성을 맞췄다. robots.txt를 확인할 수 없었고, 허락이 약관을 대신하지 않는다. 상품 사진은 판매자 이미지라 레포·공개 배포·논문 캡처에 쓰지 않는다.
`;
writeFileSync(join(PATHS.web, 'report.md'), report);
console.log(JSON.stringify({ manifest: 'data/catalog/web/manifest.json', report: 'data/catalog/web/report.md', figures: readdirSync(FIGURES) }));
