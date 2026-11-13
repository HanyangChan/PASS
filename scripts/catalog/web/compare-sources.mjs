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
    result[source] = { status, items, products: new Set(items.map(p => p.id)).size,
      categories: new Set(items.map(p => p.category)).size, bands: new Set(items.map(p => bandOf(p.price_krw))).size, state };
  }
  rows.push({ occasion, text, ...result });
}

const parsedConditions = state => [state.occasion && `상황 ${state.occasion}`, state.recipients?.length && `받는 분 ${state.recipients.join('·')}`,
  state.budget?.amount_krw && `예산 ${state.budget.amount_krw.toLocaleString()}원`, state.preferences?.length && `선호 ${state.preferences.join(',')}`].filter(Boolean).join(' / ') || '-';
const cell = r => r.items.length ? `${r.products} / ${r.categories} / ${r.bands}` : `0 (${r.status})`;
const top = items => items.slice(0, 3).map(p => `${p.name.slice(0, 18)}(${CATEGORY_NAMES[p.category] ?? p.category}, ${p.price_krw.toLocaleString()}원)`).join('<br>');
const union = (source, occ) => new Set(all[source].filter(r => !occ || r.occasion === occ).flatMap(r => r.items.map(p => p.id))).size;
const unionCats = (source, occ) => new Set(all[source].filter(r => !occ || r.occasion === occ).flatMap(r => r.items.map(p => p.category))).size;
const avg = (source, key) => (rows.reduce((n, r) => n + r[source][key], 0) / rows.length).toFixed(2);
const occasions = ['명절', '생일', '수험', '꽃'];

const md = `# 카탈로그 비교: 아마존 vs 네이버(웹)

생성 ${new Date().toISOString().slice(0, 10)} · \`node scripts/catalog/web/compare-sources.mjs\`

- **방법:** 같은 질문 20개(상황별 5개)를 A 모드(규칙 우선) API 처리기에 LLM 없이 보낸다. 해석된 조건으로 엔진 순위(앱과 같은 \`APP_RANKING\`)의 상위 5개를 뽑는다. 점수 로직과 LLM 호출 구조는 바꾸지 않았다.
- **카탈로그:** 아마존 \`supabase/seed/products-amazon.json\` ${CATALOGS.amazon.length}개 · 웹 \`supabase/seed/products-kr.json\` ${CATALOGS.web.length}개.
- **칸 읽는 법:** 상위 5개 안의 \`서로 다른 상품 수 / 카테고리 수 / 가격대 수\`. 가격대는 시드 파일의 5구간이다.

## 요약

| 지표 | 아마존 | 웹 |
|---|---|---|
| 질문당 평균 카테고리 수(상위 5) | ${avg('amazon', 'categories')} | ${avg('web', 'categories')} |
| 질문당 평균 가격대 수(상위 5) | ${avg('amazon', 'bands')} | ${avg('web', 'bands')} |
| 20개 질문 전체에서 추천된 서로 다른 상품 수(최대 100) | ${union('amazon')} | ${union('web')} |
| 20개 질문 전체의 서로 다른 카테고리 수 | ${unionCats('amazon')} | ${unionCats('web')} |
${occasions.map(o => `| ${o} 5개 질문의 서로 다른 상품 수(최대 25) | ${union('amazon', o)} | ${union('web', o)} |`).join('\n')}

## 질문별

| 상황 | 질문 | 규칙 모드가 읽은 조건 | 아마존 | 웹 |
|---|---|---|---|---|
${rows.map(r => `| ${r.occasion} | ${r.text} | ${parsedConditions(r.web.state)} | ${cell(r.amazon)} | ${cell(r.web)} |`).join('\n')}

## 상위 3개 예시

| 질문 | 아마존 | 웹 |
|---|---|---|
${rows.map(r => `| ${r.text} | ${top(r.amazon.items)} | ${top(r.web.items)} |`).join('\n')}

## 해석할 때 주의

- 질문은 A 라우터 규칙이 모든 단어를 읽는 형태로 썼다(스크립트가 예산을 못 읽으면 멈춘다). 실제 A 모드에서 "~추천해줘", 추석·설·수능, 시댁·조카처럼 규칙이 못 읽는 말은 LLM이 해석한다. 이 비교에는 LLM을 쓰지 않았다.
- 규칙 모드에는 "수험"·"꽃" 상황 조건이 없어서, 이 두 상황은 선호 카테고리 단어(간식·문구·디지털기기, 꽃·꽃다발·화분)로 표현했다. 선호 카테고리는 엔진에서 가산점일 뿐 필터가 아니다. 그래서 아마존처럼 해당 카테고리가 없는 카탈로그에서는 다른 상품이 대신 나온다.
- 아마존 가격은 루피 환산값이고 웹 가격은 수집 시점의 실제 원화다.
- 웹 카탈로그의 배송비는 목록 기본 배송비, 도착일은 합성값이다.
`;
writeFileSync(path('docs/catalog-kr/comparison.md'), md);
console.log(JSON.stringify({ questions: rows.length, union: { amazon: union('amazon'), web: union('web') },
  avgCategories: { amazon: avg('amazon', 'categories'), web: avg('web', 'categories') },
  empty: rows.flatMap(r => ['amazon', 'web'].filter(s => !r[s].items.length).map(s => `${s}:${r.text}:${r[s].status}`)) }));
