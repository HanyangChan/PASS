// Shared settings for the Korean gift catalog pipeline (pass-crawl-spec.md v2).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../../../', import.meta.url);
export const path = relative => fileURLToPath(new URL(relative, root));

export const PATHS = {
  seeds: path('occasion-seeds.v1.json'),
  profile: path('.cache/crawl-profile'),
  web: path('data/catalog/web'),
  raw: path('data/catalog/web/raw'),
  manual: path('data/catalog/web/manual'),
  robots: path('data/catalog/web/robots'),
  parsed: path('data/catalog/web/parsed.jsonl'),
  selected: path('data/catalog/web/selected.json'),
  products: path('supabase/seed/products-kr.json'),
  manifest: path('data/catalog/web/manifest.json'),
};

// Spec §0/§1: human-paced browsing.
export const PACING = {
  delayMs: [4000, 8000],
  restEvery: 25,
  restMs: [60000, 120000],
  maxConsecutiveBlocks: 2,
};

// Spec §5.
export const PER_KEYWORD = Number(process.env.PER_KEYWORD ?? 3);
export const OUTLIER_RATIO = [0.2, 5];
export const BLOCKED_TITLE_WORDS = ['리필', '부품', '포장박스', '케이스만', '포장재', '쇼핑백만', '부자재', '교체용'];
// Relevance (rule 2): a title must contain at least one core term of its keyword (spaces ignored).
// Core terms are the keyword's words minus these generic words, unless CORE_TERMS overrides them.
export const GENERIC_WORDS = ['선물세트', '선물박스', '선물', '세트', '혼합', '소포장', '생일', '수능', '응원', '기원'];
export const CORE_TERMS = {};

// Facts about the collection that report.mjs copies into manifest.json.
export const COLLECTION_NOTES = {
  robots: {
    naver: { fetched_at: '2026-11-13T04:13:59Z', http_status: 418, trusted: false,
      note: 'robots.txt 요청이 HTTP 418과 HTML 오류 페이지로 돌아와 실제 규칙을 확인할 수 없음(신뢰 불가).' },
  },
  automated_pilot: '2026-11-13 Playwright headful 파일럿: 네이버(405)·쿠팡(보안 확인) 모두 첫 품목에서 차단 → 수동 저장 모드로 전환.',
};

export const SITES = {
  naver: {
    source: 'naver_shopping_web',
    origin: 'https://search.shopping.naver.com',
    robots: 'https://search.shopping.naver.com/robots.txt',
    searchUrl: q => `https://search.shopping.naver.com/ns/search?query=${encodeURIComponent(q)}`,
  },
  coupang: {
    source: 'coupang_web',
    origin: 'https://www.coupang.com',
    robots: 'https://www.coupang.com/robots.txt',
    searchUrl: q => `https://www.coupang.com/np/search?q=${encodeURIComponent(q)}&channel=user`,
  },
};

// File-safe, human-readable slug; stable across seed reordering.
export const slugOf = keyword => keyword.trim().replace(/[\s/\\:*?"<>|]+/g, '-');

export function loadSeeds(file = PATHS.seeds) {
  const seeds = JSON.parse(readFileSync(file, 'utf8'));
  const items = [];
  for (const [occasion, { keywords }] of Object.entries(seeds.occasions)) {
    for (const entry of keywords) {
      const { q, season = null } = typeof entry === 'string' ? { q: entry } : entry;
      items.push({ occasion, keyword: q, season, slug: slugOf(q) });
    }
  }
  const seen = new Set();
  for (const { occasion, slug } of items) {
    const key = `${occasion}/${slug}`;
    if (seen.has(key)) throw Error(`Duplicate seed keyword: ${key}`);
    seen.add(key);
  }
  return { version: seeds.version, priceBands: seeds.price_bands_krw, items };
}

export const randomBetween = ([min, max]) => min + Math.floor(Math.random() * (max - min + 1));
