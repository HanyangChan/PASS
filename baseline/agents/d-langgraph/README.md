# LangGraph 귀속·자문

채팅 슬라이더의 B(`langgraph-advisors`)는 수령인 귀속 판단에 이어 명절·기념일, 소비, 취향, 관계의 규칙 자문을 병렬 실행합니다. 그래프의 진입점은 `runAgentTurn`이며 API에서 요청별로 선택합니다. 자동 선호는 평가용 복제 상태에만 추가합니다. 조건·가격·순위는 공통 엔진을 사용합니다.

저장소 루트에서 `npm run setup`으로 그래프를 설치합니다. 전용 검증은 `npm --prefix baseline/agents/d-langgraph test`입니다. 모델 호출이 필요한 귀속은 서버의 공유 LLM 전송을 사용합니다. [API 실행과 모드 선택](../../../api/README.md#채팅-화면의-abcd-선택)

합성 시나리오는 `npm --prefix baseline/agents/d-langgraph run eval`로 실행합니다. 기억·구매 이력을 사용하는 그래프 동작은 [합성 평가](eval/README.md)에서 재현할 수 있습니다. [로컬 웹 데모](e2e/README.md)에서는 채팅에 연결된 네 모드를 시험할 수 있습니다.
