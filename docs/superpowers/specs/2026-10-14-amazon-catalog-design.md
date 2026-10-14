# Amazon 상품 카탈로그 DB 연동 설계

2026-10-14 · 기준 커밋 `1e94dfd` (main, PR #7 머지 후)

## 목표

추천·홈·랭킹·검색·상세가 식품 데모 30개(`lib/products.json`)와 Make 데모(`mobile/src/make-data.json`) 대신 **팀 Supabase `products` 테이블의 실제 공개 데이터셋 상품 약 3,000개**를 사용한다.

## 결정 사항

| 항목 | 결정 | 이유 |
| --- | --- | --- |
| 데이터 원본 | Kaggle `lokeshparab/amazon-products-dataset` (Amazon India, 2023) | CC BY-NC 4.0: 비상업·출처 표기 조건으로 공유·재배포 허용. 11번가 크롤링 데이터는 라이선스 근거 없음 |
| 상품 DB | 팀 Supabase(`zenmtrokvnwsekidcniy`)의 기존 `products` 테이블 | 테이블·공개 읽기 RLS가 이미 있고 비어 있음. 로그인·기록과 같은 프로젝트 |
| 실행 담당 | 가공: dain77-d(로컬) · 마이그레이션·적재: HanyangChan | 팀 DB 관리자 권한은 HanyangChan |
| 데이터 파일 | 저장소에 커밋하지 않음. 가공 결과 JSON을 직접 전달 | 저장소는 스크립트만. 테스트는 합성 픽스처 사용 |
| 이미지 | Amazon CDN URL(`m.media-amazon.com`) 그대로 | 데이터셋에 파일 없음. 깨지면 기존 "사진 로드 실패" 처리 |
| 엔진 상품 공급 | Worker·앱이 시작 시 활성 상품 전체를 읽어 캐시, 기존 엔진에 배열로 전달 | 엔진·예산 비교 로직 유지. 3,000개(약 1MB)는 메모리로 충분. SQL 랭킹은 수만 개 규모에서 재검토 |
| 게스트 | 앱이 공개 키로 Supabase에서 직접 읽어 기기 엔진 사용 | 게스트·로그인 같은 상품 원본. Worker 인증 정책 변경 없음 |
| 가격 | `₹ × 16 × 2`, 100원 반올림. 보정계수(×2)는 **화면에 표시하지 않음** | 인도 가격을 한국 선물 가격대로 맞춤. 앱은 이미 "가격·배송은 데모 데이터"로 안내 |
| 없는 필드 | 배송비·도착일·재고·포장은 규칙 합성, `demo_fields`에 기록, 상세 화면 "데모 값" 배지 | 기존 대화·필터 흐름 유지 |
| 알레르기 | 상품명 키워드로 포함만 확정. 지정 시 해당 상품 제외 + "상품명 기준 추정" 안내 | 키워드 부재는 안전 보장이 아님. 기존 "추천 거부" 동작을 대체 |

## 1. 데이터 가공 — `scripts/catalog/build.mjs`

`node --env-file=<.env 경로> scripts/catalog/build.mjs --raw <압축 해제 폴더> --out data/products-amazon.json`

키는 로컬 `.env`의 `GEMINI_API_KEY`(현재 `PASS-macrs/.env`)를 Node `--env-file`로 읽는다. 모델은 `GEMINI_MODEL`, 기본 `gemini-3.5-flash-lite`(무료 15 RPM·1,000 RPD). 약 3,100개 ÷ 50 = 약 62요청.

1. `Amazon-Products.csv`를 제외한 카테고리 CSV를 읽고 링크의 `/dp/<ASIN>`으로 중복 제거 (원본 49.8만 행 → 고유 ASIN 45.9만).
2. 하위 카테고리 20개만 후보: Coffee, Tea & Beverages · Snack Foods · All Grocery & Gourmet Foods · Diet & Nutrition · Make-up · Beauty & Grooming · Luxury Beauty · Personal Care Appliances · Kitchen & Dining · Home Décor · Watches · Fashion & Silver Jewellery · Handbags & Clutches · Wallets · Sunglasses · Headphones · Speakers · Toys & Games · Fitness Accessories · Yoga.
3. 평점 ≥ 3.5, 리뷰 수 ≥ 20, 가격 있음. 하위 카테고리별 리뷰 수 상위 200개 (약 3,100개).
4. Gemini 배치(요청당 50개, 15 RPM 이하로 순차): 상품마다 `name_ko`(자연스러운 한국어 상품명)와 `category`(아래 enum 또는 `exclude`)를 받는다. 원본 하위 카테고리 라벨이 부정확하므로(예: Watches 안의 운동화) 재분류하고, 선물로 부적합하면 `exclude`. 결과는 `data/.gemini-cache.json`에 ASIN별로 저장해 재실행 시 재호출하지 않는다. 키 값은 출력·로그·커밋하지 않는다.
5. 변환:
   - `price_krw = round(inr × RUPEE_TO_KRW(16) × PRICE_LEVEL(2), -2)` — `discount_price` 우선, 없으면 `actual_price`. 상수 주석에 보정 사실을 기록.
   - `brand` = 원문 상품명 첫 단어(영문). 불확실하면 그대로 두고 필터에서만 사용.
   - `allergens` = 영문 원명 + `name_ko` 키워드 매칭 (2장 어휘).
   - `sweetness` = `sugar free|no added sugar|unsweetened|zero sugar|무가당|무설탕` → `unsweetened`, 그 외 `unknown`.
   - 합성(상품 ID 기반 결정적): 배송비 `price_krw ≥ 30,000 ? 0 : 3,000` · `arrival_days` = 2 + (ASIN 해시 mod 3) · `stock` 99 · `packaging` = `gift|hamper|combo|set|box` → `formal`, 그 외 `basic`. `demo_fields = ['shipping_fee_krw','arrival_days','stock','packaging']`.
6. 출력: `{ id: 'amz-<ASIN>', name: name_ko, name_en, category, description: <카테고리 한글명>, price_krw, shipping_fee_krw, stock, arrival_days, packaging, sweetness, brand, allergens, rating, rating_count, image_url, source: 'amazon-kaggle', source_url, demo_fields, is_active: true }[]`와 거절 사유별 개수 리포트.

카테고리 enum (16): `food, snack, coffee_tea, health, beauty, makeup, personal_care, kitchen, decor, jewelry, watch, bag, accessory, audio, toy, fitness`.

`data/`는 `.gitignore`에 추가한다.

## 2. 알레르기 어휘

식약처 알레르기 유발물질 표시 대상 19종 + 앱 편의 태그 1종:
알류, 우유, 메밀, 땅콩, 대두, 밀, 고등어, 게, 새우, 돼지고기, 복숭아, 토마토, 아황산류, 호두, 닭고기, 쇠고기, 오징어, 조개류, 잣 + `견과류`(almond, cashew, pistachio, hazelnut 등).

키워드 표는 `lib/allergens.mjs` 한 곳에 두고 가공 스크립트·엔진 규칙 추출·Gemini 스키마가 같이 쓴다. 예: `egg→알류`, `milk|whey|cheese|butter|ghee|paneer|cream→우유`, `wheat|atta|maida|flour|biscuit|cookie→밀`, `soy→대두`, `peanut|groundnut→땅콩`, `prawn|shrimp→새우`, `crab→게`.

## 3. DB와 적재

**마이그레이션** `supabase/migrations/202610140001_amazon_catalog.sql` — 기존 테이블·정책을 지우지 않고 컬럼만 추가:

`source text`, `source_url text`, `image_url text`, `name_en text`, `brand text`, `rating numeric(2,1)`, `rating_count integer`, `allergens text[] not null default '{}'`, `packaging text check (packaging in ('formal','basic'))`, `sweetness text check (sweetness in ('unsweetened','unknown'))`, `arrival_days integer check (arrival_days between 0 and 30)`, `demo_fields text[] not null default '{}'`, 인덱스 `(is_active, category)`.

공개 읽기 정책(`is_active` 상품)은 그대로다. 앱은 쓰기 권한이 없다.

**적재** `node scripts/catalog/load.mjs --in data/products-amazon.json [--dry-run]`

- 환경 변수 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (HanyangChan의 로컬 `.env`, 커밋 금지).
- 500행씩 REST upsert(`on_conflict=id`). 입력에 없는 기존 활성 상품은 `is_active=false`. 입력이 100행 미만이면 비활성화를 건너뛰고 경고.
- `--dry-run`은 검증·개수만 출력하고 쓰지 않는다.
- SQL Editor 적용 후 README의 `migration repair` 절차를 따른다.

## 4. 공유 카탈로그 모듈 — `lib/catalog.mjs`

- `fetchCatalog({ url, key, fetcher })`: `GET /rest/v1/products?is_active=eq.true&select=...&order=id`를 `Range` 1,000행 단위로 끝까지 읽는다. 5초 제한/페이지.
- `toEngineProduct(row, today)`: DB 행 → 기존 엔진 필드(`price_krw`, `shipping_fee_per_set_krw`, `stock_sets`, `arrival_date = today + arrival_days`, `allergens_declared`, `allergen_information_complete: false`, `sweetness`, `packaging`, `brand`, `category`) + 화면용 필드(`name_en`, `image`, `link`, `rating`, `rating_count`, `demo_fields`).

엔진 함수 시그니처는 바꾸지 않는다.

## 5. 엔진·대화 변경

- `lib/engine.mjs` `rankProducts`: `excluded_ingredients`가 있으면 거부하는 대신 `allergens_declared`와 겹치는 상품을 제외하고, 결과에 `notice: '상품명 기준으로 추정했어요. 구매 전 성분표를 꼭 확인해 주세요.'`를 붙인다. 규칙 추출의 성분 목록과 카테고리 단어 표는 새 어휘로 교체(예: 커피·차→`coffee_tea`, 과자·간식→`snack`, 화장품→`beauty`, 주얼리→`jewelry`).
- 추천 순서(2026-10-14 추가): 선호 점수 → 같은 카테고리 1위 대비 리뷰 비율 → 리뷰 수 → 가격 낮은 순. 이전의 "점수 → 가격 낮은 순"은 실제 카탈로그에서 싼 상품만 추천했다. 받는 분(부모님·친구·직장동료 묶음, `lib/catalog.mjs` `RECIPIENT_CATEGORIES`)에 맞는 카테고리는 +1점, 직접 말한 카테고리 취향은 +3점. 규칙 해석은 향수·운동·이어폰·주얼리·시계·가방·장난감 등 취향 단어를 카테고리 선호로, "빼줘"가 붙으면 제외로 인식한다. 예산 비교 설명 문구도 같은 순서를 근거로 말한다.
- `lib/llm.mjs`: 프롬프트를 "Korean gift preferences (food and general goods)"로, `preferences`/`excluded_categories` enum을 16개 카테고리로, `excluded_ingredients`를 2장 어휘 enum으로. 알레르기 보존 규칙은 유지.
- `lib/language.mjs`: `unsupportedGoods`는 카탈로그에 없는 상품군(의류·신발·대형가전·게임기)만, 안내 문구는 "지금은 식품·뷰티·생활·액세서리 선물만 추천할 수 있어요."로.
- `lib/products.json`은 `tests/fixtures/food-demo.json`으로 옮겨 엔진 로직 테스트 픽스처로만 쓴다. 런타임 대체 카탈로그는 두지 않는다(`.env.example`에 팀 공개 설정이 이미 있음).
- Amazon에는 견과류 카테고리가 없으므로 "견과류는 빼줘"는 알레르기 태그 `견과류` 제외(`excluded_ingredients`)로 처리한다.

## 6. Worker

- 모듈 전역 캐시 `{ items, loadedAt }`, TTL 10분. 만료 시 `fetchCatalog`로 갱신, 실패하면 기존 캐시 사용, 캐시도 없으면 503 `catalog_unavailable`("상품 정보를 불러오지 못했어요. 잠시 후 다시 시도해주세요.").
- 기존 `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` vars 재사용. 새 secret 없음.
- `/health`: `catalog: 'amazon-kaggle-v1'`, `products: <개수>`. 응답의 `catalog` 필드도 동일.

## 7. 앱

- `mobile/src/services/productRepository.ts`: `fetchCatalog`(공개 키) → `toEngineProduct`. AsyncStorage `pass.catalog.v1`에 24시간 캐시, 실패 시 캐시, 캐시도 없으면 오류 상태.
- 게스트 `chatService`, 홈 인기상품(리뷰 수 상위 10), 랭킹, 검색(`name`·`name_en`·`brand`), 상세가 모두 이 목록을 쓴다. `make-data.json`·`catalog.ts`의 Make 변환 제거, `categoryNames`는 16개 카테고리 한글명으로.
- `Gift`(PR #7 확장 타입) 매핑: `image = image_url`, `brand`, `allergensDeclared`, `rating`; 사진이 있으면 사진, 없으면 기존 카테고리 아이콘(없는 카테고리는 `gift`).
- 랭킹 탭: 전체 / 부모님(health, food, coffee_tea, kitchen, decor) / 친구(beauty, makeup, jewelry, audio, snack) / 직장동료(coffee_tea, snack, decor, accessory, kitchen). 리뷰 수 순.
- 상세: 한글명, 영문 원명, 평점·리뷰 수, "Amazon에서 보기"(`source_url`, `Linking.openURL`), `demo_fields` 항목 옆 "데모 값" 배지, 하단 "상품 정보: Kaggle Amazon Products Dataset (Lokesh Parab), CC BY-NC 4.0". 가격 보정 문구는 넣지 않는다.
- 카탈로그 로드 실패: 홈·랭킹·대화 상단 배너 "상품 정보를 불러오지 못했어요 · 다시 시도".

## 8. 테스트

- `tests/catalog-build.test.mjs`: 소형 CSV 픽스처로 ASIN 추출·중복 제거, 가격 환산, 알레르기 태깅, 합성 결정성, `exclude` 처리(Gemini는 가짜 fetcher).
- `tests/catalog-load.test.mjs`: dry-run, 100행 미만 비활성화 차단, upsert 배치 요청 형태.
- `tests/engine.test.mjs` 갱신: 알레르기 제외 + `notice`, 새 카테고리 선호 점수.
- `api/tests/worker.test.mjs`: 캐시 적중, 만료 후 실패 시 기존 캐시, 캐시 없음 503.
- `mobile/tests/services-catalog.test.mjs`: 페이지 연결, AsyncStorage 캐시, 네트워크 실패 시 캐시.
- `supabase/tests/rls.test.mjs`: 새 컬럼 포함 마이그레이션 적용, 익명 쓰기 차단, 비활성 상품 비노출.
- 기존 `npm test` 전체 통과.

## 9. 범위 밖

구매·결제, 가격·재고 자동 갱신, Supabase Storage 이미지 보관, 상품 DB 서버 측 SQL 랭킹, 상품 이미지 프록시, `evaluation/`의 과거 식품 평가셋 갱신.

## 10. 실행 순서 (사람 작업 포함)

1. (dain77-d) `PASS-macrs/.env`의 키로 `build.mjs` 실행 → `products-amazon.json` 확인.
2. PR 리뷰·머지.
3. (HanyangChan) SQL Editor에서 마이그레이션 실행 → `load.mjs --dry-run` → `load.mjs`.
4. (HanyangChan) `npm run deploy:api`, Vercel 재배포.
5. 공개 웹에서 `/health` 상품 수, 게스트·로그인 추천, 알레르기 제외 안내, 랭킹·상세 확인.
