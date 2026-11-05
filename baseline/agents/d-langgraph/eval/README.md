# 합성 시나리오 평가

```sh
# baseline/agents/d-langgraph 기준
npm run eval                      # 기록된 Gemini 응답 재생 (네트워크·키 불필요)
GEMINI_MODEL=gemini-3.5-flash-lite node --env-file=<GEMINI_API_KEY가 든 .env> eval/run.mjs --live
                                  # 카세트에 없는 응답만 실제로 호출해 기록
```

- `scenarios.json`: 40개 단일 턴 시나리오(귀속 10, 안전 5, 명절 6, 소비 5, 취향 8, 관계 3, 일반 3). 정답은 `gold`에 있다.
- `cassette.json`: LLM이 필요한 4개 발화의 Gemini 응답(모델·프롬프트 버전 포함). 프롬프트 버전이 다르면 실행을 거부한다.
- `results.md`, `results.json`: 마지막 실행 결과.

조건 A는 지금 앱의 규칙 경로(발화 전체를 공통 `extract`로 해석, 귀속·자문 없음)다. C는 귀속만, D는 귀속 + 자문 4개, D−X는 자문 하나를 끈 것이다. 같은 카탈로그 스냅샷과 고정 날짜를 쓴다. 합성 시나리오라서 실제 사용자 만족이나 설명 효과를 입증하지는 않는다.
