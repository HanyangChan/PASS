# PASS 한국 선물 상품 데이터 수집 명세 (v2)

작성일 2026-11-11 · 대상: PASS 레포 `main` 기준 작업 브랜치 `data/naver-catalog` · 실행: 사용자 Mac의 Claude Code

이 문서는 Claude Code가 한국 선물 상황별 실제 상품 데이터를 수집·정리하는 작업의 단일 기준이다. 품목 목록은 같은 폴더의 `occasion-seeds.v1.2.json`을 쓴다.

**v2.1 수정(2026-11-13):** 최종 카탈로그 위치를 `supabase/seed/products-kr.json`으로 변경, 수동 저장 경로에 사이트 폴더 추가, PR #17 겹침 처리 명시, 네이버 robots.txt 신뢰 불가 기록. 사이트는 네이버로 결정. 선물세트 규칙(§5-6) 추가, 배송비는 네이버 목록 실제 값, 인기도는 리뷰 수 기준(§6).

**v1에서 바뀐 점:** 네이버 쇼핑 검색 API는 개발자센터 신규 신청이 종료(2026-07-31)됐고 NAVER API HUB로도 이관되지 않아 쓸 수 없다. 수집은 **브라우저 자동화(Playwright)로 쇼핑몰 검색 결과 페이지를 읽는 방식**으로 바꾼다. 조교님께 크롤링 허락을 받았다.

---

## 0. 목적과 원칙

- **목적:** 아마존 데이터로는 반영되지 않는 한국 선물 취향(명절·생일·수험·꽃)을 담은 실제 상품 카탈로그를 만든다. 늘 같은 상품이 추천되는 문제를 품목 다양성과 가격 다양성으로 푼다.
- **효율 원칙:** 상황당 **서로 다른 품목 50개**(시드 파일)를 정하고, 품목마다 **검색 결과 첫 페이지 1회**만 읽어 **가격대가 다른 대표 상품 2~3개**를 고른다. 총 200페이지 내외. 상세 페이지는 열지 않는다.
- **최소 부하:** 사람이 검색하는 속도로 천천히 돈다. 요청 간격 무작위 4~8초, 품목 25개마다 1~2분 휴식, 하루 1회 실행 기준. 수집 대상은 검색 결과에 공개된 상품 정보뿐이며 리뷰 본문·판매자 개인정보·로그인 필요 정보는 수집하지 않는다.
- **재현성:** 읽은 페이지의 원본(HTML 또는 페이지 내 JSON)을 그대로 캐시하고, 파싱·정제·선정은 캐시만 보고 다시 돌릴 수 있게 한다. 논문 데이터 파트에 수집일·대상 사이트·검색어·건수·선정 규칙을 그대로 적을 수 있어야 한다.
- **엔진 비변경:** 점수·필터 로직(`lib/engine.mjs`, `lib/counterfactual.mjs`)과 A~D 채팅 모드의 LLM 호출 구조는 건드리지 않는다. 이번 작업은 데이터와 카탈로그 로더까지만.

## 1. 수집 대상과 방식

**대상 사이트 후보:** 네이버 쇼핑 검색 결과, 쿠팡 검색 결과. 둘 다 봇 차단이 있으므로 **S2 파일럿에서 실제로 되는 쪽을 고른다.** 코드는 사이트별 어댑터로 나눈다.

| | 네이버 쇼핑 | 쿠팡 |
|---|---|---|
| 장점 | 여러 쇼핑몰 통합, 카테고리 경로 제공 | 리뷰 수·평점·배송 유형(로켓 등)이 목록에 보임 |
| 단점 | 광고 상품 섞임, 보안 확인(캡차) 가능 | 헤드리스 접속 차단이 강함 |

**방식:**
- 사용자 Mac에서 Playwright Chromium을 **창이 보이는 모드(headful)**와 **전용 영구 프로필**(`.cache/crawl-profile/`, Git 제외)로 실행한다. 사용자의 실제 Chrome 프로필·로그인은 쓰지 않는다.
- 파싱은 CSS 선택자보다 **페이지에 내장된 JSON**(예: `__NEXT_DATA__` 같은 스크립트 태그, 또는 페이지가 스스로 받아오는 응답)을 우선한다. 구조는 사이트가 바꿀 수 있으므로, Claude Code는 S2에서 실제 페이지를 저장해 구조를 확인한 뒤 파서를 짠다. 추측으로 선택자를 쓰지 않는다.
- 보안 확인(캡차)이나 차단 페이지가 나오면: 스크립트는 멈추고 터미널에 알린다. 사용자가 창에서 직접 풀면 이어서 진행한다. **캡차 자동 해결·프록시 우회·User-Agent 위장 반복 같은 회피는 하지 않는다.** 같은 품목에서 두 번 연속 차단되면 그날 수집을 중단한다.
- 광고(스폰서) 표시가 있는 상품은 제외 표시를 남긴다.
- 시작 전에 각 사이트의 robots.txt를 저장해 두고(`data/catalog/web/robots/`), 보고서에 수집 규모·간격과 함께 적는다. **조교님의 허락이 사이트 약관을 대신하지는 않는다**는 점을 보고서와 논문 한계에 남긴다. 2026-11-13 네이버 쇼핑 robots.txt 요청은 HTTP 418과 HTML 오류 페이지로 돌아와 실제 규칙을 확인할 수 없었다. manifest에 "신뢰 불가"로 기록한다.

**대비책(차단이 계속될 때): 수동 저장 모드.** 스크립트가 품목별 검색 URL 목록을 만들어 주고, 사용자가 브라우저에서 열어 `Cmd+S`(웹페이지 전체)로 `data/catalog/web/manual/<site>/<occasion>/<slug>.html`에 저장한다(두 사이트 파일이 겹치지 않도록 사이트 폴더를 둔다). Chrome 시크릿 창에서 열고, 페이지가 다 뜬 뒤 스크롤하지 않고 저장 형식 "웹페이지, 전체"로 저장한다("HTML만"은 스크립트가 그리기 전 원본을 다시 받아 저장하므로 상품 목록이 빠질 수 있다). 함께 생기는 `<slug>_files/` 폴더는 지워도 된다. 파서는 자동 수집과 같은 코드를 쓴다. 200페이지는 1~2시간이면 저장할 수 있다.

## 2. 준비 (사람이 할 일)

1. Playwright 설치(레포에 없으면): `npm i -D playwright && npx playwright install chromium`
2. `.gitignore`에 `.cache/`, `data/catalog/web/raw/`, `data/catalog/web/manual/`이 들어가는지 확인한다. 원본 HTML은 레포에 올리지 않는다(정제된 `supabase/seed/products-kr.json`만 올림. `/data/` 전체가 Git 제외라서 최종 카탈로그는 아마존 데이터와 같은 `supabase/seed/`에 둔다).
3. `occasion-seeds.v1.2.json`을 팀이 검토한다. 품목 교체·추가는 이 파일만 고치면 된다.
4. 수집하는 동안 노트북을 켜 두고 브라우저 창을 닫지 않는다.

## 3. 파이프라인

```
seeds.json → ① collect → data/catalog/web/raw/<site>/<occasion>/<slug>.html|json (원본 캐시)
          → ② parse   → data/catalog/web/parsed.jsonl (사이트 공통 형식, 품목당 결과 전체)
          → ③ select  → data/catalog/web/selected.json
          → ④ enrich  → supabase/seed/products-kr.json
          → ⑤ report  → data/catalog/web/report.md + manifest.json + figures/
```

파일 위치: `scripts/catalog/web/` 아래 `collect.mjs`, `parse.mjs`, `select.mjs`, `enrich.mjs`, `report.mjs`, 공용 `config.mjs`, 어댑터 `sites/naver.mjs`, `sites/coupang.mjs`. Node ESM(`.mjs`), 의존성은 Playwright만 추가.

### ① collect
- 품목마다 사이트 검색 URL 1개를 연다(정렬: 기본 랭킹순). 결과 첫 페이지만.
- 페이지 원본과 메타(URL, 사이트, 품목, 수집 시각, 차단 여부)를 저장. 이미 있으면 건너뜀(`--refresh`로 강제). 중간에 멈춰도 이어서 돌릴 수 있어야 함.
- `--site naver|coupang`, `--occasion`, `--limit`, `--dry-run`(열지 않고 URL 목록만 출력), `--manual-list`(수동 저장용 URL 목록 파일 생성) 지원.
- 간격·휴식·중단 규칙은 §0, §1을 따른다.

### ② parse (네트워크 없음)
사이트 어댑터가 원본에서 상품을 뽑아 공통 형식으로 만든다: `rank, title, price, mall, brand, category_path, rating, review_count, is_ad, delivery_badge, product_url, image_url`. 없는 값은 `null`.

### ③ select (네트워크 없음, 결정적)
§5 규칙으로 품목당 대표 상품을 고른다.

### ④ enrich (네트워크 없음이 기본)
- 상품명 정제(괄호 속 수량·옵션 표기는 남기되 광고 문구 제거).
- 카테고리 매핑: 사이트 카테고리 경로(없으면 품목) → 레포 `lib/catalog.mjs`의 카테고리. 먼저 **매핑 표 초안(`category-map.v1.json`)**을 만들어 사람에게 보여주고, 승인 후 적용한다. 맞는 카테고리가 없으면(꽃, 수험용품 등) 새 카테고리 추가를 제안만 하고 임의로 코드에 넣지 않는다.
- 알레르기: 기존 `lib/allergens.mjs`를 상품명에 적용. 상품명만으로는 불완전하므로 식품은 기존 `ALLERGY_NOTICE`가 계속 붙어야 한다.
- 상황 태그: `occasions: string[]`. 같은 상품이 여러 상황에서 잡히면 합치고 태그만 합친다. 꽃은 `season` 유지.
- LLM은 기본으로 쓰지 않는다. 필요해지면 레포의 현재 LLM 설정(학교 DeepSeek, OpenAI 호환)을 별도 플래그로만.

### ⑤ images (2026-11-13 추가)
`scripts/catalog/web/images.mjs`: 선정 상품의 사진을 저장 페이지의 `_files/`에서 찾아 `data/catalog/web/images/<id>.webp`로 복사하고, 없으면 `image_url`에서 1~2초 간격으로 직접 받는다(4xx/5xx면 멈춤, 우회 없음). 그래도 없는 상품은 ③ select의 사진 규칙이 같은 품목 다음 순위 상품으로 바꾸고, 교체 목록은 manifest `photos.replaced_for_missing_photo`에 남는다. §7 참고.

### ⑥ report
§8 참고.

## 4. 출력 스키마 (`supabase/seed/products-kr.json`의 한 항목)

```js
{
  id: "<site>_<사이트 상품 id 또는 URL 해시>",
  name: "정제된 상품명",
  brand: "..." | null, mall: "..." | null,
  price: 39900,                         // 정수(원)
  category: "<레포 카테고리 id>",
  site_category: ["식품","축산물","한우"] | null,
  occasions: ["holiday"], season: null | "spring" | ...,
  seed_keyword: "한우 선물세트",
  price_band: "b3",
  search_rank: 4,                       // 광고 제외 순위(1부터)
  rating: 4.8 | null, review_count: 1532 | null,   // 목록에 보이면 채움
  popularity_proxy: 0.73,               // §6, 리뷰 수가 없을 때만 쓰는 보조값
  gift_set: true | false | null,        // §5-7. "…선물세트" 시드만 true/false, 나머지 null
  delivery_badge: "오늘출발" | null,
  shipping_fee: 3000,                   // 네이버 목록의 기본 배송비(원), 없으면 null
  shipping_free_over_krw: null,         // 조건부 무료배송 기준 금액. 목록에 없으면 null
  shipping_source: "naver_listing" | "unknown",
  arrival_days: 2, arrival_source: "synthetic",
  allergens: ["대두"],
  image_url: "<Storage 버킷 주소>/<id>.webp", image_file: "<id>.webp", source_image_url: "...", product_url: "...", // §7
  source: "naver_shopping_web" | "coupang_web", collected_at: "2026-11-..."
}
```

엔진 호환: Claude Code는 먼저 `lib/catalog.mjs`의 `toEngineProduct`, `supabase/seed/products-amazon.json` 형식, PR #17에서 연결된 로컬 카탈로그 방식을 읽고, 위 스키마에서 엔진 필드로 가는 변환을 `toEngineProduct`가 처리할 수 있게 한다. 기존 데이터와 **섞을지, 교체할지**는 설정값(`CATALOG_SOURCE=amazon|web|both`)으로 두고 기본은 기존 동작 유지.

PR #17 로컬 스냅샷과 겹치는 시드(`스팸 선물세트`, `참치 선물세트`, `식용유 선물세트`)는 시드에서 빼지 않는다. 카탈로그를 합칠 때 **같은 상품만** 중복 제거한다(같은 상품 URL·id, 또는 정규화한 상품명과 판매처가 같을 때). 같은 브랜드의 다른 상품은 둘 다 남긴다.

## 5. 선정 규칙 (품목당 기본 3개, `PER_KEYWORD`로 조정)

1. 광고 상품, 가격 없는 상품, 품절 표시 상품 제외.
2. 관련성: 정제된 제목에 검색어의 핵심 명사(예: "한우", "튤립")가 들어 있어야 함. 부품·리필·포장재만 파는 상품을 거르는 금지어 목록(`리필`, `부품`, `포장박스`, `케이스만` 등)을 `config.mjs`에 둔다.
3. 가격 이상치 제거: 같은 검색어 결과의 가격 중앙값 대비 0.2배 미만·5배 초과 제외.
4. 가격대 분산: `price_bands_krw`로 나누고, 서로 다른 가격대에서 순위가 가장 높은 상품을 하나씩 고른다(가격대가 부족하면 같은 가격대의 다음 순위).
5. 다양성: 한 품목 안에서 같은 판매처·같은 브랜드 최대 1개. 같은 상품 id 또는 정규화 제목이 같으면 중복 제거.
6. 선물세트 규칙: 시드 이름이 "선물세트"로 끝나면 제목에 `선물`·`세트`·`기프트`·`박스`·`set`(대소문자 무시) 중 하나가 있는 상품을 먼저 고르고 `gift_set:true`로 표시한다. 이렇게 고른 상품이 2개 미만이면 규칙을 풀어 나머지 상품으로 채우고 `gift_set:false`로 표시한다. 다른 시드는 `gift_set:null`. 엔진 상품으로 바꿀 때 `gift_set:true`만 넘기며, PR #17 로컬 스냅샷과 같은 방식이다(엔진의 `isGiftSet`이 이 값을 읽는다).
7. 결과 규모: 4개 상황 × 50품목 × 3개 ≈ 600개(상황 간 중복 제거 후 약간 적음).

## 6. 없는 필드 처리 (논문에 반드시 명시)

| 필드 | 처리 | 비고 |
|---|---|---|
| 인기도 | 네이버 목록의 `review_count`를 기존 `rating_count` 필드에 넣는다. 엔진은 지금처럼 카테고리 안 최댓값 대비 리뷰 수로 인기도를 계산한다(엔진 코드 변경 없음). 리뷰 수가 없는 상품만 `popularity_proxy = 1 - (rank-1)/결과수`를 보고서용으로 남긴다 | 네이버 파일럿 3페이지에서 리뷰 수 보유 128/131개. 리뷰 수는 검색 시점 누적값이다 |
| 평점·리뷰 수 | 목록에 보이는 값만, 없으면 `null` | 화면에서는 값이 없으면 숨김 |
| 배송비 | 네이버 목록의 기본 배송비(`baseFee`)를 `shipping_fee`에 넣고 `shipping_source:'naver_listing'`. 엔진 상품의 기존 배송비 필드(`shipping_fee_krw` → `shipping_fee_per_set_krw`)에만 넣고 점수 코드는 바꾸지 않는다. 조건부 무료배송 기준 금액은 `shipping_free_over_krw`에 두지만, 2026-11-13 확인한 검색 목록에는 이 정보가 없어 `null`이다. 값이 없으면 `null`, 총액 계산 시 0, `shipping_source:'unknown'` | 목록 기준 1회 주문 배송비라 제주·도서산간 추가 요금과 묶음배송 할인은 반영하지 않는다. 조건부 무료일 수 있으므로 설명 생성에서 "무료배송"을 단정하지 않는다 |
| 도착일 | 아마존 카탈로그와 같은 규칙: `2 + hash(id) % 3`(2~4일, `scripts/catalog/demo-rules.mjs`). 포장·당도도 같은 상품명 규칙 | `arrival_source:'synthetic'`, 실험 참가자에게 데모 값임을 안내 |

## 7. 이미지 정책

(2026-11-13 개정: 아이콘 대신 실제 상품 사진을 쓰기로 결정)

- 판매자 상품 이미지는 저작물이다. **비공개 저장소에 보관하고, 레포·공개 배포·논문 캡처에는 쓰지 않는다.** 사진 파일은 절대 Git에 커밋하지 않는다(`data/`는 `.gitignore`).
- 보관 위치: 로컬은 `data/catalog/web/images/<id>.webp`(300px WebP, 저장 페이지에서 복사하거나 검색 페이지와 같은 크기로 직접 받음). 앱 표시용 사본은 Supabase Storage 버킷 `product-images-kr`(`scripts/catalog/web/upload-images.mjs`). `products-kr.json`의 `image_url`은 그 버킷 주소, 원래 판매자 주소는 `source_image_url`.
- 앱이 사진을 띄우려면 버킷은 공개 읽기(URL을 알면 열람 가능)다. 버킷 주소가 레포의 `products-kr.json`에 있으므로 사실상 누구나 열 수 있다는 점을 알고 쓴다. 실험이 끝나면 버킷을 비운다.
- 로컬 개발: `api/dev-server.mjs`가 `data/catalog/web/images/`를 `/catalog-images/`로 서빙해 Storage 없이도 사진이 뜬다(`WEB_IMAGES=storage`면 버킷 사용).
- 카드·랭킹 화면은 사진만 보여주고 카테고리 아이콘은 쓰지 않는다.

## 8. 분석·논문용 산출물

`report.mjs`가 생성:
- `manifest.json`: 수집 기간, 사이트, 수집 방식(자동/수동 저장), 간격 설정, 시드 버전, 품목별 결과 수·선정 수, 차단·실패 목록.
- `report.md`: 상황별 상품 수, 가격대 분포 표, 카테고리 분포, 상황 간 중복 수, 리뷰 수 보유 비율, 기존 아마존 카탈로그와의 카테고리·가격 비교.
- `figures/`: 상황별 가격 분포 박스플롯, 상황×카테고리 히트맵.
- 논문 데이터 파트 재료: 수집 출처·기간·방식, 품목 선정 기준, 선정 규칙, 합성·대체 필드와 한계(검색 랭킹 의존, 광고 제외, 시점 의존 가격).

## 9. Claude Code 작업 순서와 완료 기준

| 단계 | 내용 | 완료 기준 |
|---|---|---|
| S0 | 레포 구조 확인(`lib/catalog.mjs`, 시드 형식, `scripts/catalog/`, PR #17의 로컬 카탈로그), 브랜치 생성 | 변환 계획과 기존 명절 데이터와 겹치는 품목 보고 |
| S1 | `config.mjs`, `collect.mjs --dry-run`, `--manual-list` | 200개 품목 URL 목록 출력 |
| S2 | **파일럿:** 두 사이트에서 각각 품목 3개만 실제로 열어 원본 저장, 구조 확인 | 사이트별 성공/차단 여부, 내장 JSON 위치, 보이는 필드 보고 → **사람이 사이트 선택** |
| S3 | 선택한 사이트 어댑터 `parse` + `select.mjs` + 테스트 | 저장된 파일럿 원본을 픽스처로 규칙 1~5 테스트 통과 |
| S4 | 전체 수집(필요하면 여러 번 나눠서) → parse → select | 품목당 2~3개, 차단·실패 목록 보고 |
| S5 | 카테고리 매핑 초안 → **사람 승인** → `enrich.mjs` | `supabase/seed/products-kr.json` 생성, 스키마 검증 통과 |
| S6 | `report.mjs` + 그림 | report.md·manifest·그림 생성 |
| S7 | `toEngineProduct` 연결, `CATALOG_SOURCE` 설정 | 기존 `npm test` 전부 통과, `web`으로 바꿔 웹에서 다양한 상품 추천 확인 |

**금지:** 캡차 자동 해결·프록시·차단 회피, 사용자 실제 Chrome 프로필 사용, 로그인, 상세 페이지·리뷰 본문 수집, §7 범위 밖의 이미지 다운로드·이미지 파일 커밋, 원본 HTML 커밋, 테스트에서 실제 사이트 접속, 엔진 점수 로직·A~D LLM 호출 구조 변경, `main` 직접 커밋, 브랜치·커밋에 사용자 이름 넣기.

## 10. Claude Code 첫 프롬프트

```
레포 루트의 pass-crawl-spec.md(v2)와 occasion-seeds.v1.2.json을 읽고, 이 명세를 단일 기준으로 작업해줘.

[0. 최신화]
- .git 안에 남은 .lock 파일(예: .git/objects/maintenance.lock)이 있으면 지운 뒤
  git fetch origin → main을 origin/main과 fast-forward로 맞춰줘.
- 추적되지 않은 team03-feedback-13/ 폴더는 건드리지 마.
- 최신 main에서 data/naver-catalog 브랜치를 만들어. main에는 직접 커밋하지 마.

[S0. 분석 먼저, 코드는 나중]
- lib/catalog.mjs(toEngineProduct), supabase/seed/products-amazon.json 형식,
  scripts/catalog/ 기존 스크립트, PR #17에서 연결된 로컬 카탈로그 방식을 읽고
  명세 §4 스키마를 엔진 필드로 옮기는 변환 계획과 CATALOG_SOURCE를 둘 위치를 보고해줘.
- 이미 들어가 있는 명절 선물 데이터가 있으면 시드 품목과 겹치는 것을 보여줘.

[진행 규칙]
- S1~S7은 명세 §9 순서대로, 단계마다 한 줄로 보고.
- S2 파일럿 결과 보고 후, S5 카테고리 매핑 적용 전에는 반드시 멈추고 확인받아.
- 브라우저는 창이 보이는 모드로, 요청 간격 4~8초. 캡차가 나오면 멈추고 나에게 알려줘.
  캡차 자동 해결이나 차단 회피는 하지 마.
- 엔진 점수·필터 로직과 A~D 채팅 모드의 LLM 호출 구조는 수정하지 마.
- 원본 HTML과 브라우저 프로필은 커밋하지 마. 테스트는 저장된 픽스처만 써.
```
