# Claude Code 실행 순서 — b-pipeline

## 0. 준비 (한 번)
```sh
git clone https://github.com/HanyangChan/PASS && cd PASS
git checkout -b codex/architecture-b-pipeline   # 팀 권장 브랜치. main에 직접 올릴지는 팀과 합의
# 이 묶음을 baseline/agents/b-pipeline/ 에 풀기 (기존 index.mjs는 유지됨)
cd baseline/agents/b-pipeline
npm run test:all          # 시작 전 공통 테스트 통과 확인
npm run check:scope       # 범위 가드 동작 확인
claude                    # 반드시 이 폴더에서 실행 → .claude/ 훅·권한·CLAUDE.md가 적용됨
```
`.env`는 직접 만든다(`cp .env.example .env` 후 값 입력). 키를 채팅에 붙여 넣지 않는다.

## 1. 첫 메시지 (Plan mode, Shift+Tab으로 전환)
```
AGENTS.md, docs/PRD.md, docs/TRD.md, docs/decisions.md를 끝까지 읽어줘.
그리고 ../../README.md, ../README.md, ../AGENTS.md, ../../docs/common-scope.md, ../../docs/acceptance.md와
../../src/index.mjs, ../../src/contracts.mjs, ../../tests/agents.test.mjs를 읽어서 공통 계약을 확인해.
질문은 최대 3개만 하고, TRD §2 구조대로 P0~P7 단계 계획을 써줘.
각 단계가 어떤 AC를 만족시키는지, 어떤 테스트로 확인하는지 적어줘. 코드는 아직 쓰지 마.
```
계획을 승인하기 전에 다음 네 가지를 확인한다.
- 모든 단계가 AC에 대응하는가
- Out of scope 항목이 끼어들지 않았는가
- b-pipeline 밖 파일을 수정하는 단계가 있는가
- 내가 말하지 않은 것(데이터, 색, 문구, 가중치)을 추측했는가

## 2. 단계별 메시지 (승인 후 Agent mode)
| 단계 | 보낼 메시지 |
|---|---|
| P0 | `P0: llm/(gemini·openai-compatible·fake), db/(schema.sql, node:sqlite store, 인메모리 store), data/ 카탈로그 스냅샷(+SHA-256)을 만들고 테스트까지 통과시킨 뒤 커밋해줘.` |
| P1 | `P1: memory/keys.mjs, memory/read.mjs, memory/write.mjs와 pipeline/merge.mjs를 만들어줘. TRD §5 쓰기 규칙 7개와 AC4·AC6·AC7·AC8·AC9를 테스트로 먼저 작성해.` |
| P2 | `P2: dialogue/agent.mjs와 rag/를 만들어줘. parseRules를 먼저 쓰고 남은 문장만 LLM. index.mjs의 interpretMessage를 이걸로 연결하되 키가 없으면 지금처럼 질문을 반환해야 해. 공통 테스트가 그대로 통과하는지 보여줘.` |
| P3 | `P3: pipeline/orchestrator.mjs와 createPipeline을 만들어줘. 기억 없는 경우 baseline runTurn과 결과가 같다는 테스트(AC1)와 카드가 설명보다 먼저 나오는 테스트(AC3)를 넣어.` |
| P4 | `P4: planner/(contrast, memory-cf, value-ladder, factsheet)를 만들어줘. 반사실 문장 상품 = 재계산 1위(AC10), 조건 A Factsheet에 키 없음(AC12), 상한 고정(AC14) 테스트 필수.` |
| P5 | `P5: explainer(템플릿 먼저, 그다음 LLM)와 verifier를 만들어줘. verifier를 먼저 만들고 템플릿이 100% 통과하는지 보여줘(AC11).` |
| P6 | `P6: server/index.mjs(SSE)를 만들고, ../../../mobile을 TRD §9 명령대로 app/에 복사해줘. 디자인 파일은 건드리지 말고 서비스 계층(pipelineChatService.ts)과 칩만 추가해. 끝나면 실행 화면 확인 방법을 알려줘.` |
| P7 | `P7: eval/simulator.mjs와 페르소나 2명으로 소규모 실행 계획을 세우고 예상 비용을 먼저 보여줘. 실제 호출은 내가 승인한 뒤에.` |

매 단계 끝에 요청할 것:
```
npm run test:all 결과와 이번 단계 AC의 통과/실패 표, 에이전트가 추측한 부분을 보여주고,
npm run check:scope가 통과하면 "b-pipeline(P<n>): …" 형식으로 커밋해줘.
```

## 3. 검토 (새 세션에서)
```
docs/PRD.md와 docs/TRD.md 기준으로 이 브랜치의 diff를 리뷰해줘. 스타일은 넘어가고 다음만 찾아줘:
AC 위반, Out of scope 추가, b-pipeline 밖 변경, 엔진 밖에서 순위를 바꾸는 코드,
조건 A에 대조·반사실이 새는 경로, 알레르기를 줄이는 경로, 키·원문 발화가 로그에 남는 곳.
```

## 4. 실패했을 때
"고쳐줘"를 반복하지 않는다. 되돌린 뒤(Esc 두 번) 아래 형식으로 다시 지시한다.
```
Where: (화면/파일)
Try: (한 일)
Expected: (PRD의 AC 번호와 기대 결과)
Actual: (실제 결과, 오류 메시지)
이 AC를 만족하도록 다시 만들어줘.
```

## 5. 푸시
```sh
npm run check:scope -- --push && git push -u origin codex/architecture-b-pipeline
```
훅이 `git push` 전에도 같은 검사를 실행한다. `b-pipeline/` 밖 변경이 하나라도 있으면 막힌다.
