# PASS — Personalized AI Shopping System

Expo / React Native 기반 iOS·Android 선물 추천 앱입니다. 웹에서도 같은 모바일 화면과 서비스를 사용합니다.

[PASS 웹 앱](https://temporary-prompt-sable-s15js3l.vercel.app) · [추천 API 상태](https://pass-recommendation-api.a73342776.workers.dev/health)

## 실행

Node.js 22.13 이상이 필요합니다.

```sh
npm ci
npm run setup
cp mobile/.env.example mobile/.env.local
npm run dev
```

모바일 환경 변수에는 Supabase URL, 공개 Publishable key, 추천 API 기본 주소를 설정합니다. Gemini 키는 앱에 넣지 않고 Cloudflare secret으로 관리합니다. 서버 로컬 설정은 `api/.dev.vars`에 저장합니다.

```sh
npm run web        # 모바일 웹 개발 서버
npm run ios        # iOS 개발 빌드
npm run android    # Android 개발 빌드
npm run dev:api    # 로컬 추천 API
npm run build      # 모바일 웹 정적 빌드
npm run typecheck
npm run lint
npm test
```

음성 인식은 네이티브 개발 빌드가 필요합니다. 앱스토어 배포용 서명·앱 식별자·EAS 프로젝트 설정은 후속 작업입니다.

## 구조

- `mobile/`: Expo Router 화면, 음성 입력, 로그인, 계정 기록, 추천 API 연결
- `api/`: 인증·요청 제한·CORS를 적용하는 Cloudflare Worker
- `supabase/`: 상품·대화·메시지·선물 기록 스키마와 RLS
- `lib/`: 공유 조건 추출, 추천, 예산 비교, 상품 카탈로그 조회(`catalog.mjs`)·알레르기 어휘
- `scripts/catalog/`: Kaggle Amazon 상품 가공·Supabase 적재 ([절차](scripts/catalog/README.md))
- `tests/`, `evaluation/`: 공유 엔진 회귀 테스트와 과거 평가 자료

기존 명절 연구 웹과 설문 화면은 제거했습니다. 과거 구현은 Git 이력에서 확인할 수 있습니다. 상품은 팀 Supabase `products`에 적재한 Kaggle Amazon Products Dataset(Lokesh Parab, CC BY-NC 4.0)입니다. 가격은 원화 환산값이고 배송비·도착일·재고·포장은 데모 값이며, 실제 주문·결제 기능은 제공하지 않습니다.

## 배포

Vercel은 `mobile/dist`를 배포합니다. 운영 환경에 `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_CHAT_API_URL`을 등록합니다.

```sh
npx vercel deploy --prod
npm run deploy:api
```

웹 업로드에서 서버·DB·로컬 환경 변수는 `.vercelignore`로 제외합니다. Worker 배치 지역과 허용 웹 주소는 `api/wrangler.jsonc`에 있습니다. 실행 지역이 Gemini에서 지원되지 않으면 API가 `location_unsupported` 오류를 반환합니다.

상세 구현: [모바일](mobile/README.md), [API](api/README.md), [DB](supabase/README.md).

## 아키텍처

[현재 운영 구조와 배포 설정](docs/architecture.md) · [구조도](https://temporary-prompt-sable-s15js3l.vercel.app/architecture.svg)

### LLM Agent 목표 구조

**아래는 구현 예정인 설계입니다.** 현재 API의 LLM은 조건 추출을 담당하며, 아래의 도구 선택·반복 실행·재계획 루프는 아직 구현하지 않았습니다.

LLM Agent는 요청이 들어오면 필요한 질문·도구·종료 시점을 선택합니다. 상품 필터·정렬·가격 계산·예산 비교는 공통 PASS 엔진이 수행하고, 서버가 조건 변경과 도구 결과를 검증합니다. 추천뿐 아니라 조건 수정·추천 이유 설명·가상 예산 비교도 에이전트의 처리 대상입니다.

```mermaid
flowchart TB
  ui["PASS 앱 / 웹"]
  gate["인증 · 조건 상태 검증"]
  agent["LLM Agent · 행동 선택"]
  memory["Planning · Memory"]
  tools["도구 인자 검증 · 호출 제한"]
  engine["공통 PASS 추천 엔진"]
  catalog[("상품 DB")]
  observation["도구 결과 · 제약 검증"]
  response["응답 검증 · 추천 / 질문 / 제안"]

  ui -->|"사용자 요청"| gate
  gate --> agent
  agent <--> memory
  agent -->|"도구 선택"| tools
  tools --> engine
  engine --- catalog
  engine --> observation
  observation -->|"관찰 · 필요 시 재계획"| agent
  agent -->|"질문 또는 최종 응답"| response
  response -->|"화면 표시"| ui
```

가상 예산 비교는 실제 조건을 바꾸지 않습니다. 예산·제외 조건 완화 제안은 사용자가 명시적으로 적용한 뒤 상태 버전을 확인해 반영합니다. 이미 명확하게 요청한 일반 조건 수정은 검증 후 반영하며, 대기 중에는 에이전트를 실행하지 않습니다.

[LLM Agent 설계 README](docs/llm-agent/README.md) · [구조도 Mermaid 원본](docs/llm-agent/architecture.mmd)

후속 목표는 **같은 상품 DB·조건·추천 엔진을 공유하는 LLM Agent와 Rule-based Hybrid의 비교**입니다. 차이는 LLM 호출 유무가 아니라 실행 제어 주체이며, Hybrid는 백엔드가 흐름을 제어하고 필요할 때만 LLM을 제한적으로 호출합니다. 우선 LLM Agent 설계를 문서화하며, 두 모드와 비교 실험은 아직 구현하지 않았습니다.

## 수령인별 기억과 구매 이력

AI 추천 화면의 `기억과 구매 이력 관리`에서 수령인의 선호·제외 조건을 명시적으로 저장하고, 실제 구매했다고 직접 등록한 상품에 만족도를 남길 수 있습니다. 같은 수령인을 위한 새 대화에서 기억과 긍정 구매 피드백을 반영합니다. 현재는 기기 내 계정별 저장이며 실제 주문 확인이나 기기 간 동기화는 제공하지 않습니다. [동작·저장 범위·검증 시나리오](docs/personalization.md)를 참고하세요.
