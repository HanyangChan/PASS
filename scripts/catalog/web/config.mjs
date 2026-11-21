// Shared settings for the Korean gift catalog pipeline (pass-crawl-spec.md v2).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../../../', import.meta.url);
export const path = relative => fileURLToPath(new URL(relative, root));

// Seed sets. 'v1.2' is the original 200-keyword run (default, outputs unchanged). 'extra' is the
// occasion-seeds.v2-extra.json run (32 occasions, per_keyword from that file): same pipeline, same manual
// save folders (occasion ids never overlap with v1.2, checked in loadSeeds), but every intermediate output gets
// an `.extra` suffix and the products go to a staging file that merge-extra.mjs folds into products-kr.json.
// Select with the environment variable SEEDS=extra (scripts use strict flag parsing, so no extra flag).
export const SEED_SET = process.env.SEEDS ?? 'v1.2';
if (!['v1.2', 'extra'].includes(SEED_SET)) throw Error(`SEEDS must be v1.2 or extra, got: ${SEED_SET}`);
const SEED_FILES = { 'v1.2': path('occasion-seeds.v1.2.json'), extra: path('occasion-seeds.v2-extra.json') };
export const SUFFIX = SEED_SET === 'v1.2' ? '' : `.${SEED_SET}`;
const seedMeta = JSON.parse(readFileSync(SEED_FILES[SEED_SET], 'utf8'));

export const PATHS = {
  seeds: SEED_FILES[SEED_SET],
  baseSeeds: SEED_FILES['v1.2'],
  profile: path('.cache/crawl-profile'),
  web: path('data/catalog/web'),
  raw: path('data/catalog/web/raw'),
  manual: path('data/catalog/web/manual'),
  // One flat folder for manually saved pages; sort-inbox.mjs / manual-helper.mjs --inbox file them by occasion.
  inbox: path('data/catalog/web/manual/_inbox'),
  robots: path('data/catalog/web/robots'),
  parsed: path(`data/catalog/web/parsed${SUFFIX}.jsonl`),
  selected: path(`data/catalog/web/selected${SUFFIX}.json`),
  // v1.2 writes the committed catalog directly; extra writes a staging file (merged by merge-extra.mjs).
  products: path(SEED_SET === 'v1.2' ? 'supabase/seed/products-kr.json' : `data/catalog/web/products-kr${SUFFIX}.json`),
  catalog: path('supabase/seed/products-kr.json'),
  held: path(`data/catalog/web/enrich-held${SUFFIX}.json`),
  manifest: path(`data/catalog/web/manifest${SUFFIX}.json`),
  report: path(`data/catalog/web/report${SUFFIX}.md`),
  figures: path(`data/catalog/web/figures${SUFFIX}`),
  blocked: site => path(`data/catalog/web/blocked-${site}${SUFFIX}.json`),
  urlList: site => path(`data/catalog/web/manual/${site}-urls${SUFFIX}.tsv`),
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
// The seed file may carry its own per_keyword (v2-extra: 5); PER_KEYWORD in the environment still wins.
export const PER_KEYWORD = Number(process.env.PER_KEYWORD ?? seedMeta.per_keyword ?? 3);
export const OUTLIER_RATIO = [0.2, 5];
export const BLOCKED_TITLE_WORDS = ['리필', '부품', '포장박스', '케이스만', '포장재', '쇼핑백만', '부자재', '교체용',
  // Memorial and funeral items are not gifts (added 2026-11-13 after a 성묘 artificial bouquet was picked).
  '성묘', '산소', '납골', '추모', '근조', '장례',
  // Military discharge gifts for a partner (전역 꽃신·곰신) do not fit general flower gifts (2026-11-13).
  '전역', '곰신'];
// Relevance (rule 2): a title must contain at least one core term of its keyword (spaces ignored).
// Core terms are the keyword's words minus these generic words, unless CORE_TERMS overrides them.
export { GENERIC_WORDS } from '../../../lib/item-terms.mjs';
import { GENERIC_WORDS as GENERIC, OCCASION_WORDS, TERM_ALIASES as LIB_ALIASES } from '../../../lib/item-terms.mjs';

// Spellings sellers use that lib/item-terms.mjs does not list yet (extra run only). OCCASION_WORDS already lives in
// lib/item-terms.mjs; moving these aliases there too is part of docs/catalog-kr/engine-plan-new-occasions.md.
export const TERM_ALIASES = SEED_SET === 'extra'
  ? { ...LIB_ALIASES, 프러포즈: ['프로포즈', '프로포스', '프러포스'] }
  : LIB_ALIASES;

// v2-extra keywords start with an occasion word ("병문안 과일바구니", "경품 텀블러", "감사 떡 선물세트").
// The occasion word says why the gift is given, not what it is, so it must not satisfy rule 2 on its own
// (a title with "감사" but no 떡 would pass otherwise). The list is in lib/item-terms.mjs (the item filter keeps these
// words out of its vocabulary too). Only applied to the extra seeds; v1.2 is unchanged.
export { OCCASION_WORDS };
// "<상황> 꽃다발" / "<상황> 화분" keywords: once the occasion and generic words are dropped nothing is left (or only a
// modifier like 미니), so rule 2 would pass any title with the occasion word (케이크 토퍼 "퇴원 축하" …). For these
// the item itself is the core term, with its common spellings.
export const ITEM_FORMS = {
  꽃다발: ['꽃다발', '꽃바구니', '플라워박스'], 꽃바구니: ['꽃다발', '꽃바구니', '플라워박스'],
  화분: ['화분', '화환', '서양란', '동양란', '난초'],
};
export const CORE_TERMS = {};
if (SEED_SET === 'extra') {
  for (const { keywords } of Object.values(seedMeta.occasions)) {
    for (const entry of keywords) {
      const keyword = typeof entry === 'string' ? entry : entry.q;
      const itemWord = Object.keys(ITEM_FORMS).find(word => keyword.includes(word));
      if (itemWord) { CORE_TERMS[keyword] = ITEM_FORMS[itemWord]; continue; }
      const words = keyword.split(/\s+/).filter(word => !GENERIC.includes(word) && !OCCASION_WORDS.includes(word));
      if (words.length) CORE_TERMS[keyword] = words;
    }
  }
}

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

// Seed keyword replacements recorded for manifest/report: v1.2 keeps its list above, the extra run records its own in the seed file.
export const SEED_CHANGES = SEED_SET === 'extra' ? (seedMeta.seed_changes ?? []) : COLLECTION_NOTES.seed_changes;

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
  // v2-extra has no price bands of its own: it uses the v1.2 bands so price_band ids match the committed catalog.
  const priceBands = seeds.price_bands_krw ?? JSON.parse(readFileSync(PATHS.baseSeeds, 'utf8')).price_bands_krw;
  if (file !== PATHS.baseSeeds) {
    // Occasion ids must not collide with v1.2: tags and output folders are keyed by occasion id.
    const base = Object.keys(JSON.parse(readFileSync(PATHS.baseSeeds, 'utf8')).occasions);
    const clash = Object.keys(seeds.occasions).filter(id => base.includes(id));
    if (clash.length) throw Error(`Occasion ids collide with v1.2: ${clash.join(', ')}`);
  }
  const groups = seeds.groups ?? {};
  const occasions = {}, items = [];
  for (const [occasion, { keywords, label = occasion, group = null }] of Object.entries(seeds.occasions)) {
    if (group && !groups[group]) throw Error(`Occasion ${occasion} uses unknown group: ${group}`);
    occasions[occasion] = { label, group };
    for (const entry of keywords) {
      const { q, season = null } = typeof entry === 'string' ? { q: entry } : entry;
      items.push({ occasion, group, keyword: q, season, slug: slugOf(q) });
    }
  }
  const seen = new Set();
  for (const { occasion, slug } of items) {
    const key = `${occasion}/${slug}`;
    if (seen.has(key)) throw Error(`Duplicate seed keyword: ${key}`);
    seen.add(key);
  }
  return { version: seeds.version, priceBands, groups, occasions, perKeyword: seeds.per_keyword ?? null, items };
}

export const randomBetween = ([min, max]) => min + Math.floor(Math.random() * (max - min + 1));
