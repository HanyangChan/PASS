# 귀속·플래너 작업 공간 (C안)

담당 범위: 주는 사람(giver)과 받는 사람(recipient)의 조건 귀속, 그리고 대화 계획.

| 단계 | 상태 |
| --- | --- |
| P1 귀속 분류 해석기 | 구현됨(마무리 2026-11-07). 규칙 + 주어 가드 + 선택적 LLM 2단계(reasoning off). 테스트는 모의 LLM만 사용 |
| P1 실제 LLM 평가(B층) | 평가셋 30문항·실행기 있음. `run-eval.mjs` 전체 평가는 아직 실행하지 않음. `try-attribution`으로 담당자가 부분 측정함 |
| P2 플래너, P3 설명, P4 기억 | 미구현. [TEST-PLAN.md](TEST-PLAN.md) 참조 |

완료 기준과 항목별 상태는 [TEST-PLAN.md](TEST-PLAN.md)를 따른다.

## 구조

```
발화 ─► rules.mjs        절 나누기 → claim 추출 → 주어로 owner 판정(인용문이면 판정 보류)
     ─► LLM 1단계 추출    규칙이 못 읽은 절이 있을 때만 (prompts.mjs)
     ─► LLM 2단계 분류    owner가 정해지지 않은 claim이 있을 때만
     ─► attribution.mjs  giver → 버림 / recipient → 강도 판단 후 patch 또는 확인 질문 / unknown → 확인 질문
     ─► checkedPatch     공통 조건 검증 → {patch, questions, unresolved}
```

| 파일 | 역할 |
| --- | --- |
| `vocabulary.mjs` | 고정 사전(성분 `ALLERGEN_NAMES`, 카테고리, 단맛 값, 허용 필드, 질문 템플릿) |
| `rules.mjs` | 규칙 1차 처리 |
| `prompts.mjs` | 추출·분류 프롬프트, `PROMPT_VERSION` |
| `attribution.mjs` | LLM 출력 검증(`validate` 콜백), claim → patch/질문 라우팅 |
| `interpreter.mjs` | `createInterpreter`: 전체 흐름, 시간 제한, 통계 |
| `index.mjs` | `interpretMessage`(네트워크 없음), `createAgent` |
| `configured-agent.mjs` | `createConfiguredAgent(env)`: 실제 LLM 연결(서버 전용) |
| `eval/` | B층 평가셋·지표·실제 LLM 실행기(`npm test`에 포함되지 않음) |

LLM은 patch나 질문을 만들지 않는다. LLM이 하는 일은 claim(`span`, `kind`, `value`, `polarity`, `strength`)과 owner를 고르는 것뿐이다. 값은 `ALLERGEN_NAMES`, `CATEGORIES`, `less_sweet`/`unsweetened` 안에서만 허용된다. patch는 코드가 만들고, 질문은 코드 템플릿만 쓴다.

**kind를 owner보다 먼저 판단한다.**
- 선물 조건 kind(`budget`, `quantity`, `delivery`, `recipient`)와 `other`는 누가 말했든 patch를 만들지 않는다. 분류 LLM도 부르지 않고, 안내 질문 1개로 끝난다.
- 규칙이 이미 조건 표현(예: "예산 100만원", "두 개")을 찾았고 정책이 `ask_first`이면, 결과가 정해져 있으므로 LLM을 아예 호출하지 않는다.

**주어 가드**
- 주어 표시가 없는 claim은 LLM 결과와 상관없이 owner가 `unknown`이다. 주어 표시란 "나/저/내가/제가", 받는 사람 호칭이나 다른 사람 + 조사, 인용문이면 인용한 화자를 말한다.
- 그래서 이런 claim은 분류 LLM을 부르지 않는다. 예: "견과류는 별로야"는 LLM 0회로 "견과류는 받는 분이 피하시는 건가요?"를 묻는다.
- 예외는 "견과류는 빼줘" 같은 선물에 대한 직접 지시로, 규칙이 recipient로 처리한다.

## 사용

```js
import { createAgent, createInterpreter } from './index.mjs';

createAgent();                                   // 규칙만 사용, 네트워크 호출 없음(공통 테스트·데모 기본값)
createAgent({ llm, mixedPolicy: 'ask_first' });  // llm은 baseline/llm의 클라이언트(completeJson)
createAgent({ interpret });                      // 주입한 해석기를 그대로 사용
const interpret = createInterpreter({ llm, mixedPolicy, timeoutMs, maxTokens, reasoning, onStats });
```

```js
// 서버에서 실제 LLM 사용
import { createConfiguredAgent } from './configured-agent.mjs';
const agent = createConfiguredAgent(process.env);
```

### 옵션

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `llm` | 없음 | 없으면 규칙만 쓴다. 규칙으로 판단할 수 없는 발화는 `unresolved:true` + 질문 1개 |
| `mixedPolicy` | `'ask_first'` | 받는 사람 조건과 불명확한 조건이 섞였을 때의 처리. `'ask_first'`는 아무것도 적용하지 않고 질문한다. `'apply_confirmed'`는 확정된 부분을 적용하고 질문한다(공통 수용 기준 3 해석은 팀 확인 필요) |
| `timeoutMs` | `8000` | 해석기 전체(LLM 1·2단계 합계) 제한. 넘으면 공통 클라이언트처럼 `LlmError('timeout')`을 던진다. 상태는 바뀌지 않고, 진단에 어느 제한에 걸렸는지(`timeoutSource`, `calls[].limit`) 남긴다 |
| `maxTokens` | `{extract: 1200, classify: 400}` | 단계별 출력 토큰 한도. 숫자 하나나 `{extract, classify}`로 덮어쓴다 |
| `reasoning` | `{enabled: false}` (off) | `null`이면 아무것도 보내지 않는다(공급자 기본). `{enabled}` → payload `reasoning: {enabled}`, `{effort: 'low'}` → payload `reasoning_effort: 'low'`(공통 클라이언트 `llm/index.mjs` 31·32행). 플랫폼이 거부하면 `request_rejected`(400·422)로 진단에 남는다 |
| `onStats` | 없음 | 호출마다 `{promptVersion, llmCalls, latencyMs, usage, timedOut, timeoutSource, path, claims, calls, skipped}`를 받는다. 키나 원문 응답은 넣지 않는다 |

### 결정 기록 (2026-11-07, `deepseek-v4-flash`, `c-attribution-p1-v2`)

- **reasoning 기본값 off**: 담당자 측정에서 off는 실패 0회, 출력 최대 40토큰, 문장당 최대 3.3초였고, 4·6번 정확도는 다른 설정과 차이가 없었다. 옵션 없음(공급자 기본)일 때는 분류 1회에 출력 1,369토큰, 10.8초가 걸렸다.
- **분류 한도 400**: 검증기가 허용하는 최대 출력은 owner 10개(`{"id":"c9","owner":"recipient"}` × 10)로 약 340자, 약 120토큰이다. 여기에 약 3배 여유를 두었다(관측 최대 40토큰).
- **추출 한도 1200**: claim 하나는 고정 키 약 30토큰과 span(현실적으로 40자 이하, 한국어 1자 ≈ 1토큰 이하로 가정, 확인 필요)을 합쳐 약 70토큰이다. 10개면 약 700토큰이고, 여기에 약 1.7배 여유를 두었다. span이 아주 긴 극단적 출력은 잘려서 `invalid_response`(클라이언트 단계 실패)로 안전하게 실패한다.
- **해석기 시간 제한 8초**: 관측 최대 3.3초의 약 2.4배다. 공통 클라이언트의 요청당 18초보다 짧아서 보통은 이 제한이 먼저 걸린다.
- **시간 초과는 오류로 전달**: 해석기 제한에 걸려도 질문으로 바꾸지 않고 `timeout` 오류를 던진다. 다른 LLM 오류를 전달하는 방식(T1-49, LLM-USAGE.md 6절)과 맞추기 위해서다.
- **주어 가드**: P1-live 3번처럼 주어가 없는 문장에서 LLM 분류가 결과를 바꾸지 않게 했다. 분류 호출도 하지 않으므로 보류했던 T1-50(LLM 생략)이 함께 해결됐다.
- **추출과 분류를 한 번의 호출로 합치기**: 하지 않는다. off 기준 2단계 문장도 3.3초 이내였고, 단계를 나눠야 진단과 검증이 단계별로 남는다.

**진단 정보 `calls[]`** (LLM 요청 1건마다 1개)

| 필드 | 뜻 |
| --- | --- |
| `stage` | `extract` 또는 `classify` |
| `maxTokens` | 이 요청에 쓴 한도 |
| `reasoning` | 이 요청에 보낸 reasoning 설정(`null`이면 보내지 않음) |
| `errorCode` | 실패 시 오류 코드(`invalid_response`, `timeout`, `request_rejected` 등), 성공 시 `null` |
| `limit` | `timeout`일 때 걸린 제한: `interpreter`(해석기 전체) 또는 `transport`(공통 클라이언트 요청당 18초) |
| `completionTokens` | 이 요청의 출력 토큰 수 |
| `validateCalled` | 내 검증 함수까지 도달했는지 |
| `rejectReason` | 검증 탈락 규칙(`sweetness_value`, `span`, `claim_keys`, `strength`, `value_vocabulary`, `owner_entry`, `owner_free_fields` 등) |
| `clientStageFailure` / `note` | 검증 전에 `invalid_response`가 난 경우. 공통 클라이언트가 `finish_reason`을 보여주지 않으므로 "끊김·빈 응답·JSON 파싱 가능성"으로만 표시하고 원인을 단정하지 않는다 |
| `latencyMs` | 이 요청의 지연 |

**최악의 대기 시간** (해석기 전체 8초, 공통 클라이언트 요청당 18초. 18초에는 5xx 재시도도 포함)

| 경우 | 끝나는 시점 | 결과 |
| --- | --- | --- |
| LLM 1회 또는 2회 문장이 끝나지 않음 | 8초(해석기 제한이 항상 먼저) | 요청 취소, `timeout` 오류(`limit: 'interpreter'`), 상태 불변 |
| `timeoutMs`를 18초보다 크게 설정한 경우 | 요청 1건이 18초 | `timeout` 오류(`limit: 'transport'`), 상태 불변 |

따라서 기본 설정에서 사용자가 기다리는 최대 시간은 약 8초(+수 ms)다.

**오류 처리**
- LLM 오류(`configuration`, `auth_failed`, `quota_exceeded`, `timeout`, `network_error`, `invalid_response`, `request_rejected`)는 해석기 시간 초과를 포함해 모두 코드 그대로 전달된다. 공통 `runTurn`이 이를 거부하고, 호출자 세션은 바뀌지 않는다.
- 다시 시도할지는 호스트가 정한다([LLM-USAGE.md](../LLM-USAGE.md) 6절). 오류 코드와 걸린 제한은 `onStats` 진단에도 남는다.

## 테스트와 실행

```sh
# 저장소 루트 기준. 모의 LLM만 사용(실제 호출 없음)
npm --prefix baseline test
npm --prefix baseline run demo:agent -- c-attribution
```

아래 명령은 **실제 LLM을 호출한다.** 담당자가 직접 실행하고 비용·토큰을 확인한다.

```sh
# 9문장 시험(진단·요약 포함). --only 문장 선택, --repeat=N 반복, --reasoning=off|low|none(기본 off), --max-tokens 이번 실행만 한도 변경
node --env-file=baseline/llm/.env baseline/agents/c-attribution/examples/try-attribution.mjs --only=3,6 --repeat=3


# 발화 하나(P1-live): kind, patch, 질문, 호출 수, 지연, 토큰 출력
node --env-file=baseline/llm/.env baseline/agents/c-attribution/eval/run-live.mjs "엄마는 견과류는 좀 그렇대"

# 평가셋 전체(B층): 결과는 eval/results/에 모델·PROMPT_VERSION·날짜·평가셋 해시와 함께 저장
node --env-file=baseline/llm/.env baseline/agents/c-attribution/eval/run-eval.mjs --repeat 5
```

## 알려진 한계

- **확인 질문에 대한 짧은 답**: "응", "맞아"를 이전 질문과 연결하지 못하고 일반 질문을 반환한다. P2 플래너(T2-19)에서 다룬다.
- **단맛**: 엔진에는 점수만 있고 단맛을 강제로 제외하는 필터가 없다. `less_sweet`는 덜 단 상품을 앞에 둘 뿐이다.
- **성분 범위**: 성분 제외는 `ALLERGEN_NAMES` 20개만 가능하다. 땅콩·호두·잣·견과류는 서로 다른 값이며, 하나를 제외해도 다른 것까지 제외하지 않는다.
- **규칙의 한계**: 규칙은 한 절 안에서 인식한 표현만 claim으로 만든다. 같은 절의 나머지 말은 무시될 수 있다. 정확도는 B층 평가로 확인해야 한다.

## P2 설계 메모: 확정 조건 "대기" 보관(D8, 구현하지 않음)

`ask_first`에서 "엄마는 견과류 알레르기가 있고 단 건 별로야"처럼 확정된 조건(견과류)과 불명확한 조건이 섞이면, 지금은 아무것도 적용하지 않고 질문만 한다. 대안은 확정된 patch를 `plannerState.pending`에 보관했다가, 다음 턴 답이 오면 공통 `runTurn`의 `kind:'patch'` 요청으로 함께 적용하는 방식이다.
- 장점: 사용자가 견과류를 다시 말하지 않아도 된다. "응"·"맞아" 같은 짧은 답을 직전 질문과 연결할 수 있다(T2-19).
- 단점: 세션 밖(`plannerState`)에 조건이 남는다. 그 사이 다른 요청으로 수령인이 바뀌거나 버전이 올라가면 대기 patch가 낡는다. 답이 오지 않으면 언제 버릴지 정해야 하고, 확정 조건을 늦게 적용하는 것이 수용 기준 3과 맞는지 팀 확인이 필요하다.
- 현재 결론: 구현하지 않는다(팀 결정 필요).

## 진행 기록

- **P2 (2026-11-07)**: `planner.mjs`의 `createPlannedAgent`가 공통 `runTurn`을 감싸 `plan`을 덧붙인다. 반복 질문 방지, 턴 제한(필수 조건이 있을 때만 `view` 재실행 추천), LLM 오류를 호스트 안내로 바꿈(재시도 없음), 제3자 질문 템플릿을 넣었다.
- 미구현: T2-02(설명 요청 종류 없음), T2-18·T2-19(D8 대기 보관). 다음은 P3 설명.
- **P3 (2026-11-07)**: `explain.mjs`가 카드·엔진 재계산·`budgetAlternatives`만으로 이유·대조(점수→인기도→가격→id)·반사실((a)/(b)/(c))을 만든다. P2의 추천·비교 응답에 `explanation`으로 붙는다. 단맛 선호는 "덜 단 상품을 우선"으로 표현한다.
- 시드 고정 무작위 검사(300세트)로 제약과 설명 금액을 검증한다. 남은 일은 P4 기억이다.

브랜치: `codex/architecture-c-attribution`. 공통 규칙은 [상위 안내](../README.md)를 따른다.
