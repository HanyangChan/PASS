# 귀속·플래너 작업 공간 (C안)

담당 범위: 주는 사람(giver)과 받는 사람(recipient)의 조건 귀속, 대화 계획, 설명, 수령인 기억.

| 단계 | 상태 |
| --- | --- |
| P1 귀속 분류 해석기 | 구현됨. 규칙 + 주어 가드 + 선택적 LLM 2단계(reasoning off) |
| P2 플래너(오케스트레이터) | 구현됨. 단, 대기 보관(D8)과 짧은 답 연결(T2-19)은 미구현 |
| P3 설명 | 구현됨. 템플릿만 사용, LLM 0회 |
| P4 수령인 기억 | 구현됨. 프로세스 메모리 저장소만 있고, 영속 저장(DB)은 호스트 몫 |
| P5 조립·데모 | 구현됨. `createConfiguredAgent`, `examples/live-demo.mjs`. 실제 LLM 데모는 담당자가 실행 |
| B층 실제 LLM 평가 | 평가셋 30문항·실행기 있음. `run-eval.mjs` 전체 평가는 아직 실행하지 않음 |
| 앱(`/api/chat`)·화면 연결 | 미구현(후속 작업) |

모든 자동 테스트는 모의 LLM만 쓴다. 완료 기준과 항목별 상태는 [TEST-PLAN.md](TEST-PLAN.md)를 따른다.

## 구조

```
요청 ─► createConfiguredAgent / createPlannedAgent  (planner.mjs, P2)
          │
          ├─► 공통 runTurn (baseline/src, 수정하지 않음)
          │     └─ 규칙 parseRules가 못 읽으면 ─► 해석기 interpret (P1)
          │            rules.mjs      절 나누기 → claim 추출 → 조건 kind 우선 → 주어로 owner 판정
          │            주어 가드      주어 표시가 없으면 unknown(분류 LLM 생략)
          │            LLM 1단계 추출  규칙이 못 읽은 절이 있을 때만 (prompts.mjs, reasoning off)
          │            LLM 2단계 분류  owner가 정해지지 않고 주어 표시가 있는 claim만
          │            attribution.mjs giver 버림 / recipient → patch 또는 확인 질문 / unknown → 질문
          │            checkedPatch   → {patch, questions, unresolved}
          │
          ├─► 기억 (memory.mjs, P4, 선택)  대화당 1회 공통 patch 요청으로 적용, 적용된 claim은 저장 제안
          ├─► planNext (P2)               ask / confirm / request_edit / recommend / compare / error
          │                               (턴 제한 + 필수 조건 있음 → 공통 view 재실행)
          └─► explain (explain.mjs, P3)   이유 · 대조 · 반사실 · 근거(facts)
응답 = 공통 결과 그대로 + plan (+ explanation)
```

| 파일 | 역할 |
| --- | --- |
| `vocabulary.mjs` | 고정 사전(성분 `ALLERGEN_NAMES`, 카테고리, 단맛 값, 허용 필드, 질문 템플릿) |
| `rules.mjs` | 규칙 1차 처리, 주어 표시 판정 |
| `prompts.mjs` | 추출·분류 프롬프트, `PROMPT_VERSION` |
| `attribution.mjs` | LLM 출력 검증(`validate` 콜백), claim → patch/질문 라우팅 |
| `interpreter.mjs` | `createInterpreter`: P1 전체 흐름, 시간 제한, 진단 |
| `planner.mjs` | `createPlannedAgent`, `planNext`, `missingField`, `createPlannerState`, `ERROR_NOTICES` |
| `explain.mjs` | `explain`: 엔진 사실만으로 설명 |
| `memory.mjs` | `createMemoryStore`, `memoryPatch` |
| `configured-agent.mjs` | `createConfiguredAgent(env, options)`: 실제 LLM + P2~P4 조립(서버 전용) |
| `index.mjs` | `interpretMessage`(네트워크 없음), 기본 `createAgent`(공통 테스트용, 바꾸지 않음) |
| `examples/` | `live-demo.mjs`(6턴), `try-attribution.mjs`(문장 시험) — 실제 LLM, `npm test` 제외 |
| `eval/` | B층 평가셋·지표·실제 LLM 실행기 — `npm test` 제외 |

## 진입점

```js
import { createAgent } from './index.mjs';
createAgent();                // 기본: 규칙만, 네트워크 없음. 공통 runTurn과 결과가 같다(공통 테스트가 검사)

import { createPlannedAgent } from './planner.mjs';
const agent = createPlannedAgent({ llm, maxTurns: 8, memory });     // llm 없으면 규칙만
const out = await agent.runTurn({ session, plannerState, request, products, recipientId });
// out = 공통 결과(kind, session, result, question, trace, evaluatedState) + plan (+ explanation)
// 다음 턴에는 out.session과 out.plan.plannerState를 넘긴다. plannerState는 session에 넣지 않는다.

import { createConfiguredAgent } from './configured-agent.mjs';
const live = createConfiguredAgent(process.env);   // 서버에서만. 키는 env 인자로만 받는다
```

- `plan`: `{action, field, question, notice, unapplied, turn, maxTurns, turnLimitReached, error, attribution, llm, memory?, plannerState}`. 화면에는 `plan.question`(최대 1개)이나 `plan.notice`를 보여준다.
- `kind:'error'`는 LLM 오류다. `plan.error.code`와 안내(`ERROR_NOTICES.retry`는 잠시 후 재시도, `ERROR_NOTICES.operator`는 운영자 확인)가 있고, `session`은 입력 그대로다. 자동 재시도는 없다. `version_conflict` 같은 공통 오류는 그대로 던진다.
- `explanation`: `{reason, contrastive, counterfactual, facts, hypothetical}`. 추천·비교 응답에만 붙는다.
  - 사용자 문장은 `reason.text`, `contrastive.text`, `counterfactual.text`뿐이다. 영문 내부 키나 `(a)` 같은 표시는 문장에 넣지 않고, 기준은 `contrastive.basis`(`score`/`popularity`/`price`/`id_order`), 반사실 경우는 `counterfactual.case`(`a`/`b`/`c`), 점수 구성은 `contrastive.breakdown`에 둔다.
  - 점수는 수령인 그룹에 어울리는 종류(+1)와 말씀하신 선호(카테고리 +3, 단맛 2/1)로 나눠 쓴다(`scoreBreakdown`, 합계는 엔진 점수와 같음).
  - 비교(what_if)는 "…원으로 올린다면 … 지금 적용된 … 그대로예요"처럼 가정 예산임을 밝히고, `hypothetical`에 가정·현재 금액을 둔다.
- 기억: `createMemoryStore()` 저장소를 넘기고, `runTurn`에 호스트의 안정적인 `recipientId`(표시 이름이 아님)를 주면 사용한다. 저장 제안은 `plan.memory.proposals`로 나오고, 호스트가 사용자 확인 후 `memory.confirm(id)`을 호출해야 저장된다.

## 환경 변수 (서버, 값은 `baseline/llm/.env`에만)

`LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_CHAT_PATH`, `LLM_MODEL`, `LLM_API_KEY`. 키는 앱 번들·`EXPO_PUBLIC_*`·코드·로그에 넣지 않는다.

## 실행

```sh
# 저장소 루트 기준. 모의 LLM만 사용(실제 호출 없음)
npm --prefix baseline test
npm --prefix baseline run demo:agent -- c-attribution
```

아래 명령은 **실제 LLM을 호출한다.** 담당자가 직접 실행하고 비용·토큰을 확인한다.

```sh
# P5 8턴 데모(7·8턴은 분류 LLM 1회씩, maxTurns 10): 턴마다 kind, 적용 조건, 질문, 상위 카드, 설명, plan, LLM 호출·토큰·지연
node --env-file=baseline/llm/.env baseline/agents/c-attribution/examples/live-demo.mjs

# 문장 시험(진단·요약). --only, --repeat=N, --reasoning=off|low|none(기본 off), --max-tokens
node --env-file=baseline/llm/.env baseline/agents/c-attribution/examples/try-attribution.mjs --only=3,6 --repeat=3

# 발화 하나(조립된 에이전트 경유)
node --env-file=baseline/llm/.env baseline/agents/c-attribution/eval/run-live.mjs "엄마는 견과류는 좀 그렇대"

# 평가셋 전체(B층, 기본 reasoning off, 해석기 제한 8초). --timeout-ms N(최대 17000)은 측정용. 결과는 eval/results/에 저장
node --env-file=baseline/llm/.env baseline/agents/c-attribution/eval/run-eval.mjs --repeat 2
```

## 확정 결정

**P1 귀속**
- LLM은 claim과 owner만 고른다. patch는 코드가 사전으로 만들고 `checkedPatch`로 검증하며, 질문은 코드 템플릿만 쓴다. 한 턴 질문은 최대 1개다.
- kind를 owner보다 먼저 판단한다. 예산·수량·배송일·수령인·`other`는 patch를 만들지 않고 안내 질문 1개로 끝낸다.
- 주어 표시(나/저/제가/내가, 받는 사람 호칭이나 다른 사람 + 조사, 인용 화자)가 없는 claim은 LLM과 상관없이 unknown이다. 직접 지시("빼줘")는 예외다.
- 강도는 귀속 다음에 판단한다(D3). 알레르기·못 먹어·빼줘는 바로 제외하고, 별로·싫어는 확인 질문을 한다. 단맛(D4)은 "설탕·단 것 피함 → `less_sweet`", "무가당·단맛 없는 → `unsweetened`"이고, 설명에서는 "덜 단 상품을 우선"이라고 쓴다.
- 혼합 발화는 `mixedPolicy`로 처리하고 기본은 `ask_first`다. 배열 필드는 기존 값과 합치고, patch에 `recipients`는 넣지 않는다.

**P1 측정 기반 기본값** (2026-11-07, `deepseek-v4-flash`, `c-attribution-p1-v2`)
- **reasoning 기본값 off**: 담당자 측정에서 off는 실패 0회, 출력 최대 40토큰, 문장당 최대 3.3초였고, 4·6번 정확도는 다른 설정과 차이가 없었다. 공급자 기본일 때는 분류 1회에 1,369토큰, 10.8초가 걸렸다.
- **분류 한도 400**: 검증기가 허용하는 최대 출력은 owner 10개로 약 120토큰이다. 여기에 약 3배 여유를 두었다.
- **추출 한도 1200**: claim 10개를 약 700토큰으로 잡고 약 1.7배 여유를 두었다. span 토큰 수는 한국어 1자 ≈ 1토큰 이하로 가정했다(확인 필요). 이보다 긴 출력은 잘려서 `invalid_response`로 안전하게 실패한다.
- **해석기 시간 제한 8초**: 관측 3.3초의 약 2.4배이고, 공통 클라이언트의 요청당 18초보다 먼저 걸린다. 걸리면 `timeout` 오류를 던진다.
- **추출과 분류는 합치지 않는다**: 2단계 문장도 3.3초 이내였고, 단계를 나눠야 진단과 검증이 단계별로 남는다.

**P2~P5**
- 기본 `createAgent()`는 바꾸지 않는다. P2~P5는 `createPlannedAgent`와 `createConfiguredAgent`로만 쓴다.
- 플래너는 공통 결과를 바꾸지 않고 `plan`만 덧붙인다.
  - 같은 질문 문구나 같은 누락 필드는 다시 묻지 않는다. 대체 문구를 쓰고, 그것도 물었으면 조건 편집 안내로 바꾼다.
  - 턴 제한에 도달하면 필수 조건이 있을 때만 확인된 조건으로 추천한다.
- 오류는 해석기가 던지고 오케스트레이터(호스트 역할)가 안내로 바꾼다. 재시도하지 않는다.
- 설명은 엔진 숫자만 쓴다. 대조는 엔진 재계산 순서가 카드와 같을 때만 기준을 말하고, (b) 경우에는 "바뀐다"고 쓰지 않는다.
- 기억은 recipient 사실만, 확인 후에만 저장한다. 선물 지시("빼줘")는 사실이 아니라 저장하지 않는다. 적용은 대화당 1회 공통 patch 요청으로 하고, 현재 요청이 우선이다. 해석기가 질문 중인 턴에는 적용을 미룬다.

## 설계와 공통 수용 기준이 부딪히는 지점의 결정

| 지점 | 결정 |
| --- | --- |
| 턴 제한의 "최선 추천" vs 기준 2(필수 조건 임의 확정 금지) | 필수 조건이 모두 있을 때만 공통 `view`로 추천한다. 없으면 누락 안내만 하고 아무것도 지어내지 않는다 |
| 혼합 발화 부분 적용 vs 기준 3 | 기본 `ask_first`(적용 안 함). `apply_confirmed`는 옵션으로만 둔다(팀 확인 필요) |
| 제약 검사기의 "위반 상품 제거" vs 기준 1·6 | 상품을 빼지 않는다. 공통 `resultFor`의 오류 방식을 그대로 쓰고, 무작위 300세트로 회귀 검사한다 |
| LLM 오류를 질문으로 바꾸기 vs LLM-USAGE.md 139행 | 해석기는 오류를 던진다(T1-49 보류). 사용자 안내는 오케스트레이터가 오류 코드를 보고 만든다 |
| 기억 자동 적용 vs 기준 4(수령인 변경 시 초기화) | 기억은 수령인이 정해진 뒤 별도 patch 요청으로만 적용하고, 항목마다 출처를 표시한다 |
| 공통 결과 보존 vs 턴 제한 추천 | 턴 제한 추천은 공통 `view` 결과를 그대로 반환한다(상태 불변). `plan.turnLimitReached`로 표시한다 |

## 해석기 옵션 (`createInterpreter`, `createPlannedAgent`·`createConfiguredAgent`도 같은 이름으로 전달)

| 옵션 | 기본값 | 설명 |
| --- | --- | --- |
| `llm` | 없음 | 없으면 규칙만 쓴다. 규칙으로 판단할 수 없는 발화는 `unresolved:true` + 질문 1개 |
| `mixedPolicy` | `'ask_first'` | `'apply_confirmed'`는 확정된 부분을 적용하고 질문한다 |
| `timeoutMs` | `8000` | 해석기 전체 제한. 넘으면 `LlmError('timeout')`을 던지고, 진단에 `timeoutSource`·`calls[].limit`을 남긴다 |
| `maxTokens` | `{extract: 1200, classify: 400}` | 숫자 하나나 `{extract, classify}`로 덮어쓴다 |
| `reasoning` | `{enabled: false}` | `null`이면 보내지 않는다. `{enabled}` → payload `reasoning`, `{effort}` → `reasoning_effort`(공통 클라이언트 31·32행) |
| `onStats` | 없음 | 호출마다 `{promptVersion, llmCalls, latencyMs, usage, timedOut, timeoutSource, path, claims, calls, skipped}`. 키·원문 응답 없음 |

**진단 `calls[]`**: 필드는 `stage`, `maxTokens`, `reasoning`, `errorCode`, `limit`(`interpreter`/`transport`), `completionTokens`, `validateCalled`, `rejectReason`, `clientStageFailure`·`note`, `latencyMs`다. 검증 전에 `invalid_response`가 나면 "끊김·빈 응답·JSON 파싱 가능성"으로만 표시하고 원인을 단정하지 않는다.

**최악의 대기 시간**: 기본 설정에서 약 8초다(해석기 제한이 공통 클라이언트의 18초보다 먼저 걸림). 오케스트레이터가 기억 적용이나 턴 제한으로 공통 `runTurn`을 한 번 더 부를 수 있지만, 그 호출은 LLM을 쓰지 않는다.

## 알려진 한계

- **짧은 답**: "응", "맞아"만으로는 직전 질문과 연결하지 못한다(T2-19). "응 엄마가 견과류 알레르기 있어"처럼 주어가 있으면 처리된다.
- **단맛**: 엔진에는 점수만 있고, 단맛을 강제로 제외하는 필터가 없다.
- **성분 범위**: `ALLERGEN_NAMES` 20개만 제외할 수 있다. 땅콩·호두·잣·견과류는 서로 다른 값이고, 상품명 기반 추정이라 성분표 확인 안내가 필요하다.
- **규칙 범위**: 한 절 안에서 인식한 표현만 claim이 된다. 정확도는 B층 평가(미실행)로 확인해야 한다.
- **이중부정의 안전한 누락**(R2, 바꾸지 않음): "엄마가 커피를 싫어하시는 건 아니야"처럼 이중부정이면 LLM 추출기가 claim을 0개로 줄 때가 있다(B층 2차에서 2회 중 1회). 이때 상태는 바뀌지 않고 일반 질문이 한 번 더 나온다.
- **시제·부정 표지가 있는 문장**: 문장 어디에든 표지(예전·요즘·였는데·없·괜찮·아니 등)가 있으면 규칙은 취향 claim을 확정하지 않고 문장 전체를 LLM에 맡긴다. 그래서 "엄마는 견과류 알레르기가 있고 예전엔 커피를 좋아하셨어"처럼 섞인 문장은 규칙만으로 읽을 수 있는 절도 LLM 판단을 거친다. 표지 목록에 없는 표현은 규칙·LLM 판단 비교(R1 일반 원칙)로 막는다.
- **기억 저장소**: 프로세스 메모리뿐이라 재시작하면 사라진다. 호스트가 `snapshot()`과 `facts` 옵션으로 저장·복원해야 한다. `recipientId` 발급은 호스트 몫이다.
- **동시성**: 버전 검사는 공통 코어 방식 그대로라, 원자적 저장(CAS)은 호스트 몫이다. 기억 적용·턴 제한 재실행은 같은 세션 버전 위에서 연달아 실행된다.
- **실제 LLM 검증 범위**: P1 문장 시험만 담당자가 실행했다. 6턴 실제 데모와 B층 평가는 아직 실행하지 않았다.

## 팀 결정이 필요한 항목

1. `mixedPolicy` 기본값과 수용 기준 3의 해석(부분 적용 허용 여부)
2. D8: 확정 조건 대기 보관과 짧은 답 연결(아래 메모)
3. 기억의 영속 저장소·`recipientId` 발급·보존 기간(`staleDays` 기본 180일은 임시값)과 사용자 동의 화면
4. 오류 안내 문구와 코드 분류(`invalid_response`·`provider_unavailable`을 "재시도"로 분류함)
5. 턴 제한 `maxTurns` 기본값 8(근거 없는 임시값). 대화가 잘 진행돼도 모든 턴을 세므로, 8턴 데모에서도 8턴째에 걸린다(데모는 10으로 지정). 미해결 질문만 세는 방식도 검토 필요
6. 앱 `/api/chat` 연결 방식과 `plan`·`explanation`을 화면에 보여주는 방식
7. LLM 응답 멈춤에 대한 재시도 정책: 2026-11-07 B층 평가에서 호출의 약 10%(39회 중 4회)가 해석기 제한 8초를 넘었고, 정상 응답은 최대 3.0초였다. 해석기는 재시도하지 않고 `timeout`을 던진다. 호스트 재시도 여부·횟수와 제한값은 `--timeout-ms` 측정 후 결정한다(`eval/results/2026-11-07T135005-analysis.md`)

## 설계 메모: 확정 조건 "대기" 보관(D8, 구현하지 않음)

`ask_first`에서 "엄마는 견과류 알레르기가 있고 단 건 별로야"처럼 확정된 조건(견과류)과 불명확한 조건이 섞이면, 지금은 아무것도 적용하지 않고 질문만 한다. 대안은 확정된 patch를 `plannerState.pending`에 보관했다가, 다음 턴 답이 오면 공통 `runTurn`의 `kind:'patch'` 요청으로 함께 적용하는 방식이다.
- 장점: 사용자가 견과류를 다시 말하지 않아도 된다. "응"·"맞아" 같은 짧은 답을 직전 질문과 연결할 수 있다(T2-19).
- 단점: 세션 밖(`plannerState`)에 조건이 남는다. 그 사이 수령인이 바뀌거나 버전이 올라가면 대기 patch가 낡는다. 답이 오지 않을 때 언제 버릴지 정해야 하고, 늦은 적용이 수용 기준 3과 맞는지 팀 확인이 필요하다.

## 진행 기록

- **P2 (2026-11-07)**: `planner.mjs`의 `createPlannedAgent`가 공통 `runTurn`을 감싸 `plan`을 덧붙인다. 반복 질문 방지, 턴 제한(필수 조건이 있을 때만 `view` 재실행 추천), LLM 오류를 호스트 안내로 바꿈(재시도 없음), 제3자 질문 템플릿을 넣었다.
- 미구현: T2-02(설명 요청 종류 없음), T2-18·T2-19(D8 대기 보관). 다음은 P3 설명.
- **P3 (2026-11-07)**: `explain.mjs`가 카드·엔진 재계산·`budgetAlternatives`만으로 이유·대조(점수→인기도→가격→id)·반사실((a)/(b)/(c))을 만든다. P2의 추천·비교 응답에 `explanation`으로 붙는다. 단맛 선호는 "덜 단 상품을 우선"으로 표현한다.
- 시드 고정 무작위 검사(300세트)로 제약과 설명 금액을 검증한다. 남은 일은 P4 기억이다.
- **P4 (2026-11-07)**: `memory.mjs`는 `recipientId`를 키로 쓰고, 저장은 제안 → 확인 두 단계다. 선물 지시("빼줘")는 사실이 아니라 저장하지 않는다. 적용은 대화당 1회 공통 patch 요청으로 하고, 현재 요청이 우선이며, 해석기가 질문 중이면 미룬다.
- 저장소는 프로세스 메모리뿐이라 영속 저장(DB)은 호스트 몫이다(`snapshot`·`facts`로 주고받음). 다음은 P5 조립과 데모다.
- **P5 (2026-11-07)**: `createConfiguredAgent`가 실제 LLM 해석기·플래너·설명·기억을 묶는다. 6턴 시나리오는 모의 전송기로 고정 검사하고(LLM 0회), 조립 경로의 오류 코드별 상태 보존도 검사한다.
- 남은 일: 담당자의 `live-demo.mjs` 실제 실행, B층 평가 실행, 팀 결정 항목 6개.
- **설명 보완 (2026-11-08)**: 점수를 수령인 그룹 적합과 말씀하신 선호로 나누고, 문장에서 내부 키를 빼서 `basis`·`case` 필드로 옮겼다. 조사는 받침에 따라 고르고, 비교 설명은 가정 예산임을 밝힌다. 데모에 분류 LLM이 필요한 7·8턴을 추가했다.
- 남은 일: 8턴 데모 실제 실행, `maxTurns` 기본값과 계산 방식은 팀 결정.
- **2026-11-08 (2)**: 8턴 실제 데모 결과를 기록했다(T6-09, LLM 2회·출력 34토큰). 선호가 없을 때 0점 문장에서 "말씀하신 선호"를 뺐다. 점수 내역은 대조 설명에만 쓰고, 후보가 1개면 이유에 쓴다.
- 평가 실행기 요약에 날짜·reasoning·출력 토큰·최대 지연을 추가했다. 다음은 B층 평가 실행(`--repeat 2`)이다.
- **2026-11-08 (3) B층 평가 후속**: 평가 결과와 분석을 `eval/results/`에 기록했다.
  - C1: LLM span은 가장 많이 겹치는 절로 주어를 판정하고, 가드 범위를 그 절로 한정했다. 다른 사람 주어만 있으면 recipient 답을 unknown으로 낮춘다(잘못된 확정 t-02 대응).
  - C2: 규칙이 읽은 절의 claim은 유지하고, 그 절과 겹치는 LLM claim은 버린다.
  - C3: 같은 span에 선호 claim과 `other`가 함께 나오면 `other`를 버린다.
  - C4: `--timeout-ms` 측정 옵션을 추가했다(기본 8초 유지).
  - 채점 S1~S4를 보완하고 t-03 라벨을 바꿨다(L1). 평가셋 변경 이력은 `eval/CHANGELOG.md`에 있다.
  - 남은 일: 같은 조건으로 B층을 다시 평가하고, C5(프롬프트 카테고리에 한국어 이름 병기)를 결정한다.
- **2026-11-08 (4) B층 2차 후속**: s-03 회귀(C2가 절 분리로 잘린 과거 표지를 놓침)를 고쳤다.
  - R1: 시제·부정 표지는 메시지 전체에서 확인한다(단맛 없는 같은 D4 표현은 제외하고 검사).
  - R1 일반 원칙: 규칙과 LLM이 같은 대상을 다르게 판단하면 어느 쪽도 확정하지 않고 "'…'는 지금도 받는 분께 해당하는 조건인가요?"로 묻는다.
  - 평가셋 기준 LLM 호출 수와 D4 처리는 변하지 않았다. 남은 일은 마지막 B층 평가다(잘못된 확정 0, giver 누출 0이면 마무리).

브랜치: `codex/architecture-c-attribution`. 공통 규칙은 [상위 안내](../README.md)를 따른다.
