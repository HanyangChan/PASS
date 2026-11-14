// Shared settings for the Korean gift catalog pipeline (pass-crawl-spec.md v2).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../../../', import.meta.url);
export const path = relative => fileURLToPath(new URL(relative, root));

export const PATHS = {
  seeds: path('occasion-seeds.v1.2.json'),
  profile: path('.cache/crawl-profile'),
  web: path('data/catalog/web'),
  raw: path('data/catalog/web/raw'),
  manual: path('data/catalog/web/manual'),
  robots: path('data/catalog/web/robots'),
  parsed: path('data/catalog/web/parsed.jsonl'),
  selected: path('data/catalog/web/selected.json'),
  products: path('supabase/seed/products-kr.json'),
  manifest: path('data/catalog/web/manifest.json'),
  // Product photos, committed for the team (spec §7) and served at /catalog-images/ by the API.
  images: path('supabase/seed/images-kr'),
  imagesLog: path('data/catalog/web/images-log.json'),
};

// products-kr.json keeps only the file name (image_file); the API builds the address as
// <API>/catalog-images/<image_file> (lib/catalog-source.mjs). The seller's original is source_image_url.
export const imageFile = id => `${id}.webp`;
// The search page asked for 300px WebP thumbnails; direct downloads ask for the same size.
export const IMAGE_QUERY = 'type=f300_webp';
export const IMAGE_PACING_MS = [1000, 2000];

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
export const BLOCKED_TITLE_WORDS = ['리필', '부품', '포장박스', '케이스만', '포장재', '쇼핑백만', '부자재', '교체용',
  // Memorial and funeral items are not gifts (added 2026-11-13 after a 성묘 artificial bouquet was picked).
  '성묘', '산소', '납골', '추모', '근조', '장례',
  // Military discharge gifts for a partner (전역 꽃신·곰신) do not fit general flower gifts (2026-11-13).
  '전역', '곰신'];
// Relevance (rule 2): a title must contain at least one core term of its keyword (spaces ignored).
// Core terms are the keyword's words minus these generic words, unless CORE_TERMS overrides them.
export const GENERIC_WORDS = ['선물세트', '선물박스', '선물', '세트', '혼합', '소포장', '생일', '수능', '응원', '기원', '꽃다발', '화분', '다발'];
// Alternate spellings sellers use for the same item; any of them satisfies the core term.
export const TERM_ALIASES = {
  프리지아: ['후리지아'], 칼라: ['카라'], 소국: ['국화'], 동양란: ['동양난'], 다알리아: ['달리아'],
  리시안셔스: ['리시안사스', '리시안서스'], 히아신스: ['히야신스'], 포인세티아: ['포인세치아'],
  호접란: ['호접난'], 캐모마일: ['카모마일'], 라넌큘러스: ['라넌큐러스'], 프리저브드: ['프리저브'],
};
export const CORE_TERMS = {};

// Facts about the collection that report.mjs copies into manifest.json.
export const COLLECTION_NOTES = {
  robots: {
    naver: { fetched_at: '2026-11-13T04:13:59Z', http_status: 418, trusted: false,
      note: 'robots.txt 요청이 HTTP 418과 HTML 오류 페이지로 돌아와 실제 규칙을 확인할 수 없음(신뢰 불가).' },
  },
  automated_pilot: '2026-11-13 Playwright headful 파일럿: 네이버(405)·쿠팡(보안 확인) 모두 첫 품목에서 차단 → 수동 저장 모드로 전환.',
  seed_changes: [
    { version: 'v1.1', date: '2026-11-13', occasion: 'holiday', from: '식용유 선물세트', to: '카놀라유 선물세트', why: '결과가 올리브유뿐(올리브유 시드와 겹침), 선정 0개' },
    { version: 'v1.1', date: '2026-11-13', occasion: 'birthday', from: '쿠키 선물박스', to: '쿠키 선물세트', why: '결과 38개가 모두 빈 포장 상자' },
    { version: 'v1.1', date: '2026-11-13', occasion: 'exam', from: '터치 장갑', to: '스마트폰 터치 장갑', why: '결과 38개가 모두 작업용 안전장갑' },
    { version: 'v1.1', date: '2026-11-13', occasion: 'flower', from: '용담 꽃다발', to: '가을 꽃다발', why: '결과 2개, 둘 다 용담과 무관' },
    { version: 'v1.2', date: '2026-11-13', occasion: 'exam', from: '스마트폰 터치 장갑', to: '겨울 터치장갑', why: 'v1.1 결과도 작업용 안전장갑뿐. 네이버 안전장갑 카테고리는 매핑에서 제외. 새 결과로도 선정 2개 미만이면 시드에서 뺀다' },
  ],
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
