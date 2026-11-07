---
name: next-step
description: b-pipeline 구현 계획(docs/PLAN.md)의 다음 단계 하나를 구현·테스트·리뷰·커밋·푸시하고 멈춰서 보고한다. 사용자가 /next-step을 입력할 때만 실행한다.
disable-model-invocation: true
---

# /next-step — 다음 단계 하나를 끝까지

인자가 있으면 (예: `/next-step P3` 또는 추가 지시) 그것을 따른다. 없으면 아래 순서대로 진행한다.

## 0. 현재 위치 파악
1. `AGENTS.md`, `docs/PLAN.md`, `docs/PRD.md`, `docs/TRD.md`, `docs/decisions.md`를 읽는다. `data/` 카탈로그 JSON과 `app/` 전체는 통째로 읽지 않는다.
2. `git status`, `git log --oneline -10`으로 마지막 `b-pipeline(P<n>)` 커밋을 찾는다. 다음 단계는 P<n+1>이다.
3. 커밋되지 않은 변경이 있으면 멈추고 사용자에게 무엇인지 보고한다(이전 단계가 덜 끝났을 수 있음).
4. `git pull --rebase`로 원격 변경을 받는다.
5. PLAN의 "모델" 열이 Opus인데 현재 모델이 Sonnet이면, 시작하지 말고 "`/model opus`로 바꾼 뒤 다시 `/next-step`" 이라고 알리고 멈춘다. 반대로 Sonnet 단계인데 Opus면 그대로 진행하되 보고에 한 줄 적는다.

## 1. 구현
1. 해당 단계 행, R 항목, 보완 항목 중 이 단계에 해당하는 것을 목록으로 정리한다.
2. 테스트를 먼저 작성하고, 구현한다.
3. `npm run test:all`. 실패하면 고친다. 같은 실패를 2번 고쳐도 안 되면 멈추고 보고한다.

## 2. 독립 리뷰
1. `step-reviewer` 서브에이전트를 호출한다: "P<n+1> 검토. 기준 커밋 <직전 커밋 해시>. 아직 커밋 전 변경 포함."
2. [심각]·[보통] 지적을 반영하고 테스트를 다시 돌린다. 리뷰-수정은 최대 2회다. 남은 지적은 보고에 넣는다.
3. "사람 결정 필요" 항목은 구현자가 정하지 않는다. 기본값으로 진행할 수 있으면 기본값을 쓰고 보고에 넣고, 진행할 수 없으면 거기서 멈추고 묻는다.

## 3. 기록·커밋·푸시
1. 추측한 부분을 `docs/decisions.md`에 K번호로 적는다. 구현이 TRD와 달라졌으면 TRD도 고친다.
2. `docs/PLAN.md`의 해당 단계에 ✓ 표시.
3. `npm run check:scope` → `git add -A .` → `git commit -m "b-pipeline(P<n+1>): <요약>"` → `git push`.
   - 푸시가 거부되면 `git pull --rebase` 후 다시 푸시한다. force push는 하지 않는다.

## 4. 멈추고 보고 (다음 단계로 넘어가지 않는다)
아래 형식으로만, 짧게 보고한다.
```
P<n+1> 완료 — 커밋 <해시>, 푸시 완료
테스트: tests X / pass X / fail 0
AC: AC_ 통과, AC_ 통과 …
리뷰: 반영 N건 / 남은 지적: (없으면 "없음")
추측(K번호): 한 줄씩
사람 결정 필요: (없으면 "없음")
다음: P<n+2> (<모델>) — /clear 후 /next-step
```
