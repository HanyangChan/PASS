# 구현 계획 (승인본) — `/next-step`이 읽는 파일

대화를 `/clear`해도 계획이 남도록 승인한 계획을 여기에 고정한다. 단계를 바꾸려면 이 파일을 먼저 고치고 decisions.md에 이유를 적는다.

진행 상황은 `git log --oneline`의 `b-pipeline(P<n>)` 커밋으로 판단한다. 가장 큰 n 다음 단계가 "다음 단계"다.

## 공통 절차 (모든 단계)
1. 이 단계의 테스트를 먼저 작성 → 구현.
2. `npm run test:all` 통과.
3. `step-reviewer` 서브에이전트 검토 → 지적 반영.
4. 추측한 부분은 decisions.md에 K번호로 기록.
5. `npm run check:scope` → 커밋 `b-pipeline(P<n>): <요약>` → `git push`.

## 승인 시 반영한 수정 (R)
- R1. app/ 복사본의 `../lib`·`../../lib`·`../../../lib` import와 `metro.config.js` watchFolders를 레포 루트 `lib/` 기준으로 고친다. 복사본 `package.json`의 `test:db`는 제거한다.
- R2. `sessions.state`는 baseline 상태만. 파이프라인 필드는 `sessions.meta` (K8).
- R3. `budget_cap`은 "올리기" 차단에만 쓴다. clamp·자동 채우기를 하지 않는다. 상한 초과 예산이나 예산 미입력은 질문(상한 금액 칩 제안).
- R4. 순서는 ① → ②·③ 병렬 (구조도의 '병렬' 표기는 정정).
- R5. 칩에서 알레르기를 지우면 memory_edit 경로 (P1 보완 참조).
- R6. 기억 반사실은 provenance가 기억뿐인 필드만 제거한다.
- R7. 금지어 검사는 상품명을 제외한다. 숫자 정규화에 "천 원"을 포함한다.
- R8. 통합 흐름은 S1 → purchased → end_session → confirm → S2. 상품 선택 시와 다음 세션 시작 시에도 memory_prompt를 보낸다.
- R9. S1은 recipients `['부모님']`, 기억 후보는 어머니·아버지 각각. 키가 없으면 S1이 불가함을 README에 적는다.
- R10. AC16은 규칙 경로만 실측한다. LLM 경로는 승인 후 실측.

## P1 보완 (P2 시작 시 먼저 처리)
- 선물 이력은 기본적으로 preferences에 넣지 않는다. 카드 표시와 반영 한 줄 근거로만 쓰고, 선호 반영은 사용자가 칩을 누를 때만 한다.
- suggested 신호의 세션 목록은 `signals` 컬럼(JSON)에 둔다. `evidence`는 사용자 문장만.
- 기억된 알레르기의 반대 진술은 "기억에서 삭제할까요?" memory_prompt로 연결한다.
- 세션에만 있는 알레르기는 확인 1회 후 해제할 수 있다.
- 어머니 → 부모님 전환 턴에 알레르기가 그룹 합집합으로 유지되는지 테스트한다.

## 단계
| 단계 | 내용 | AC | 주 테스트 | 모델 |
|---|---|---|---|---|
| P0 ✓ | llm/ · db/ · data/ · fixtures | (기반) | llm, store, data | Sonnet |
| P1 ✓ | memory/keys·read·write, pipeline/merge | AC4 6 7 8 9 | memory-*, merge | Sonnet |
| P2 ✓ | dialogue/agent(parseRules → LLM 1회), rag/index·agent, config/hobby-map.v1.json(초안, D5), index.mjs 연결(키 없으면 기존 질문 유지) | AC2 7 16(규칙) | dialogue, rag, index-contract + 공통 agents.test | Sonnet |
| P3 ✓ | pipeline/index(createPipeline), orchestrator(runPipelineTurn: 세션 DB 로드 → 의도 분기(message/patch/view/what_if_budget/feedback/memory_edit/end_session) → ① → ②③ → merge → runTurn(kind:'patch') → CAS 저장 → cards → explainCards(템플릿) → explanations / memory_prompt), memoryBanner, giftHistoryHit | AC1 2 3 5 6 9 | orchestrator(baseline deepEqual, 이벤트 순서, S1→S2 통합, stale) | **Opus** |
| P4 ✓ | planner/contrast, memory-cf(R6), value-ladder(budgetAlternatives·rankProducts·what_if, 상한 R3, 성향 이동), factsheet(조건 A 키 없음) | AC7 10 12 13 14 15 | planner | **Opus** |
| P5 ✓ | verifier(먼저) → explainer/template(100% 통과) → explainer/agent(LLM 1회 + 재생성 1회 → 템플릿), banned-words(R7), events 로깅(원문 없음) | AC3 7 11 12 14 | verifier, explainer, logging | **Opus** |
| P6 ✓ | server/index.mjs(node:http, SSE, 입력 검증), scripts/latency.mjs, app/ 복사(R1) + pipelineChatService.ts + 칩·반영 한 줄·기억할까요?·[수정]·참가자 ID | AC3 4 9 15 16 | server(핸들러 직접 호출) | Sonnet |
| P7 ✓ | **main 복사**: `proto/lib/`(테스트 제외)·`proto/api/worker.mjs`, `proto/UPSTREAM.md`(6beb5af, 파일별 SHA-256), `scripts/check-proto-sync.mjs`(proto·app 해시 vs 패치 목록, `npm test`에 포함), AC1 고정 테스트(`runTurn(engineState(s))` = main `recommendationView(s).result`). 기능 변경 없음 | AC1 | proto-sync, proto-parity | Sonnet |
| P8 ✓ | **① 교체**: `pipeline/turn.mjs` = proto `fastRuleTurn → llmTurn → singleTurn` → ② 기억(수령인 첫 지정·변경 시) → ③ → merge → runTurn → 계획기 → 템플릿 태그. 패치 L1(memory 후보)·L2(timeoutMs). orchestrator의 dialogue 호출을 이것으로 교체, 기존 의도 분기(feedback/memory_edit/end_session) 유지. llmTurn 테스트는 가짜 fetcher | AC2 4 5 6 7 8 | turn(여러 턴 짧은 답·대기 질문·수령인 전환·알레르기 보존·S1→S2), 기존 orchestrator 회귀 | **Opus** |
| P9 | **서버 계약**: `server/index.mjs`를 main worker와 같은 `/api/chat` JSON(operation turn/conditions/view) + `pipeline` 블록 + explain/feedback/memory/end_session로 교체. SSE 제거. `scripts/latency.mjs` 갱신 | AC3 9 11 12 16 | server(핸들러 직접 호출, main 응답 검증 함수 통과 확인) | Sonnet |
| P10 | **앱 정리**: 패치 A1~A4만 남기고 나머지는 main mobile/과 같게. `pipelineChatService.ts`·SSE 경로 삭제, `serverChatService` + 참가자 ID 스텁, 기기 기억 끄기 + PersonalizationPanel ↔ `operation=memory`, `PipelineExtras` 렌더. App.tsx main 대비 차이 30줄 이내 목표 | AC4 5 9 15 | app-service, proto-sync(app) | Sonnet |
| P11 | eval/simulator, personas 2명, metrics (+ 보류했던 사전 수정: 최종 선택 신호, 알레르기 삭제 재확인, "싼 거 말고" 부정, feedback version_conflict 재시도, `seed:demo`). 실제 LLM 실행 전 예상 호출·토큰 보고 후 승인 | 전체 회귀 | eval | Sonnet |

> P7~P10의 상세는 [PROTO-REBASE.md](PROTO-REBASE.md). 그 문서가 TRD §4·§9·§10을 대체한다(K55).
