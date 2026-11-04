# AGENTS.md — b-pipeline

Read docs/PRD.md and docs/TRD.md first. Build only what they describe.
Use mock or snapshot data. Ask me if anything is unclear.

## Commands (이 폴더 기준)
- `npm test` — b-pipeline 테스트
- `npm run test:all` — baseline 공통 테스트 + b-pipeline (완료 전 필수)
- `npm run check:scope` — 범위 밖 변경 확인 (커밋 전 필수)
- `npm run dev:server` — 로컬 서버, `npm run demo` — 공통 데모

## Decisions not in the code
- 작업 공간은 `baseline/agents/b-pipeline/`뿐이다. 밖의 파일은 읽기만 한다(공통 코어, 다른 설계 폴더, `mobile/`, `api/`, `supabase/` 포함).
- 순위·금액·예산 비교는 baseline `runTurn`과 공통 엔진만 계산한다. 직접 정렬하거나 점수를 바꾸지 않는다.
- 실험 조건 A/B는 ④ 설명 생성에만 들어간다. 조건 A의 Factsheet에는 대조·반사실·가격 옵션 키가 없다.
- 알레르기는 명시로만 생기고, 어떤 경로로도 줄어들지 않는다.
- `index.mjs`의 `interpretMessage`·`createAgent`는 유지한다. 키가 없을 때 기본 동작은 지금처럼 질문을 반환한다.
- 앱 UI는 `mobile/`을 `app/`으로 복사해 디자인을 그대로 쓴다. 바꾸는 것은 서비스 계층과 새 칩뿐이다.

## Rules
- 공통 코어 변경이 필요하면 직접 고치지 말고 `docs/decisions.md`에 요청으로 적는다.
- 새 의존성, 실험 설정값(`config/*.v1.json`) 확정, 비용이 드는 실제 LLM 호출은 먼저 묻는다.
- API 키를 코드·테스트·앱·로그에 쓰지 않는다. 사용자 원문 발화를 로그에 남기지 않는다.
- 테스트는 네트워크를 쓰지 않는다(`llm/fake.mjs`, 인메모리 DB).
- 완료라고 말하기 전에 `npm run test:all` 결과와 해당 AC 통과/실패 표를 보여준다.
- 단계마다 커밋 하나: `b-pipeline(P<n>): <요약>`. 커밋 전에 `npm run check:scope`.

## 단계 진행 자동화
- 승인한 계획은 `docs/PLAN.md`에 있다. `/clear` 후에도 이 파일로 이어간다.
- 사용자가 `/next-step`을 입력하면 다음 단계 하나를 구현 → 테스트 → `step-reviewer` 검토 → 커밋·푸시하고 **멈춰서 보고한다.** 다음 단계로 스스로 넘어가지 않는다.
