# 규칙 우선 Router 에이전트

현재 프로토타입을 바탕으로 구현한 A안이다. Router 코드가 분류·호출·종료를 결정하고, LLM은 규칙으로 해결하지 못한 문장의 조건 후보만 반환한다. 상품·순위·금액·예산 비교는 공통 PASS 엔진을 사용한다. 다른 에이전트 폴더와 `baseline/src/` 엔진은 수정하지 않았다.

## 실행

```sh
# GitHub 저장소 루트 기준
npm run test:router
node baseline/agents/a-router/demo.mjs
npm --prefix baseline run demo:agent -- a-router
npm run dev:api
```

로컬 API는 기본적으로 `a-router`를 선택한다. 기존 로그인 사용자의 채팅 요청은 같은 `/api/chat` 경로로 처리하며, 채팅 화면 코드를 바꿀 필요가 없다. 게스트·API 미설정 상태는 이전 기기 엔진을 계속 사용한다. 음성·카메라·앨범·파일 선택 UI는 변경하지 않았다. 첨부 서버 업로드·이미지 분석은 구현 범위 밖이다.

서버 `api/.dev.vars`의 `LLM_PROVIDER`로 OpenAI 호환 플랫폼 또는 Gemini를 선택한다. 현재 설정은 `deepseek-v4-flash`이며 `LLM_API_KEY`를 사용한다. Gemini를 선택할 때는 `GEMINI_API_KEY`와 `GEMINI_MODEL`을 사용한다. [플랫폼 설정·실제 시험](../../../docs/llm-platform.md). 키가 없으면 모호한 조건을 질문하고 원래 조건을 유지한다. 로컬에서 `CHAT_AGENT=legacy npm run dev:api`로 기존 처리 경로를 선택할 수 있다. `wrangler.jsonc`에도 `CHAT_AGENT=a-router`를 설정했으나, 코드 변경만으로 운영 API가 배포되는 것은 아니다.

## 처리 경로

| 입력 예시 | 처리 | LLM |
| --- | --- | --- |
| `엄마 예산 5만원 배송비 포함` | 조건 수정·필수 정보 확인·추천 | 0회 |
| `차 좋아해`, `견과류는 빼줘`, `덜 단 상품으로` | 선호·제외 수정 | 0회 |
| 배송비 질문 다음 `아니요` | 배송비 별도 확정 | 0회 |
| `추천해줘` | 현재 상태로 추천 | 0회 |
| `왜 추천했어?` | 실제 비용·선호 점수·정렬 기준 설명 | 0회 |
| `예산 7만원이면?`, `예산 2만원 올리면?` | 복제 상태에서 재계산·현재 예산 유지 | 0회 |
| `예산 7만원으로 바꿔줘` | 실제 조건 수정 | 0회 |
| `센스 있는 선물` | LLM 조건 후보 1회 또는 질문 | 최대 1회 |
| 충돌 예산, 주는 사람 취향, 잘못된 날짜 | 추측하지 않고 확인 질문 | 0회 |

부분적으로 해석한 문장에 알 수 없는 내용이 남으면 해당 부분을 무시해 조건을 적용하지 않는다. 한글·숫자·쉼표 금액과 주요 상품군·알레르겐·수령인·포장·절대 날짜 표현을 처리하는 제한된 규칙 파서다. 모든 한국어 표현을 이해하지는 않는다. 예산만 바꾸는 가상 질문에 다른 조건이 섞이면 확인하며, 결과가 없다고 제약을 자동 완화하지 않는다.

## 코드와 계약

- `parser.mjs`: 의도 분류·조건 규칙 파서. `parseConditions`와 `classifyIntent`.
- `index.mjs`: 코드 라우팅, 공통 검증 호출, 조건 후보 검증, 호출 상한·타임아웃, 상태 비변경 비교.
- `demo.mjs`: 규칙만으로 진행하는 다중 턴 예제.
- `tests/`: 규칙·LLM 경계·가상 비교·세션 분리 테스트.
- 공통 `baseline/llm/`: 공급자 연결·텍스트/JSON 처리. 선물 프롬프트는 앱 어댑터에서만 설정한다.
- 저장소의 `api/router-agent.mjs`: 기존 앱의 선물 하나 상태와 API 응답 형식으로 변환하는 서버 어댑터.

```js
import { createAgent } from './index.mjs';
const agent = createAgent({
  // 생략하면 규칙+질문으로 동작. 서버에서는 설정으로 선택한 플랫폼 또는 Gemini 추출기를 연결한다.
  interpret: async ({text, state, pendingQuestion, history, signal}) => ({
    patch: {}, questions: ['받는 사람의 조건을 확인해 주세요.'], unresolved: true,
  }),
});
const output = await agent.runTurn({session, request, products, pendingQuestion, history});
```

기본 `request`, `session`, `products` 계약은 공통 베이스라인과 같다. `interpret`는 조건 후보 `{patch, questions, unresolved}`를 반환한다. `pendingQuestion`은 호스트가 보관한 직전 미해결 질문, `history`는 최대 6개의 `{role,text}`다. 명확한 요청은 LLM을 거치지 않는다. 출력 `routing`에 `agent`, `intent`, `route`, `llmCalls`를 제공하며 원문·키·모델 내부 추론은 기록하지 않는다.

LLM 해석 상한은 논리 호출 1회, 기본 18초다. 프로토타입 전송기는 같은 제한 안에서 기존 5xx 재시도 1회를 유지하므로 HTTP 요청은 최대 2회다. 오류·타임아웃 때 기본 에이전트는 상태를 보존한 질문을 반환하고, 앱 API는 503으로 바꿔 기존 입력·재시도 UI를 사용한다. 실제 공급자 호출·기기 동작은 모의 테스트로 입증되지 않는다.

`singleGift:true`는 기존 앱의 고정된 수량 1·개별 예산 구조에 맞추는 옵션이다. 실제 앱은 여러 선물을 지원하지 않아 그런 입력은 확인한다. 처음 수령인을 정할 때는 앞서 입력한 조건을 유지하고, 이미 정한 수령인이 바뀌면 이전 조건을 초기화한다. 모델은 현재 수령인의 알레르겐 제외를 묵시적으로 삭제할 수 없다. 성분 미확정 질문은 호스트가 보관하고, 해결 전 추천·가상 비교를 막는다.

공통 코어는 버전 검사를 유지하지만 현재 프로토타입 API는 기존처럼 요청이 전달한 조건 상태를 처리하는 무상태 구조다. 서버 영속 세션·원자적 CAS·동시 기기 충돌 해결은 이번에 추가하지 않았다. 장기 기억은 기존 앱의 명시적 개인화 기능을 사용하며 새 자동 기억 저장은 하지 않는다.

작업 브랜치: `codex/architecture-a-router`.

## 동작 검증

`npm run audit:router`를 저장소 루트에서 실행하면 실제 API 핸들러의 합성 세션으로 10가지 시나리오를 검사한다. 규칙 경로의 LLM 호출 0회와 자유 발화의 실제 공급자 호출을 구분한다. 공급자 키가 필요하며 실제 모델 사용량이 발생한다. 실제 계정 데이터는 변경하지 않고, UI·실제 Supabase 인증은 이 명령의 범위 밖이다. [2026-11-05 결과·범위](../../../docs/verification/a-router-2026-11-05.md).
