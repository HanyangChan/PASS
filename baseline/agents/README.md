# 에이전트별 작업 공간

LLM을 연결하려면 [공통 LLM 사용 방법](LLM-USAGE.md)을 먼저 따른다. 서버 키 설정, 실제 연결 확인, 텍스트·JSON 호출과 기존 `createAgent`에 연결하는 예제를 제공한다.

| 폴더 | 설계 | 권장 브랜치 |
| --- | --- | --- |
| `a-router/` | 규칙 Router | `codex/architecture-a-router` |
| `b-pipeline/` | 역할 파이프라인 | `codex/architecture-b-pipeline` |
| `c-attribution/` | 귀속·플래너 | `codex/architecture-c-attribution` |
| `d-langgraph/` | LangGraph | `codex/architecture-d-langgraph` |
| `e-tiered/` | Low/High 계층 | `codex/architecture-e-tiered` |

`a-router/`는 규칙 우선 Router와 현재 앱 API 어댑터를 구현했다. 나머지 네 폴더는 미구현 시작 틀이다. 각자 담당 폴더 안에 코드·프롬프트·도구·테스트를 추가한다. 브랜치는 이 공통 설정이 포함된 main에서 분기한다. 실제 브랜치 생성은 담당자가 작업을 시작할 때 한다.

별도 비교안 [full-chat/](full-chat/README.md)는 모든 채팅 발화를 모델이 처리하는 B안이다. 위 `b-pipeline/` 시작 틀과 다른 실험이며 서버 `CHAT_AGENT=full-chat`으로 선택한다. 규칙 우선 registry와 별도 진입점을 사용한다. `npm run dev:api:full-chat`으로 실행하고 `npm run test:full-chat`으로 검사한다.

[full-chat-feedback/](full-chat-feedback/README.md)는 같은 B 행동 모델에 검토·수정 복귀를 추가한 실험이다. `CHAT_AGENT=full-chat-feedback-1` 또는 `full-chat-feedback-2`로 선택하고 `npm run benchmark:feedback`으로 시간·성공률을 비교한다. 기본 모드는 변경하지 않는다.

```sh
# 저장소 루트 기준
npm --prefix baseline test
npm --prefix baseline run demo:agent -- a-router
```

```js
import { loadAgent } from './registry.mjs';
const agent = loadAgent('a-router');
const result = await agent.runTurn({ session, request, products });
```

`index.mjs`의 `interpretMessage({text,state})`를 구현하면 공통 코어가 규칙으로 처리하지 못한 발화에 연결한다. 반환값은 `{patch, questions, unresolved}`이며, 확정하지 못한 조건은 질문한다. 현재 `a-router/`를 제외한 폴더는 시작 틀이다. 규칙으로 처리 가능한 요청은 공통 코어가 처리하고, 미구현 자유 발화는 상태를 변경하지 않고 질문한다.

`createAgent({interpret})`로 해석기를 주입할 수도 있다. `runtime.mjs`는 세션·조건·결과 검증을 기존 `src/index.mjs`에 위임한다. 확장기가 임의 조건·추천 결과를 직접 반환하는 경로를 만들지 않는다.

`a-router/`는 별도 코드 Router를 사용하되 동일한 공통 검증·추천 코어를 호출한다. 다른 폴더의 공통 연결기는 해석기 확장용이다. LangGraph 병렬 자문, 검색, 기억, 설명 생성까지 이 포트가 모두 제공하는 것은 아니다. 필요하면 담당 폴더에 별도 오케스트레이터를 추가하되 공통 엔진과 수용 기준을 재사용한다. LangGraph·LLM SDK는 아직 설치하지 않았으며 담당 구현에서 선택한다.

공통 `src/`, `src/vendor/`, `tests/`, `agents/runtime.mjs`, `agents/registry.mjs` 변경은 팀 공통 변경으로 관리한다. 개별 의존성은 담당 폴더의 별도 `package.json`에 선언하고 실행법을 문서화한다. 루트 `npm test`는 Node.js 기본 실행기에서 실행 가능한 `*.test.mjs`를 찾는다. 다른 언어·테스트 실행기는 담당 README에 명령을 추가한다.

API 키는 서버 환경에서만 읽는다. 로컬 `.env`는 커밋하지 않고, 필요한 환경 변수 이름은 값 없는 `.env.example`로 문서화한다. `a-router/`는 서버 `CHAT_AGENT=a-router` 설정으로 현재 로그인 채팅 API에 연결된다. 다른 에이전트의 연결·화면에서 에이전트 선택은 후속 작업이다.

## 공통 LLM 사용

LLM 연결만 필요하면 [`baseline/llm/`](../llm/README.md)를 사용한다. 담당 폴더에서 `import { createLlmFromEnv } from '../../llm/index.mjs'`로 가져오고 서버 `env`를 전달한다. `complete`는 일반 텍스트, `completeJson`은 JSON과 각자 정의한 검증을 지원한다. 공통 모듈은 프롬프트·추천·Router를 포함하지 않으며 키는 서버에서만 읽는다.
