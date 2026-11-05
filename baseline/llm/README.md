# LLM 공통 기반

이 디렉터리만 복사해 서버에서 사용할 수 있는 OpenAI 호환 LLM 클라이언트다. 외부 패키지, 앱, 선물 조건 스키마, Router, 상품 DB, 에이전트 구현에 의존하지 않는다. 공통 main에는 이 연결 기반만 포함한다.

기본 설정은 현재 확인한 플랫폼 `https://llm.ai.hy.miwork.ai`와 `deepseek-v4-flash`다. 모델·Base URL·경로는 변경할 수 있다. Gemini 전용 프로토콜, 도구 호출, 스트리밍은 이 공통 모듈에 포함하지 않는다. `json_schema`는 공급자가 지원할 때만 선택한다.

## 각자의 에이전트에서 사용

```js
// baseline/agents/<담당 폴더>/index.mjs 에서
import { createLlmFromEnv } from '../../llm/index.mjs';

// Node: 서버 process.env. Worker: 서버 핸들러에서 받은 env.
const llm = createLlmFromEnv(env);
const result = await llm.complete({
  messages: [
    { role: 'system', content: '여기에 본인 에이전트의 역할과 규칙을 작성하세요.' },
    { role: 'user', content: userMessage },
  ],
});
console.log(result.text);
```

JSON이 필요하면 `completeJson`을 사용한다. 프롬프트·반환 스키마와 검증은 각 에이전트가 정의한다.

```js
const result = await llm.completeJson({
  messages: [
    { role: 'system', content: 'Return JSON with a string field intent. No markdown.' },
    { role: 'user', content: userMessage },
  ],
  validate: data => typeof data?.intent === 'string',
});
const intent = result.data.intent;
```

`complete`는 `{text, provider, model, usage}`, `completeJson`은 여기에 `data`를 추가해 반환한다. JSON 파싱만으로 업무 스키마가 검증되는 것은 아니므로 `validate` 콜백을 제공한다. `json_schema` 모드는 `schema`와 선택적인 `schemaName`을 전달한다.

## 단독 실행

Node.js 22.13 이상에서 실행한다. 패키지 설치는 필요 없다.

```sh
cd baseline/llm
cp .env.example .env
# .env에 본인 서버 API 키 입력
npm test
npm run demo
```

기존 앱의 서버 키를 재사용해서 시험할 때는 저장소 루트에서 실행한다. 키를 복사하거나 출력하지 않는다.

```sh
node --env-file=api/.dev.vars baseline/llm/examples/demo.mjs
```

이 예제는 선물 조건을 보내지 않고 `{ "ok": true }` 응답만 확인한다. 실제 모델 호출이 발생한다. 파일을 읽는 동작은 예제 실행기의 `--env-file`에만 있고 라이브러리는 전달받은 `env`만 사용한다.

## 공통 책임과 경계

- 포함: Bearer 인증, 메시지 전송, 모델·Base URL 선택, 텍스트·JSON 응답, 토큰 사용량, 오류 정리, 제한 시간·취소, 5xx 재시도 1회.
- 제외: 에이전트 프롬프트, 조건 추출·추천·기억·계획·라우팅, 대화 저장, 인증 서버·웹 화면.
- 키는 서버 환경에만 두며 `.env`를 커밋하지 않는다. 브라우저에서 클라이언트를 생성하면 `server_only` 오류를 반환한다.
- `createLlmClient({apiKey, model, baseUrl, fetcher, timeoutMs, onUsage})`로 직접 구성할 수도 있다. 기본 제한은 18초이며 재시도도 같은 제한을 사용한다. 401·403·429·400은 재시도하지 않는다.
- 요청별 `signal`, `temperature`, `maxTokens`, `responseFormat`을 전달할 수 있다. 내부 추론과 공급자의 원문 오류는 반환하지 않는다. 키가 없으면 실제 호출 시 `configuration` 오류이며 다른 공급자의 키로 대체하지 않는다.
- 텍스트는 업무 근거 검증 없이 반환된다. 각 에이전트가 자기 결과를 검증해야 한다. 이 모듈을 가져오는 것만으로 기존 앱이나 다른 에이전트가 자동으로 LLM을 사용하는 것은 아니다.
