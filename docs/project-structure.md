# PASS 프로젝트 구조

[메인 README](../README.md) · [실행](getting-started.md) · [프로젝트 구조](project-structure.md) · [배포](deployment.md)

아래 경로는 저장소 루트를 기준으로 합니다.

- `mobile/`: Expo Router 화면, 음성 입력, 로그인, 계정 기록, 추천 API 연결
- `api/`: 인증·요청 제한·CORS를 적용하는 Cloudflare Worker
- `supabase/`: 상품·대화·메시지·선물 기록 스키마와 RLS
- `lib/`: 공유 조건 추출, 추천, 예산 비교, 상품 카탈로그 조회(`catalog.mjs`)·알레르기 어휘
- `scripts/catalog/`: Kaggle Amazon 상품 가공·Supabase 적재 ([절차](../scripts/catalog/README.md))
- `tests/`, `evaluation/`: 공유 엔진 회귀 테스트와 과거 평가 자료

기존 명절 연구 웹과 설문 화면은 제거했습니다. 과거 구현은 Git 이력에서 확인할 수 있습니다. 상품은 팀 Supabase `products`에 적재한 Kaggle Amazon Products Dataset(Lokesh Parab, CC BY-NC 4.0)입니다. 가격은 원화 환산값이고 배송비·도착일·재고·포장은 데모 값이며, 실제 주문·결제 기능은 제공하지 않습니다.
