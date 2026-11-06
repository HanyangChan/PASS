# PASS 추천 API

공통 엔진과 선택한 LLM의 조건 추출을 사용하는 독립 Cloudflare Worker입니다. Expo 네이티브 앱과 모바일 웹이 같은 API와 엔진 규칙을 사용합니다. 상품은 Supabase `products`의 활성 상품을 공개 키로 읽어 Worker 인스턴스마다 10분 캐시합니다. 갱신에 실패하면 이전 캐시를 쓰고, 캐시도 없으면 503 `catalog_unavailable`을 반환합니다.

## 로컬 시험

Node 22.13 이상을 사용합니다. **저장소 루트**에서 다음 순서로 실행하세요.

```sh
npm run setup
npm run setup:local
npm run dev:api
# 다른 터미널, 저장소 루트
npm --prefix mobile run web -- --port 8766
```

`setup`은 의존성을 설치합니다. `setup:local`은 공개 예제를 바탕으로 `mobile/.env.local`과 `api/.dev.vars`를 만들고 모바일 API 주소를 `http://127.0.0.1:8788`로 지정합니다. 기존 파일은 덮어쓰지 않으므로 기존 API 주소가 운영 주소라면 직접 수정한 뒤 웹/앱을 재시작하세요. 실제 Supabase 프로젝트를 따로 쓰려면 본인의 공개 URL/Publishable key를 설정하고 상품 테이블/인증을 준비하세요. 예제에 들어 있는 공개 프로젝트는 해당 프로젝트의 접근 정책과 가용성에 따릅니다.

- API 폴더 안에서는 `npm run dev`입니다. `npm run dev:api`는 저장소 루트 명령입니다.
- 앱과 로컬 API의 기본 방식은 A입니다. 모델 키 없이 명확한 규칙 요청을 검토할 수 있습니다. 미해석 문장은 확인 질문으로 처리합니다. B/C는 서버의 `LLM_PROVIDER=openai-compatible`, 유효한 `LLM_API_KEY`와 사용 가능한 모델이 필요합니다. 명시적인 모델 선택이 실패해도 A로 몰래 전환하지 않습니다.
- `api/.dev.vars`의 빈 값/예제용 Supabase 값은 `mobile/.env.local`의 정상 공개 설정을 덮어쓰지 않습니다. 실제 값은 서버 파일 → 프로세스 환경 변수 순으로 우선합니다. 비밀 키를 `EXPO_PUBLIC_*`에 넣지 마세요.
- 로컬 Node 서버의 `APP_ORIGINS`가 비어 있으면 localhost/127.0.0.1의 8766, 8081, 19006 포트만 허용합니다. 다른 웹 주소는 실제 origin을 명시하세요. Worker 운영 환경에는 이 개발용 기본값을 적용하지 않습니다.
- 기본 API 포트는 8788입니다. 사용 중이면 이전 서버를 종료하거나 `API_PORT=8789 npm run dev:api`처럼 바꾸고 모바일 API 주소도 맞추세요. 서버는 기본적으로 127.0.0.1에 바인딩합니다. 실기기에는 접근 가능한 HTTPS API가 필요합니다.
- 시작 시 필수 Supabase/모드 설정 오류를 검사합니다. `curl http://127.0.0.1:8788/health`에서 `ok:true`, 상품 수와 `availableAgents`를 확인하세요. 카탈로그 로드 실패는 HTTP 503입니다. 이 검사는 모델 키 자체의 유효성/모델 응답까지 시험하지는 않습니다.
- 채팅은 **Supabase 로그인**이 필요합니다. API 주소만 열거나 access token 없이 POST하면 인증 오류가 정상입니다. 로그인·키 없이 코드 검토는 `npm test`, 실제 모델 연결 확인은 서버 키 설정 후 `npm run smoke:llm`을 사용하세요.
- 설정 파일은 Git에서 제외됩니다. 로컬의 Luna 설정은 PR을 받은 사람에게 자동 전달되지 않습니다. Luna 실험은 `LLM_MODEL=gpt-5.6-luna`, `LLM_REASONING_ENABLED=false`를 설정하며 같은 게이트웨이에서 해당 모델을 사용할 권한이 필요합니다.

## 배포

`npm ci && npm run build`로 업로드 없이 번들을 검사합니다. 실제 배포 전에 `wrangler.jsonc`의 공개 Supabase URL/Publishable key를 설정하고, `APP_ORIGINS`에 실제 웹 앱 origin을 쉼표로 구분하여 넣습니다. 전체 URL 경로나 와일드카드를 넣지 않습니다. Gemini 키는 `npx wrangler secret put GEMINI_API_KEY`로 등록하고 설정한 모델 ID를 확인합니다. 클라우드 배포에는 Cloudflare 계정 인증이 필요합니다.

`npm run deploy` 이후 모바일 빌드의 `EXPO_PUBLIC_CHAT_API_URL`을 해당 Worker HTTPS 기본 주소로 바꿉니다. 인증/기록 작업(PR #5)이 먼저 적용되어야 앱의 계정 연결을 사용할 수 있습니다. 기존 연구 웹 API는 제거했습니다.

## 인증·제한·실패

- JWT를 디코드한 값이나 클라이언트 owner ID를 신뢰하지 않고, Supabase `/auth/v1/user`에서 5초 제한으로 토큰을 검증합니다. 관리자/service_role 키는 사용하지 않습니다.
- Worker 바인딩으로 IP당 120회/60초(인증 전)와 검증한 계정당 30회/60초를 제한합니다. 바인딩이 없으면 503으로 닫힙니다. namespace ID는 계정 안에서 다른 Worker와 겹치지 않도록 관리합니다. Cloudflare 제한은 위치별·최종 일관성이므로 전역 비용 상한/정확한 사용량 장부가 아닙니다. 로컬 Node 제한기는 단일 프로세스 시험용입니다.
- 서버는 스트림 입력을 UTF-8 32KiB/5초로 제한하고 상태/조건 변경을 검증합니다. 메시지는 1,200자, 최근 대화는 6개만 모델에 보냅니다. 로그에 토큰·키·대화·upstream 응답을 출력하지 않습니다.
- 모델은 조건 추출만 합니다. 추천/가격/배송 비교는 서버 엔진이 결정합니다. 원문 입력과 대화가 Gemini에 전달되는 범위는 이 조건 추출입니다. 사진/첨부 파일 분석은 포함하지 않습니다.
- 앱은 동일 계정에서 한 추천 요청만 전송합니다. 새 대화/계정 전환 시 취소하고 이전 응답을 폐기합니다. 서버 오류·네트워크 오류·25초 초과 시 기존 대화와 입력을 유지하고 재전송할 수 있습니다.
- 조건 편집/예산 비교의 적용도 API로 요청합니다. 게스트 또는 API 주소 미설정 상태는 기존 기기 엔진을 사용하며 화면에 기기/서버 방식을 구분합니다.

검증: Worker 보안/입력/추천 테스트 7개와 모바일 서버 전송/계정 전환/취소 테스트 5개. 실제 Supabase 테스트 계정으로 서버 추천·빠른 응답·조건 편집, 서버 중단 시 상태 보존 및 복구 후 재전송을 확인했습니다. 추가로 실제 Gemini 키를 서버에서 로드하여 “덜 달고 차 종류, 배송비 포함 6만원” 조건 추출과 차 선물 추천을 웹에서 확인했습니다. 키는 Git에서 제외된 서버 파일에만 있으며 공개 Cloudflare 배포와 Vercel 운영 웹 연결을 완료했습니다.

## 현재 운영 배포

- 웹: https://temporary-prompt-sable-s15js3l.vercel.app
- 추천 API: https://pass-recommendation-api.a73342776.workers.dev
- Vercel production 공개 환경 변수: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_CHAT_API_URL`. 서버 Gemini 키는 Cloudflare secret에만 등록합니다.
- Worker는 `placement.region = gcp:us-east4`로 배치합니다. 기본 배치에서 Gemini가 `location_unsupported`를 반환했고, 미국 동부 인근 배치 후 공개 웹의 실제 AI 추천 응답을 확인했습니다. 배치 힌트는 데이터 저장 지역 보장을 의미하지 않습니다.
- `.vercelignore`는 API 서버 파일, DB 파일, 로컬 환경 변수와 생성 파일을 웹 업로드에서 제외합니다.
- 2026-10-11 검증: 공개 웹의 더미 계정 로그인, 기존 찜·최근 기록 복원, 새 대화의 차 선물/배송비 포함 6만원 조건 해석 및 추천. API 비로그인 401, 허용 origin OPTIONS 204, 다른 origin 403.
- 현재 웹 배포는 CLI 운영 배포입니다. GitHub 자동 배포 연결은 별도로 확인해야 합니다.

## A안 Router 구현 (2026-11-05, 개발 브랜치)

로컬 `npm run dev`는 기본 `CHAT_AGENT=a-router`로 동작한다. Worker 설정에도 같은 값을 추가했다. 운영 배포는 별도이며 위의 과거 운영 검증 기록이 새 Router 배포를 뜻하지 않는다. `CHAT_AGENT=legacy`는 기존 Gemini 우선 경로를 유지한다.

Router는 명확한 조건·추천·이유 설명·가상 예산 비교를 규칙으로 처리하고, 미해석 문장만 설정된 추출기로 넘긴다. 키가 없으면 질문하며, 공급자 실패는 상태를 바꾸지 않고 503으로 반환한다. 기존 `session/message/view/mode` 응답을 유지하고 `agent/routing` 진단 정보를 추가했다. 현재는 아래의 허용된 A/B/C 선택을 요청별로 지원하며 모델·공급자·키는 서버 설정을 사용한다. 게스트 기기 엔진과 음성·첨부 UI는 그대로다.

`npm run test:router`(저장소 루트)로 에이전트·API 통합 검사를 실행한다. 모델 키는 서버 `.dev.vars` 또는 Cloudflare secret에만 둔다. [처리 경로·한계·버전 관리 범위](../baseline/agents/a-router/README.md)를 참고한다.

## 플랫폼 LLM / DeepSeek

`LLM_PROVIDER=openai-compatible`, `LLM_BASE_URL=https://llm.ai.hy.miwork.ai`, `LLM_MODEL=deepseek-v4-flash`를 지원한다. 서버 `LLM_API_KEY`를 사용하며 기존 Gemini 키와 혼용하지 않는다. `npm run smoke:llm`(저장소 루트)으로 합성 조건의 실제 추출을 시험한다. 2026-11-05 `/chat/completions` + JSON 모드로 실제 호출을 확인했다. [설정·재시험·오류 안내](../docs/llm-platform.md).

앞의 Gemini 운영 기록은 과거 배포 기준이다. 이번 플랫폼 연결은 개발 브랜치의 코드·로컬 설정이며 운영 배포는 수행하지 않았다.

## Supervisor·서브 에이전트 모드

`A_ROUTER_LLM_MODE=single|subagents`로 A안 해석기를 선택한다. 기본값은 `single`이다. `subagents`는 OpenAI 호환 공급자에서 Supervisor → 필요한 역할 병렬 실행 → 종합 판단을 수행한다. 규칙 경로는 모델을 호출하지 않는다. 현재 앱 응답 계약은 유지하며 `routing.subagents`에 안전한 단계 진단을 추가한다. `GET /health`의 `llmMode`로 선택을 확인한다. 상세 실행·제한은 [A안 안내](../baseline/agents/a-router/README.md)를 따른다.

`LLM_REASONING_ENABLED=false`를 명시하면 호환 전송에 `reasoning.enabled=false`를 전달한다. A 단일 모드와 B/C의 DeepSeek 단계는 생략 시 비사고 설정을 사용하고, 서브 모드의 DeepSeek 단계는 짧은 JSON 분석을 위해 기본적으로 비사고 설정을 사용한다. 공급자 지원이 필요하며 다른 모델로 자동 전환하지 않는다.

## 채팅 화면의 A/B/C 선택

인증된 `/api/chat` 요청의 선택적 `agentMode` 필드는 `a-router`(A), `full-chat`(B), `full-chat-feedback-2`(C)만 허용한다. 생략하면 기존 서버 `CHAT_AGENT`를 따른다. 다른 값은 400으로 거절한다. 선택은 해당 요청에만 적용하고 서버 환경이나 다른 사용자의 요청을 바꾸지 않는다. 응답의 `agent`로 실제 실행 모드를 확인하며 앱은 선택값과 응답값이 다르면 결과를 적용하지 않는다. 인증·호출 제한·도구 검증은 모든 모드에 동일하게 적용한다.

채팅·명시적 조건 편집·조회가 같은 선택값을 전달한다. 앱 선택기는 기본 B이며 대화·조건을 보존한 채 다음 요청부터 적용한다. 응답 중에는 선택을 잠근다. 게스트·API 미연결 상태는 기존 로컬 엔진을 사용하며 화면에 로그인 후 비교가 가능함을 표시한다. 운영 반영은 별도 배포가 필요하다.
