# LangGraph 작업 공간

담당 범위: 감독·병렬 자문·비평과 종료 제어. 현재는 실행 가능한 시작 틀이며 해당 아키텍처나 실제 LLM 연동은 구현하지 않았다.

1. 이 폴더의 `index.mjs`에서 `interpretMessage`를 구현한다. 프롬프트·도구·내부 모듈도 이 폴더에 추가한다.
2. 출력 계약은 `{patch, questions: string[], unresolved: boolean}`이다. 미확정 조건은 `unresolved: true`와 질문으로 반환한다.
3. 자체 테스트는 이 폴더의 `tests/*.test.mjs`에 추가한다. `baseline/`에서 `npm test`를 실행하면 공통·개별 테스트를 함께 찾는다.
4. 전체 오케스트레이션을 구현할 때는 공통 엔진·검증·비교 계약을 재사용하고 추가 진입점을 문서화한다. 현재 연결기는 해석기 확장만 지원한다.

```sh
# baseline/ 기준
npm run demo:agent -- d-langgraph
```

브랜치: `codex/architecture-d-langgraph`. 공통 규칙은 [상위 안내](../README.md)를 따른다.
