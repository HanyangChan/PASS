# main 프로토타입 위에 에이전트 얹기 (P7~P11)

작성 2026-11-05 · 기준 main 커밋 `6beb5af` · 이 문서는 TRD §4(한 턴의 흐름), §9(앱), §10(서버 API)을 대체한다. 나머지 TRD(기억·설명 계획기·검증·LLM 어댑터·범위 가드)는 그대로다.

## 0. 왜 바꾸나
- P6까지는 앱 화면은 main 복사본이지만, 파이프라인 모드에서 **대화 이해(①)는 b-pipeline이 새로 만든 `dialogue/agent.mjs`(parseRules → LLM)** 를 썼다. App.tsx에 SSE용 병렬 경로(약 97줄)도 따로 있었다.
- main 챗봇은 여러 턴 대화(짧은 답 "네", 대기 중인 질문, 최근 6개 메시지)를 LLM 한 번으로 상태 전체를 갱신하는 방식이라 더 잘 동작한다.
- 그래서 **① 대화 이해와 앱↔서버 계약은 main 것을 그대로 쓰고**, b-pipeline은 그 앞뒤에 ② 기억, ③ 취향 매핑, 설명 계획기, ④ 설명, ⑤ 검증만 끼운다.
- main은 수정하지 않는다. main 파일은 `b-pipeline/proto/`로 복사해서 쓴다.

## 1. main 챗봇이 동작하는 방식 (6beb5af 기준)
```
앱 chat 화면 ──POST /api/chat {operation, session, text, history(≤6), source}──▶ api/worker.mjs
  operation=turn
    1) fastRuleTurn(input)     빠른 답 칩(quick_reply)이거나, 배송비 질문에 대한 네/아니 → 규칙으로 즉시 처리 (mode 'rules_fast')
    2) llmTurn(input)          GEMINI_API_KEY가 있으면 Gemini 1회: 최근 대화 + 대기 질문 + 현재 상태 → 상태 전체(JSON 스키마) + 질문
                               알레르기는 명시적으로 지우지 않는 한 유지, 18초 타임아웃, 5xx 1회 재시도 (mode 'llm')
                               실패하면 503 + 조건은 그대로
    3) singleTurn(input)       키가 없으면 conversation.mjs 규칙 대화 (mode 'rules')
    → finishSingle: 바뀐 조건 요약 메시지 + 다음 질문(nextQuestion)
  operation=conditions         조건 편집 칩/패널 → apply(patch) → finishSingle
  operation=view               현재 상태로 다시 계산
  응답 {session, message, mode, view:{question, result: recommend(), comparison: budgetAlternatives()}, catalog}
```
- 상태는 "한 개 선물" 모드다. 앱이 보는 공개 상태에는 `quantity/same_product/budget.scope`가 없고, 엔진에 넣을 때 `engineState`가 `quantity 1, per_set`을 채운다.
- 엔진 `lib/engine.mjs`는 baseline `src/vendor/engine.mjs`와 바이트 단위로 같다. 그래서 `engineState(공개 상태)`를 baseline `runTurn`에 넣으면 같은 상품·순위·금액이 나온다(AC1).
- 게스트(로그인 없음)는 같은 로직을 앱 안에서 돌린다(`chatService.ts`). 로그인하면 `serverChatService.ts`가 worker를 부른다.
- 수령인 기억은 지금 **기기 안(AsyncStorage)** 에 있다(`personalization.ts`, `docs/personalization.md`).
  - 저장은 사용자가 패널에서 직접 누를 때만 한다.
  - 기억은 수령인을 처음 정하거나 바꿀 때만 채운다.
  - 이번 말이 기억보다 우선하고, 알레르기는 계속 보호한다.
  - 만족한 구매 이력은 선호가 비어 있을 때만 카테고리 선호로 쓴다.
- 설명은 없다. 예산 비교(`comparison`)만 있다.

## 2. 바뀐 한 턴의 흐름
```
앱(main 화면 그대로) ──main과 같은 요청 + participant_id──▶ b-pipeline server (main worker와 같은 계약)
  0. 세션 메타 로드(DB)
  ① proto turn      fastRuleTurn → llmTurn(키 있음) → singleTurn       ← main 코드 그대로 (proto/lib)
                    llmTurn 스키마에 memory 후보 배열만 추가 (패치 L1)
  ② 기억 읽기       ①의 결과에서 수령인이 처음 정해졌거나 바뀌었으면 그 수령인의 기억을 채운다
                    (이번 말이 우선, 알레르기는 합집합, 출처는 meta.provenance) — main 패널 규칙과 같은 시점
  ③ 취향 매핑       기억 값 중 엔진 카테고리가 아닌 자유어만 hobby-map / RAG로 변환 (없으면 건너뜀)
  merge → engineState → baseline runTurn(kind:'patch') → 카드 (= main recommend와 같음)
  설명 계획기       contrast · memory-cf · value-ladder → factsheet (조건 A는 키 없음)
  ④ 설명(템플릿) + ⑤ 검증 → 응답에 바로 포함
  응답 = main 응답 그대로 + pipeline 블록 1개
       {session, message, mode, view, catalog,
        pipeline:{banner, tags{id:[…]}, contrast?, memory_cf?, ladder?, memory_prompt?, gift_history{id:…}}}
  operation=explain (선택) LLM이 다듬은 태그. 앱은 도착하면 태그만 교체 (카드가 먼저, AC3)
```
- SSE는 없앤다. 카드와 템플릿 태그가 한 응답에 같이 오고, LLM 설명은 후속 요청이라 AC3(카드 먼저)가 계약으로 보장된다.
- 대화 LLM은 턴마다 1회(llmTurn)다. 기억 후보도 같은 호출에서 받는다. 설명 LLM은 `operation=explain`일 때만 1회 + 재생성 1회다.
- 키가 없으면 main과 똑같이 규칙 대화다. S1은 키 없이 불가(R9 유지).

### 추가 operation (main 계약에 없는 것만)
| operation | 입력 | 하는 일 |
|---|---|---|
| `explain` | session_id, item_ids | ④ LLM 태그 → ⑤ 검증 → 실패 항목은 템플릿 |
| `feedback` | kind(`dismiss_one`·`dismiss_kind`·`ladder_save`·`ladder_compare`·`chosen`) | 기존 orchestrator 의도 그대로 |
| `memory` | action(`list`·`edit`·`delete`) | DB 기억 조회·수정·실제 삭제 (AC9) |
| `end_session` | accept(boolean) | "기억할까요?" 응답. 수락 시에만 저장 (AC4) |

## 3. 폴더
```
b-pipeline/
  proto/                 main 6beb5af 복사본. 직접 고치지 않고, 고친 줄은 패치 목록에만
    UPSTREAM.md          원본 커밋, 파일별 SHA-256, 적용한 패치 목록(L1~L3)
    lib/                 main lib/ 전체 (테스트 파일 제외)
    api/worker.mjs       참고·비교용 원본 (서버는 server/에서 같은 계약을 구현)
  server/index.mjs       node:http, main worker와 같은 /api/chat JSON 계약 + pipeline 블록 + 추가 operation
  pipeline/turn.mjs      위 2절 흐름 (orchestrator의 ① 부분을 proto turn으로 교체)
  app/                   main mobile/ 복사본 (이미 있음). 패치 A1~A4만
  dialogue/agent.mjs     index.mjs 계약(interpretMessage)용으로만 남김. 파이프라인은 쓰지 않음
```
- **테스트 파일은 복사하지 않는다.** baseline `node --test`는 하위 폴더 전체를 찾으므로 `*.test.*`, `test-*.mjs`, `test/` 폴더가 들어오면 팀 공통 테스트가 main 테스트를 돌리게 된다. (`lib/test-dialogues.json`은 .json이라 괜찮다.)
- `scripts/check-proto-sync.mjs`: `proto/`와 `app/`의 각 파일이 UPSTREAM.md의 해시와 같은지, 다르면 패치 목록에 있는지 확인. `npm test`에 포함.

## 4. main 복사본에 허용하는 패치 (이 목록 밖은 고치지 않는다)
| # | 파일 | 패치 | 이유 |
|---|---|---|---|
| L1 | proto/lib/llm.mjs | `extractionSchema`에 선택 필드 `memory:[{recipient, key, value, evidence}]`와 지시문 한 줄 추가. `validate`가 이 필드를 상태와 분리해 반환 | 기억 후보를 같은 LLM 호출에서 받기 (호출 추가 없음) |
| L2 | proto/lib/llm.mjs | 타임아웃을 옵션 `timeoutMs`로(기본 18000 유지), `thinkingConfig` 미지원 400이면 빼고 재시도 | `DIALOGUE_LLM_TIMEOUT_MS`, AC16 |
| L3 | proto/lib/llm.mjs | 모델 기본값은 호출 측이 `GEMINI_MODEL`로 넘김(파일 수정 없음, 서버에서 처리) | `-latest` 별칭 404 |
| A1 | app/ import 경로 | 레포 루트 `lib/` → `../proto/lib/` | main이 바뀌어도 실험 앱이 고정 |
| A2 | app/src/services/serverChatService.ts | `resolveChatUrl`이 `EXPO_PUBLIC_PIPELINE_URL`을 받고, Supabase 세션 대신 참가자 ID 인증 스텁. 응답 검증은 main 그대로 + `pipeline` 블록 선택 검증(`pipelineEvents.mjs`) | 앱의 기존 서버 경로를 그대로 사용 |
| A3 | app/src/services/personalization.ts 호출부 | 파이프라인 모드에서는 기기 안 기억 적용(`personalizeSession`)을 끄고, PersonalizationPanel 목록·삭제를 `operation=memory`로 연결 | 기억을 두 번 적용하지 않기 (서버 DB가 기억의 단일 출처) |
| A4 | App.tsx · results 카드 | `PipelineExtras`(반영 한 줄 [수정], 이유 태그, 대조 칩, 기억 반사실 줄, 아끼기/올리기 칩, 기억할까요? 시트)를 기존 카드 아래에 렌더 | 새 UI는 칩뿐 |
- App.tsx의 SSE용 병렬 경로와 `pipelineChatService.ts`는 지운다. 파이프라인 모드도 main의 `serverChatService` 경로를 탄다. 목표는 App.tsx의 main 대비 차이를 30줄 안쪽으로 줄이는 것이다.

## 5. 그대로 재사용하는 b-pipeline 부품
db/ · memory/(keys·read·write) · pipeline/merge · planner/(contrast·memory-cf·value-ladder·factsheet) · explainer/ · verifier/ · llm/(설명용) · rag/(선택) · 이벤트 로그(원문 없음) · 범위 가드

## 6. AC 영향
- AC1: `runTurn(engineState(s))` 카드 = main `recommendationView(s).result` 카드를 고정 테스트로 확인.
- AC2: main `nextQuestion`의 질문 하나를 그대로 쓴다.
- AC3: 카드·템플릿 태그가 한 응답에 같이 온다. LLM 태그는 후속 `explain` 응답이다.
- AC7: llmTurn의 알레르기 보존 + merge 합집합 + ⑤ 검증 3중.
- AC16: 규칙 경로(fastRuleTurn·singleTurn)는 1초, LLM 경로는 llmTurn 1회 실측 후 판단. 실측 전에는 미확인으로 표시한다.
- 나머지 AC는 그대로 유지한다.

## 7. 하지 않는 것
- main(레포 루트 `lib/`·`api/`·`mobile/`) 수정, main 테스트 복사, Supabase 연결(실험은 참가자 ID + 로컬 SQLite), 배포.
