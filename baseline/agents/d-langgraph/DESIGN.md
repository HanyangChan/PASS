# C + D: 귀속 에이전트와 LangGraph 자문단

작성일: 2026-11-05 · 브랜치: `codex/architecture-d-langgraph` · 범위: 기말 데모(실제 앱) + 합성 시나리오 평가

## 목표

여러 에이전트가 각자 관점에서 선물 조건을 거들고, 그 근거를 사용자에게 보여주고 끄고 켤 수 있게 한다.

- **C 받는 사람 정보(귀속):** 발화의 조건마다 주인(주는 사람 / 받는 사람 / 불분명)을 붙인다.
- **D 자문단:** 명절·기념일, 소비, 취향, 관계 예절 에이전트가 의견(신호)을 내고, 감독 그래프가 합친다.

HCI 관점의 질문은 두 가지다. "시스템이 누구의 조건인지 제대로 이해하는가", "에이전트별 근거를 보여주고 통제하게 하면 이해와 통제감이 생기는가". 기존 A/B 설명 스터디와는 섞지 않는다. 앱에서는 플래그를 켰을 때만 동작한다.

## 고정 원칙 (공통 베이스라인 준수)

1. 상품·순위·금액은 공통 엔진(`baseline/src/vendor`)만 계산한다. 에이전트는 엔진을 바꾸지 않는다.
2. 에이전트 의견은 기존 조건 형식으로만 엔진에 전달한다.
3. 예산·배송 마감·포장 같은 강한 조건은 임의로 확정하지 않는다. 제안 칩으로 보여주고 사용자가 적용한다(수용 기준 2).
4. 안전 관련 조건(알레르기)의 주인이 불분명하면 추천하지 않고 질문한다.
5. 턴당 LLM 호출은 최대 1회(C의 귀속 해석)다. 규칙으로 처리된 발화, 토글, 칩 적용은 0회다.
6. 의견마다 근거와 출처(발화, 기억, 구매 이력, 캘린더, 표)를 붙인다.

## 구조

```
요청 → attribute(C) ─┬─ 질문 필요 → 응답(질문)
                     └─ advise: occasion ∥ spending ∥ taste ∥ relationship  (LangGraph Send)
                          → merge → engine(공통 runTurn) → 응답(추천 + 의견 + 제안 + 기억 카드)
```

| 노드 | 파일 | 역할 |
|---|---|---|
| attribute | `../c-attribution/attribute.mjs` | 공통 규칙 파서 → 절 단위 귀속 규칙(공통 `extract` 재사용) → 필요할 때만 Gemini 1회 |
| occasion | `advisors.mjs` | 고정 기념일 + 설·추석 표 + 사용자 캘린더. 마감일·격식 포장 제안 |
| spending | `advisors.mjs` | 같은 받는 사람의 구매 금액 범위. 예산 미정이면 예산 제안 |
| taste | `advisors.mjs` | 확정 기억 + 만족한 구매 카테고리. 선호 카테고리는 자동 반영 |
| relationship | `advisors.mjs` | 관계 그룹별 무난한 품목(엔진의 +1 근거 설명), 사적인 품목 제외 제안 |
| merge | `orchestrator.mjs` | 의견 → 자동 반영 / 제안 칩 / 질문. 자동 반영은 평가용 복제본에만 적용 |

### 자동 반영은 세션에 저장하지 않는다

사용자가 말한 조건만 공통 `runTurn({kind:'patch'})`로 세션에 저장한다(버전 증가). 취향 에이전트의 자동 선호는 세션 복제본에서만 적용해 추천을 계산한다. 그래서 토글을 끄면 저장된 조건은 그대로 두고 바로 재계산할 수 있다. 반환하는 `evaluatedState`는 실제로 추천에 쓴 조건이다.

### 병합 우선순위

이번 발화 > 확정 기억 > 에이전트 의견.
- 이번 턴에 사용자가 선호 카테고리를 말했으면 취향 자동 반영은 하지 않는다. 의견 패널에 "이번 말씀 우선"을 표시한다.
- 사용자가 제외한 카테고리는 자동 반영하지 않는다.
- 주는 사람(`giver`) 조건은 반영하지 않고 "나 (미반영)"으로 표시한다.
- 주인이 불분명한 취향은 반영하지 않는다. 주인이 불분명한 알레르기는 질문한다.

## 계약

```js
runAgentTurn({
  session, request, products,          // 공통 runTurn과 같음
  context: { today: 'YYYY-MM-DD', memory, purchases, calendar }, // 현재 받는 사람 것만
  disabled: ['taste', ...],            // 끈 에이전트
  llm,                                 // 선택: ({text,state}) → 귀속 후보 (Gemini)
}) → { ...runTurn 결과, agents: { attribution, opinions, suggestions, memoryProposals, trace } }
```

- `opinions[]`: `{agent, id, text, source, enabled, effect: 'auto'|'suggest'|'info'}`
- `suggestions[]`: `{agent, id, label, patch, preview: {candidates, top}}`. `preview`는 엔진 계산 결과다.
- `memoryProposals[]`: `{recipient, preferences, excluded_categories, excluded_ingredients}`. 받는 사람의 것으로 판단되고 사용자가 이번에 직접 말한 것만 담는다.

## 앱 연결

- Worker: `AGENTS_MODE=on` 환경 변수가 있고 요청에 `agents.enabled`가 있을 때만 그래프를 실행한다. 응답은 기존 형식에 `mode:'agents'`와 `agents` 필드를 덧붙인다.
- 앱: 로그인한 서버 경로에서 현재 받는 사람의 기억·구매·60일 내 캘린더를 함께 보낸다. 화면에는 주인 표시, 의견 패널(토글), 제안 칩, 기억 카드를 둔다.
- 개인정보: 기억·구매·캘린더는 기기에 저장한다. 서버는 저장하지 않는다. Gemini에는 이번 발화와 현재 조건만 보낸다.

## 평가

`eval/scenarios.json`의 합성 시나리오를 같은 카탈로그 스냅샷(`supabase/seed/products-amazon.json`), 고정 날짜로 돌린다.

| 조건 | 내용 |
|---|---|
| A | 규칙만: 발화 전체를 공통 `extract`로 해석, 귀속·자문 없음 |
| C | 귀속 추가 |
| D | 귀속 + 자문 4개 |
| D−X | 자문 하나씩 제거 |

| 지표 | 목표 |
|---|---|
| 필수 조건 위반 | 0 (필수) |
| 주는 사람 조건이 필터에 들어간 수 | 0 (필수) |
| 귀속 정확도 | C ≥ 90% |
| 숨은 취향의 상위 3개 포함률 | D > C > A |
| 질문해야 할 때 질문한 비율 | 100% |
| 근거가 붙은 의견 비율 | 100% |
| 턴당 LLM 호출 | ≤ 1 |

LLM이 필요한 시나리오는 Gemini 응답을 `eval/cassette.json`에 기록해 재생한다. 테스트와 기본 평가는 네트워크 없이 돌아간다.

## 하지 않는 것

주는 사람 성향·비평 에이전트, LangGraph `interrupt`·체크포인트(요청 하나가 턴 하나라 불필요), 서버 측 장기 기억 저장, 공휴일 API 실시간 조회(표로 대체, 2026–2028 설·추석은 `korean-lunar-calendar`로 계산해 고정).
