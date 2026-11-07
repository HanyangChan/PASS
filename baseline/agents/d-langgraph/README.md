# LangGraph 작업 공간 (C + D)

받는 사람 정보 귀속(C, `../c-attribution`)과 자문 에이전트 4개(명절·기념일, 소비, 취향, 관계 예절)를 LangGraph 그래프로 묶었다. 설계는 [DESIGN.md](DESIGN.md)를 따른다.

```sh
# baseline/agents/d-langgraph 기준
npm install          # @langchain/langgraph 1.6.0, @langchain/core 1.3.4
npm test             # 이 폴더 테스트
npm run eval         # 합성 시나리오 평가 (eval/README.md)
```

이 폴더를 설치하지 않아도 `baseline/`의 공통 `npm test`는 통과한다. 그래프 테스트만 건너뛴다.

| 파일 | 역할 |
| --- | --- |
| `orchestrator.mjs` | 그래프: attribute(C) → 자문 4개 병렬(`Send`) → merge(병합·엔진 평가·제안 미리보기·기억 제안) |
| `advisors.mjs` | 규칙 자문 4개. 의견·제안·약한 자동 선호만 반환하고 순위는 계산하지 않음 |
| `tables.mjs` | 기념일·설·추석 날짜표, 관계 그룹표 (팀 검토용 초안) |
| `index.mjs` | 레지스트리용 `createAgent`(C 해석기 포트) + 지연 로딩 `runAgentTurn` |

```js
import { runAgentTurn } from './index.mjs';
const out = await runAgentTurn({
  session, request, products,                       // 공통 runTurn과 같은 계약
  context: { today: '2026-11-05', memory, purchases, calendar },
  disabled: ['taste'],                              // 사용자가 끈 에이전트
  llm,                                              // 선택: c-attribution/gemini.mjs
});
// out = 공통 runTurn 결과 + out.agents { attribution, opinions, suggestions, memoryProposals, autoApplied, trace }
```

공통 엔진·검증은 `src/index.mjs`의 `runTurn`을 그대로 쓴다. 사용자가 말한 조건만 세션에 저장하고, 취향 에이전트의 자동 선호는 평가용 복제본에만 적용한다. 브랜치: `codex/architecture-d-langgraph`.
