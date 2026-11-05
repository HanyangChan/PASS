# 플랫폼 LLM 연결과 DeepSeek 시험

현재 `a-router` 브랜치는 OpenAI 호환 Chat Completions와 기존 Gemini를 선택할 수 있다. 현재 선택값은 사용자 플랫폼의 `deepseek-v4-flash`다. 규칙 Router와 추천·금액 엔진은 그대로 유지한다.

## 로컬 설정

숨김 파일 `api/.dev.vars`에 설정한다. 파일 앞의 점을 포함한다. Git에서 제외되며 키를 모바일 `EXPO_PUBLIC_*` 환경 변수에 넣지 않는다.

```dotenv
CHAT_AGENT=a-router
LLM_PROVIDER=openai-compatible
LLM_BASE_URL=https://llm.ai.hy.miwork.ai
LLM_CHAT_PATH=chat/completions
LLM_MODEL=deepseek-v4-flash
LLM_RESPONSE_FORMAT=json_object
LLM_API_KEY=발급받은_전체_키
```

기존 Supabase 설정과 Gemini 키는 유지할 수 있다. 플랫폼을 선택했을 때는 `LLM_API_KEY`만 사용하고 기존 Gemini 키를 대신 보내지 않는다. 플랫폼 키가 비어 있으면 규칙으로 처리하고 모호한 문장은 확인한다. 공급자 실패 때 다른 공급자나 모델로 자동 전환하지 않는다.

```sh
# 저장소 루트에서, 합성 데이터로 실제 모델 호출 1회
npm run smoke:llm

# 같은 설정으로 현재 앱의 로컬 추천 API 실행
npm run dev:api
```

앱을 연결하려면 기존 `mobile/.env.local`의 `EXPO_PUBLIC_CHAT_API_URL`을 로컬 웹 시험에서는 `http://127.0.0.1:8788`로 설정하고 앱 개발 서버를 재시작한다. 로그인된 채팅은 이 API를 사용하고, 게스트는 기존 기기 엔진을 사용한다. 실기기는 해당 기기의 localhost가 아닌 접근 가능한 HTTPS API 주소를 사용한다. 음성·첨부 UI는 변경하지 않았다.

규칙으로 읽히는 `예산 7만원으로 바꿔줘`는 모델 호출이 0회다. `센스 있는 선물`처럼 규칙 밖인 문장은 선택한 모델에 조건 추출을 요청한다. `GET /health`에서 설정된 `provider`, `model`, 상품 수를 확인할 수 있다. 채팅 응답의 `mode`, `llmProvider`, `llmModel`은 실제 해석 방식과 사용 모델을 표시한다.

## 실제 시험 결과

2026-11-05 서버에 저장한 키로 아래 경로의 실제 호출을 확인했다.

- 공급자: `openai-compatible`, 모델 ID: `deepseek-v4-flash`
- 실제 경로: `https://llm.ai.hy.miwork.ai/chat/completions`
- JSON 출력 모드: `json_object`
- 합성 입력에서 `category:coffee_tea`, `견과류` 제외를 추출하고 기존 예산 50,000원·배송비 포함을 유지
- 단일 시험 지연 약 2.9초, 입력 1,147·출력 269·총 1,416토큰

실제 계정 데이터나 상품 카탈로그를 보내지 않고 고정 합성 조건으로 시험했다. 위 수치는 단일 요청의 관측값이며 일반적인 지연·비용·정확도를 보장하지 않는다. 키와 공급자 원문 오류는 출력하지 않는다.

## 호환·실패 처리

`lib/openai-compatible.mjs`는 Bearer 인증, Chat Completions 요청, JSON 파싱과 기존 스키마 검증을 담당한다. 공통 추출 지침은 Gemini와 공유한다. 조건 추출 결과는 Router의 제약 검사도 받는다. 잘린 출력·잘못된 JSON·도구 호출·미지원 조건 값은 적용하지 않는다. 내부 추론 필드는 응답으로 노출하지 않는다.

[DeepSeek 공식 JSON 안내](https://api-docs.deepseek.com/guides/json_mode/)의 `response_format: {type: "json_object"}` 형식을 기본으로 한다. `json_schema`와 `text`도 설정할 수 있으나 공급자가 지원하는지 확인해야 한다. 이번 플랫폼에서 실제 검증한 형식은 `json_object`다. 명시적인 경로 변경이 필요한 경우 `LLM_CHAT_PATH=v1/chat/completions` 또는 Base URL의 `/v1` 접두어를 사용할 수 있다. 자동으로 두 경로를 호출하지 않는다.

논리 해석은 1회, 18초 제한이며 5xx에 대해서만 동일 제한 안에서 HTTP 재시도 1회를 허용한다. 키 오류·429·잘못된 요청은 재시도하지 않는다. 공급자 실패는 기존 앱에서 재시도할 수 있는 503으로 반환하며 기존 조건은 바꾸지 않는다.

`smoke:llm`의 오류 코드는 `auth_failed`(키·권한), `quota_exceeded`(사용 한도), `endpoint_or_model_not_found`(경로·모델), `request_rejected`(요청 옵션), `invalid_response`(JSON·스키마), `timeout`·`network_error`(연결), `condition_check_failed`(시험 조건 불일치)다.

## 운영 환경

`api/wrangler.jsonc`에는 공급자·Base URL·모델 같은 공개 설정만 둔다. Cloudflare에는 `LLM_API_KEY`를 secret으로 별도 등록해야 한다. 이 변경은 운영 API를 배포하지 않는다. Gemini로 복귀하려면 `LLM_PROVIDER=gemini`와 기존 `GEMINI_API_KEY`, `GEMINI_MODEL`을 사용한다.
