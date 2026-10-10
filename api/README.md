# PASS 추천 API

공통 식품 데모 카탈로그/엔진과 기존 Gemini 조건 추출을 사용하는 독립 Cloudflare Worker입니다. Expo 앱과 기존 웹 API가 같은 엔진 규칙을 사용합니다. 현재 카탈로그는 `lib/products.json`이며 실제 상품 DB 조회는 후속입니다.

## 로컬 시험

Node 22.13 이상에서 `cd api && npm run dev`를 실행합니다. Node 어댑터는 **동일한 Worker 핸들러**를 127.0.0.1:8788에 연결합니다. 기존 `mobile/.env.local`의 공개 Supabase 설정을 읽습니다. 키는 출력하지 않습니다.

- 모바일 `.env.local`: `EXPO_PUBLIC_CHAT_API_URL=http://127.0.0.1:8788`. 환경 변수 변경 뒤 웹 export/앱 재시작이 필요합니다.
- 서버 `.dev.vars`: 필요한 경우 `GEMINI_API_KEY=...`, `GEMINI_MODEL=...`. 이 파일은 Git에서 제외됩니다. 모델은 프로젝트에서 사용 가능한 Gemini 모델 ID로 지정합니다. 저장 후 API를 재시작합니다.
- 키가 비어 있으면 서버 규칙 기반 추천으로 동작하고 앱에 그 방식을 표시합니다. 키가 존재할 때 Gemini가 실패하면 503을 반환하며 로컬 해석으로 바꿔 처리하지 않습니다.
- `GET /health`, `POST /api/chat` 및 웹 CORS 사전 요청 `OPTIONS /api/chat`를 제공합니다. POST는 Supabase access token의 Bearer 인증이 필요합니다.
- 실기기에서 127.0.0.1은 해당 기기입니다. 실기기 시험에는 HTTPS 서버 주소를 사용합니다. HTTP 예외는 로컬 웹 시험의 localhost/127.0.0.1만 허용합니다.

## 배포

`npm ci && npm run build`로 업로드 없이 번들을 검사합니다. 실제 배포 전에 `wrangler.jsonc`의 공개 Supabase URL/Publishable key를 설정하고, `APP_ORIGINS`에 실제 웹 앱 origin을 쉼표로 구분하여 넣습니다. 전체 URL 경로나 와일드카드를 넣지 않습니다. Gemini 키는 `npx wrangler secret put GEMINI_API_KEY`로 등록하고 설정한 모델 ID를 확인합니다. 클라우드 배포에는 Cloudflare 계정 인증이 필요합니다.

`npm run deploy` 이후 모바일 빌드의 `EXPO_PUBLIC_CHAT_API_URL`을 해당 Worker HTTPS 기본 주소로 바꿉니다. 인증/기록 작업(PR #5)이 먼저 적용되어야 앱의 계정 연결을 사용할 수 있습니다. 기존 웹 `app/api/chat/route.ts`의 동일 origin 정책은 유지합니다.

## 인증·제한·실패

- JWT를 디코드한 값이나 클라이언트 owner ID를 신뢰하지 않고, Supabase `/auth/v1/user`에서 5초 제한으로 토큰을 검증합니다. 관리자/service_role 키는 사용하지 않습니다.
- Worker 바인딩으로 IP당 120회/60초(인증 전)와 검증한 계정당 30회/60초를 제한합니다. 바인딩이 없으면 503으로 닫힙니다. namespace ID는 계정 안에서 다른 Worker와 겹치지 않도록 관리합니다. Cloudflare 제한은 위치별·최종 일관성이므로 전역 비용 상한/정확한 사용량 장부가 아닙니다. 로컬 Node 제한기는 단일 프로세스 시험용입니다.
- 서버는 스트림 입력을 UTF-8 32KiB/5초로 제한하고 상태/조건 변경을 검증합니다. 메시지는 1,200자, 최근 대화는 6개만 모델에 보냅니다. 로그에 토큰·키·대화·upstream 응답을 출력하지 않습니다.
- 모델은 조건 추출만 합니다. 추천/가격/배송 비교는 서버 엔진이 결정합니다. 원문 입력과 대화가 Gemini에 전달되는 범위는 이 조건 추출입니다. 사진/첨부 파일 분석은 포함하지 않습니다.
- 앱은 동일 계정에서 한 추천 요청만 전송합니다. 새 대화/계정 전환 시 취소하고 이전 응답을 폐기합니다. 서버 오류·네트워크 오류·25초 초과 시 기존 대화와 입력을 유지하고 재전송할 수 있습니다.
- 조건 편집/예산 비교의 적용도 API로 요청합니다. 게스트 또는 API 주소 미설정 상태는 기존 기기 엔진을 사용하며 화면에 기기/서버 방식을 구분합니다.

검증: Worker 보안/입력/추천 테스트 7개와 모바일 서버 전송/계정 전환/취소 테스트 5개. 실제 Supabase 테스트 계정으로 서버 추천·빠른 응답·조건 편집, 서버 중단 시 상태 보존 및 복구 후 재전송을 확인했습니다. 추가로 실제 Gemini 키를 서버에서 로드하여 “덜 달고 차 종류, 배송비 포함 6만원” 조건 추출과 차 선물 추천을 웹에서 확인했습니다. 키는 Git에서 제외된 서버 파일에만 있으며 공개 Cloudflare 배포는 후속입니다.
