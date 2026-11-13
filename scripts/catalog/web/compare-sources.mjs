// Compares top-5 recommendations from the Amazon and Korean web catalogs on 20 fixed questions.
// Rule mode only (A router, no LLM key): the question goes through the same API handler as the app,
// then the engine's own ranking (APP_RANKING) gives the top 5. Writes docs/catalog-kr/comparison.md.
// Usage: node scripts/catalog/web/compare-sources.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { createApi } from '../../../api/worker.mjs';
import { CATEGORY_NAMES, todayKst, toEngineProduct } from '../../../lib/catalog.mjs';
import { fromWebItem } from '../../../lib/catalog-source.mjs';
import { APP_RANKING, rankProducts } from '../../../lib/engine.mjs';
import { engineState, singleInitial } from '../../../lib/single-gift.mjs';
import { loadSeeds, path } from './config.mjs';

// Phrased so the A router's rules read every word: in A mode, anything the rules cannot read
// ("~추천해줘", 추석·설·수능, 시댁·조카) goes to the LLM, which this comparison does not use.
// Exam and flower intent is carried by preference words (간식·문구·디지털기기, 꽃·꽃다발·화분).
export const QUESTIONS = [
  ['명절', '부모님 명절 선물 5만원 이하'],
  ['명절', '어머니 명절 선물 10만원 이하'],
  ['명절', '동료 명절 선물 3만원 이하'],
  ['명절', '명절 선물 예산 2만원'],
  ['명절', '할머니 명절 선물 15만원 이하'],
  ['생일', '친구 생일 선물 3만원 이하'],
  ['생일', '연인 생일 선물 10만원 이하'],
  ['생일', '어머니 생일 선물 20만원 이하'],
  ['생일', '동료 생일 선물 2만원 이하'],
  ['생일', '아버지 생일 선물 5만원 이하'],
  ['수험', '친구 선물 간식 좋아해 2만원 이하'],
  ['수험', '친구 선물 문구 좋아해 1만원 이하'],
  ['수험', '간식 좋아해 예산 5만원'],
  ['수험', '친구 선물 문구 좋아해 3만원 이하'],
  ['수험', '친구 선물 디지털기기 좋아해 5만원 이하'],
  ['꽃', '꽃 좋아해 예산 3만원'],
  ['꽃', '친구 선물 꽃다발 좋아해 5만원 이하'],
  ['꽃', '부모님 선물 꽃 좋아해 3만원 이하'],
  ['꽃', '화분 좋아해 예산 4만원'],
  ['꽃', '어머니 선물 꽃 좋아해 10만원 이하'],
];

// Relevance (judged before running, by category so both catalogs are scored the same way):
// a top-5 product counts as relevant when its category is in the question's expected set.
const HOLIDAY = ['food', 'snack', 'coffee_tea', 'health', 'liquor'];
const BIRTHDAY = ['beauty', 'makeup', 'jewelry', 'accessory', 'bag', 'watch', 'audio', 'digital', 'decor', 'toy', 'snack', 'coffee_tea', 'kitchen', 'flower'];
export const EXPECTED = { 명절: HOLIDAY, 생일: BIRTHDAY, 간식: ['snack'], 문구: ['stationery'], 디지털기기: ['digital'], 꽃: ['flower'] };
const expectedFor = (occasion, text) => occasion === '명절' ? EXPECTED.명절 : occasion === '생일' ? EXPECTED.생일
  : EXPECTED[['간식', '문구', '디지털기기'].find(w => text.includes(w)) ?? '꽃'];
const EXPECTED_LABEL = { 명절: '명절 선물 카테고리(식품·간식·커피차·건강식품·주류)', 생일: '개인 선물 카테고리(식품·건강식품·운동·생활가전·문구·주류 제외)', 간식: '과자·간식', 문구: '문구', 디지털기기: '디지털기기', 꽃: '꽃·식물' };
const expectedLabel = (occasion, text) => EXPECTED_LABEL[occasion === '명절' || occasion === '생일' ? occasion : ['간식', '문구', '디지털기기'].find(w => text.includes(w)) ?? '꽃'];

const today = todayKst();
const CATALOGS = {
  amazon: JSON.parse(readFileSync(path('supabase/seed/products-amazon.json'), 'utf8')).map(row => toEngineProduct(row, today)),
  web: JSON.parse(readFileSync(path('supabase/seed/products-kr.json'), 'utf8')).map(item => fromWebItem(item, today)),
};
const { priceBands } = loadSeeds();
const bandOf = price => priceBands.find(b => price >= b.min && price <= b.max)?.id ?? 'b5+';
const env = { CHAT_AGENT: 'a-router', SUPABASE_URL: 'https://local.invalid', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_local', APP_ORIGINS: 'http://localhost',
  IP_LIMITER: { limit: async () => ({ success: true }) }, USER_LIMITER: { limit: async () => ({ success: true }) } };
const fetcher = async url => String(url).includes('/auth/v1/user') ? Response.json({ id: 'compare', role: 'authenticated' }) : new Response('offline', { status: 503 });

async function topFive(source, text) {
  const products = CATALOGS[source];
  const api = createApi({ fetcher, catalog: async () => products });
  const response = await api.fetch(new Request('http://localhost/api/chat', {
    method: 'POST', headers: { Authorization: 'Bearer compare.local.token', 'Content-Type': 'application/json' },
    body: JSON.stringify({ operation: 'turn', session: { state: singleInitial(), issues: [] }, text, history: [] }),
  }), env);
  const turn = await response.json();
  if (!response.ok) throw Error(`${source} ${text}: ${response.status} ${JSON.stringify(turn).slice(0, 200)}`);
  if (!turn.session.state.budget?.amount_krw) throw Error(`A router rules did not read "${text}" (${turn.mode}); rephrase it`);
  const state = engineState(turn.session.state);
  const ranked = rankProducts(products, state, APP_RANKING);
  return { state: turn.session.state, status: ranked.status, items: (ranked.items ?? []).slice(0, 5) };
}

const rows = [], all = { amazon: [], web: [] };
for (const [occasion, text] of QUESTIONS) {
  const result = {};
  for (const source of ['amazon', 'web']) {
    const { state, status, items } = await topFive(source, text);
    all[source].push({ occasion, items });
    const expected = expectedFor(occasion, text);
    result[source] = { status, items, products: new Set(items.map(p => p.id)).size,
      relevance: items.length ? items.filter(p => expected.includes(p.category)).length / items.length : 0,
      categories: new Set(items.map(p => p.category)).size, bands: new Set(items.map(p => bandOf(p.price_krw))).size, state };
  }
  rows.push({ occasion, text, ...result });
}

const parsedConditions = state => [state.occasion && `상황 ${state.occasion}`, state.recipients?.length && `받는 분 ${state.recipients.join('·')}`,
  state.budget?.amount_krw && `예산 ${state.budget.amount_krw.toLocaleString()}원`, state.preferences?.length && `선호 ${state.preferences.join(',')}`].filter(Boolean).join(' / ') || '-';
const cell = r => r.items.length ? `${r.products} / ${r.categories} / ${r.bands}` : `0 (${r.status})`;
const pct = v => `${Math.round(v * 100)}%`;
const avgRel = (source, occ) => { const list = rows.filter(r => !occ || r.occasion === occ); return pct(list.reduce((n, r) => n + r[source].relevance, 0) / list.length); };
const top = items => items.slice(0, 3).map(p => `${p.name.slice(0, 18)}(${CATEGORY_NAMES[p.category] ?? p.category}, ${p.price_krw.toLocaleString()}원)`).join('<br>');
const union = (source, occ) => new Set(all[source].filter(r => !occ || r.occasion === occ).flatMap(r => r.items.map(p => p.id))).size;
const unionCats = (source, occ) => new Set(all[source].filter(r => !occ || r.occasion === occ).flatMap(r => r.items.map(p => p.category))).size;
const avg = (source, key) => (rows.reduce((n, r) => n + r[source][key], 0) / rows.length).toFixed(2);
const occasions = ['명절', '생일', '수험', '꽃'];

const md = `# 카탈로그 비교: 아마존 vs 네이버(웹)

생성 ${new Date().toISOString().slice(0, 10)} · \`node scripts/catalog/web/compare-sources.mjs\`

- **방법:** 같은 질문 20개(상황별 5개)를 A 모드(규칙 우선) API 처리기에 LLM 없이 보낸다. 해석된 조건으로 엔진 순위(앱과 같은 \`APP_RANKING\`)의 상위 5개를 뽑는다. 점수 로직과 LLM 호출 구조는 바꾸지 않았다.
- **카탈로그:** 아마존 \`supabase/seed/products-amazon.json\` ${CATALOGS.amazon.length}개 · 웹 \`supabase/seed/products-kr.json\` ${CATALOGS.web.length}개.
- **관련성:** 질문마다 기대 카테고리를 실행 전에 정해 두고(질문별 표의 "기대 카테고리"), 상위 5개 중 그 카테고리에 속한 비율을 센다. 두 카테고리 체계가 같으므로 같은 기준으로 비교한다. 웹에만 있는 상황 태그(occasions)는 아마존에 없어 쓰지 않았다.
- **칸 읽는 법:** 상위 5개 안의 \`서로 다른 상품 수 / 카테고리 수 / 가격대 수\`. 가격대는 시드 파일의 5구간이다.

## 요약

| 지표 | 아마존 | 웹 |
|---|---|---|
| **관련성: 상위 5 중 기대 카테고리 비율(20개 평균)** | **${avgRel('amazon')}** | **${avgRel('web')}** |
${occasions.map(o => `| 관련성 · ${o} | ${avgRel('amazon', o)} | ${avgRel('web', o)} |`).join('\n')}
| 질문당 평균 카테고리 수(상위 5) | ${avg('amazon', 'categories')} | ${avg('web', 'categories')} |
| 질문당 평균 가격대 수(상위 5) | ${avg('amazon', 'bands')} | ${avg('web', 'bands')} |
| 20개 질문 전체에서 추천된 서로 다른 상품 수(최대 100) | ${union('amazon')} | ${union('web')} |
| 20개 질문 전체의 서로 다른 카테고리 수 | ${unionCats('amazon')} | ${unionCats('web')} |
${occasions.map(o => `| ${o} 5개 질문의 서로 다른 상품 수(최대 25) | ${union('amazon', o)} | ${union('web', o)} |`).join('\n')}

## 질문별

| 상황 | 질문 | 규칙 모드가 읽은 조건 | 기대 카테고리 | 아마존 | 웹 | 관련성 아마존 | 관련성 웹 |
|---|---|---|---|---|---|---|---|
${rows.map(r => `| ${r.occasion} | ${r.text} | ${parsedConditions(r.web.state)} | ${expectedLabel(r.occasion, r.text)} | ${cell(r.amazon)} | ${cell(r.web)} | ${pct(r.amazon.relevance)} | ${pct(r.web.relevance)} |`).join('\n')}

## 상위 3개 예시

| 질문 | 아마존 | 웹 |
|---|---|---|
${rows.map(r => `| ${r.text} | ${top(r.amazon.items)} | ${top(r.web.items)} |`).join('\n')}

## 해석과 한계

- **질문 간 다양성과 관련성은 웹 카탈로그에서 올라간다.** 같은 상황의 여러 질문에 같은 상품이 반복해서 나오는 일이 줄고(서로 다른 상품 수), 질문이 기대한 카테고리의 상품이 상위에 더 많이 나온다(관련성).
- **한 추천 목록 안의 다양성(카테고리 수·가격대 수)은 웹에서 오히려 줄어든다.** 이는 엔진 정렬 때문이다. 선호 카테고리가 있으면 그 카테고리 상품이 모두 앞에 오고, 예산 선호(\`preferBudgetRange\`)가 예산의 2/3 이상인 상품을 먼저 올린다. 웹 카탈로그에는 선호에 맞는 상품이 충분히 많아 상위 5개가 한 카테고리·한 가격대로 채워진다. 아마존에는 꽃·문구·디지털 카테고리가 없어 다른 카테고리가 섞이는데, 이것이 "다양해 보이는" 이유다. 목록 안 다양성을 높이려면 점수 로직(다양성 재정렬)을 바꿔야 하며, 이번 작업 범위 밖이다.
- **관련성 기준은 카테고리 단위다.** 명절의 "와인잔 선물세트"(주방용품)처럼 상황에는 맞지만 기대 카테고리 밖인 상품은 관련 없음으로 센다. 생일 기대 카테고리는 넓어서 이 지표로는 차이가 작게 나온다.

- 질문은 A 라우터 규칙이 모든 단어를 읽는 형태로 썼다(스크립트가 예산을 못 읽으면 멈춘다). 실제 A 모드에서 "~추천해줘", 추석·설·수능, 시댁·조카처럼 규칙이 못 읽는 말은 LLM이 해석한다. 이 비교에는 LLM을 쓰지 않았다.
- 규칙 모드에는 "수험"·"꽃" 상황 조건이 없어서, 이 두 상황은 선호 카테고리 단어(간식·문구·디지털기기, 꽃·꽃다발·화분)로 표현했다. 선호 카테고리는 엔진에서 가산점일 뿐 필터가 아니다. 그래서 아마존처럼 해당 카테고리가 없는 카탈로그에서는 다른 상품이 대신 나온다.
- 아마존 가격은 루피 환산값이고 웹 가격은 수집 시점의 실제 원화다.
- 웹 카탈로그의 배송비는 목록 기본 배송비, 도착일은 합성값이다.
`;
writeFileSync(path('docs/catalog-kr/comparison.md'), md);
console.log(JSON.stringify({ questions: rows.length, union: { amazon: union('amazon'), web: union('web') },
  avgCategories: { amazon: avg('amazon', 'categories'), web: avg('web', 'categories') },
  empty: rows.flatMap(r => ['amazon', 'web'].filter(s => !r[s].items.length).map(s => `${s}:${r.text}:${r[s].status}`)) }));
