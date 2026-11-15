# 상품 카탈로그 (Kaggle Amazon Products Dataset)

출처: Kaggle `lokeshparab/amazon-products-dataset` (Lokesh Parab), CC BY-NC 4.0 — 비상업·출처 표기 조건. 가공 결과는 `supabase/seed/products-amazon.json`에 커밋되어 있다(출처·변경 내역: `supabase/seed/ATTRIBUTION.md`). 원본 CSV와 Gemini 캐시는 커밋하지 않는다(`/data/`).

1. **가공** (`GEMINI_API_KEY`가 있는 `.env`): `node --env-file=<.env> scripts/catalog/build.mjs --raw <압축 해제 폴더>` → `supabase/seed/products-amazon.json`. 하위 카테고리 20개·평점 3.5 이상·리뷰 20개 이상·카테고리별 리뷰 수 상위 200개를 고른 뒤 Gemini(`GEMINI_MODEL`, 기본 `gemini-3.5-flash-lite`, 15 RPM)로 한국어 이름과 16개 카테고리를 정한다. 선물로 부적합하면 제외한다. 장 세정·디톡스·체중 감량·당뇨·정력·아유르베다 약재·수면제처럼 선물로 어색한 건강식품은 `transform.mjs`의 `AWKWARD_HEALTH`(health 카테고리·Diet & Nutrition)와 `AWKWARD_FOOD`(식품·간식·커피차)로 뺀다. 오메가3·비타민·단백질·콜라겐은 남긴다. 중단되면 같은 명령을 다시 실행한다(`data/.gemini-cache.json` 재사용).
2. **마이그레이션**: 팀 Supabase SQL Editor에서 `supabase/migrations/202610140001_amazon_catalog.sql`을 한 번 실행한다.
3. **적재**: `.env`에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`(관리자 키 — 앱·Worker·Git에 넣지 않음)를 두고 `node --env-file=.env scripts/catalog/load.mjs --dry-run`으로 확인한 다음 `--dry-run` 없이 실행한다. 500개씩 upsert하고, 파일에 없는 기존 활성 상품은 비활성화한다(입력 100개 미만이면 비활성화하지 않음).
4. **배포**: `npm run deploy:api`, Vercel 재배포 후 `/health`의 `products` 개수를 확인한다.

가격은 `₹ × 16 × 2`(한국 선물 가격대 보정, 100원 단위)로 환산한다. 배송비(3만 원 이상 무료, 미만 3,000원)·도착일(2~4일)·재고(99)·포장은 규칙 합성값이며 `demo_fields`에 기록되어 앱 상세에 "데모 값"으로 표시된다. 알레르기는 상품명 키워드 추정(`lib/allergens.mjs`)이며, 키워드가 없다고 안전하다는 뜻은 아니다.

## 로컬 꽃과 국내 선물세트

`node scripts/catalog/flowers-local.mjs import`로 [aT 양재 월별 절화 통계](https://flower.at.or.kr/haa00_new/haa00_new.do)를 내려받는다. 같은 스크립트에 `5` 또는 `3 5`를 넘겨 5월 또는 3~5월을 조회할 수 있다.

`node scripts/catalog/shopping-local.mjs <검색 스냅샷 경로>`는 스팸, 백설 식용유, 동원 참치 선물세트의 검색 스냅샷을 가져온다. JSON의 `searches` 배열에는 각 `query`와 `items`가 들어가며, 상품별로 `name`, `displayed_price_krw`, `product_link`를 사용한다. 관측 가격과 테스트용 배송비 2,500원을 추천에 사용한다.

두 스크립트의 기본 DB는 `data/shopping-poc/catalog.sqlite`다. 적재한 데이터만 골라 Node 개발 서버에 연결할 수 있다.

```sh
FLOWER_DB_PATH=data/shopping-poc/catalog.sqlite SHOPPING_DB_PATH=data/shopping-poc/catalog.sqlite npm run dev:api
```

## 한국 선물 상품 수동 저장 (`scripts/catalog/web/`)

자동 수집이 막히면 `node scripts/catalog/web/collect.mjs --site naver --manual-list`로 URL 목록(`data/catalog/web/manual/naver-urls.tsv`)을 만든 뒤 `node scripts/catalog/web/manual-helper.mjs --site naver --occasion holiday`를 실행한다(`--occasion`은 `holiday`·`birthday`·`exam`·`flower`, 생략하면 전체). 도우미는 아직 저장하지 않은 다음 검색 결과를 Chrome 시크릿 창으로 열고, 저장할 파일명을 클립보드에 넣고, 저장 폴더를 터미널에 보여준다. 페이지가 다 뜨면 스크롤하지 말고 `Cmd+S` → 형식 "웹페이지, 전체" → `Cmd+Shift+G`로 그 폴더로 이동 → 파일명 붙여넣기로 저장한 다음 터미널에서 Enter를 누르면, 파일이 생겼는지 확인하고 다음 품목으로 넘어간다(`s` 건너뛰기, `q` 종료, 다시 실행하면 저장된 파일은 건너뜀). 보안 확인이 뜨면 직접 풀어도 되지만 로그인은 하지 않는다. 저장한 HTML은 `/data/` 아래라 Git에 올라가지 않는다.

수집이 끝나면 `node scripts/catalog/web/parse.mjs --site naver` → `select.mjs` → `enrich.mjs`(→ `supabase/seed/products-kr.json`) → `report.mjs`(→ `data/catalog/web/report.md`, `manifest.json`, `figures/`) 순서로 돌린다. 모두 저장된 페이지만 읽는다. 논문용 사본은 `docs/catalog-kr/`에 복사해 커밋한다.
