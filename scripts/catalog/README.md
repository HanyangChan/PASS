# 상품 카탈로그 (Kaggle Amazon Products Dataset)

출처: Kaggle `lokeshparab/amazon-products-dataset` (Lokesh Parab), CC BY-NC 4.0 — 비상업·출처 표기 조건. 데이터 파일은 저장소에 커밋하지 않는다(`/data/`). 가공 결과 JSON은 적재 담당자에게 직접 전달한다.

1. **가공** (`GEMINI_API_KEY`가 있는 `.env`): `node --env-file=<.env> scripts/catalog/build.mjs --raw <압축 해제 폴더>` → `data/products-amazon.json`. 하위 카테고리 20개·평점 3.5 이상·리뷰 20개 이상·카테고리별 리뷰 수 상위 200개를 고른 뒤 Gemini(`GEMINI_MODEL`, 기본 `gemini-3.5-flash-lite`, 15 RPM)로 한국어 이름과 16개 카테고리를 정한다. 선물로 부적합하면 제외한다. 중단되면 같은 명령을 다시 실행한다(`data/.gemini-cache.json` 재사용).
2. **마이그레이션**: 팀 Supabase SQL Editor에서 `supabase/migrations/202610140001_amazon_catalog.sql`을 한 번 실행한다.
3. **적재**: `.env`에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`(관리자 키 — 앱·Worker·Git에 넣지 않음)를 두고 `node --env-file=.env scripts/catalog/load.mjs --in data/products-amazon.json --dry-run`으로 확인한 다음 `--dry-run` 없이 실행한다. 500개씩 upsert하고, 파일에 없는 기존 활성 상품은 비활성화한다(입력 100개 미만이면 비활성화하지 않음).
4. **배포**: `npm run deploy:api`, Vercel 재배포 후 `/health`의 `products` 개수를 확인한다.

가격은 `₹ × 16 × 2`(한국 선물 가격대 보정, 100원 단위)로 환산한다. 배송비(3만 원 이상 무료, 미만 3,000원)·도착일(2~4일)·재고(99)·포장은 규칙 합성값이며 `demo_fields`에 기록되어 앱 상세에 "데모 값"으로 표시된다. 알레르기는 상품명 키워드 추정(`lib/allergens.mjs`)이며, 키워드가 없다고 안전하다는 뜻은 아니다.
