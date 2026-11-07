# 합성 시나리오 평가

```sh
# baseline/agents/d-langgraph 기준
npm run eval                                   # Gemini 기록 재생 (네트워크·키 불필요)
LLM_PROVIDER=deepseek node eval/run.mjs        # DeepSeek 기록 재생
# 카세트에 없는 응답만 실제로 호출해 기록
LLM_PROVIDER=deepseek node --env-file=../../../api/.dev.vars eval/run.mjs --live
GEMINI_MODEL=gemini-3.5-flash-lite node --env-file=<GEMINI_API_KEY가 든 .env> eval/run.mjs --live
```

- `scenarios.json`: 40개 단일 턴 시나리오(귀속 10, 안전 5, 명절 6, 소비 5, 취향 8, 관계 3, 일반 3). 정답은 `gold`에 있다.
- `cassette.json`(Gemini), `cassette-deepseek.json`(DeepSeek): LLM이 필요한 4개 발화의 응답과 모델·프롬프트 버전. 프롬프트 버전이 다르면 실행을 거부한다.
- `results.md`/`results-deepseek.md`(+ `.json`): 마지막 실행 결과. 프롬프트 v3 기준 두 모델 모두 A·C·D 수치가 같다.

## 모델 선택과 안정성

**DeepSeek (기본, 2026-11-06).** 한양대 AI부트캠프 프록시(`https://llm.ai.hy.miwork.ai/v1`, OpenAI 호환)의 `deepseek-v4-flash`. 이 모델은 답하기 전에 생각(reasoning)부터 하는데, 출력 상한 800토큰을 생각에 다 쓰고 빈 답을 내는 일이 있었다(8문장×3회 중 4회). 그래서 프록시를 쓸 때는 `reasoning: {enabled: false}`를 보낸다.

| 설정 | 정답 | 실패 | 흔들린 문장 | 응답 시간 중앙값 / p95 / 최대 |
| --- | --- | --- | --- | --- |
| 생각 켬, 상한 800 | 20/24 | 4 (빈 답) | 1/8 | 1.8 / 3.3 / 3.5초 |
| 생각 끔 (v2 프롬프트) | 21/24 | 1 | 1/8 | 0.7 / 1.3 / 1.8초 |
| 생각 조금(low), 상한 2500 | 22/24 | 1 (시간 초과) | 2/8 | 1.6 / 5.0 / 6.5초 |
| **생각 끔 + v3 프롬프트** | **24/24** | **0** | **0/8** | **0.65 / 1.3 / 1.7초** |

8문장은 평가의 4개 발화와 새 표현 4개(등산, 커피 끊음, 꽃·화분, "나는 단 걸 좋아하는데 동료는 요리"). v3 프롬프트는 "단 거 안 좋아함"을 과자 제외가 아니라 덜 단 것으로 읽도록 예시를 더했고, `question`이 빠진 응답도 받는다(항목 값 검증은 그대로).

**Gemini (2026-11-05, 무료 할당량 키).** `gemini-3.6-flash`는 429·시간 초과가 잦아(12회 중 6회) `gemini-3.5-flash-lite`를 택했다(응답 10/10 정답, 시간 초과 2/12, 중앙값 2.6초). 같은 4개 발화를 3회씩 반복했을 때 응답 내용은 모두 같았다.

어느 모델이든 실패하거나 시간이 넘으면 조건을 바꾸지 않고 질문한다(`provider: 'llm_failed'`). 표본이 작아 모델 품질을 일반화하지 않는다.

조건 A는 지금 앱의 규칙 경로(발화 전체를 공통 `extract`로 해석, 귀속·자문 없음)다. C는 귀속만, D는 귀속 + 자문 4개, D−X는 자문 하나를 끈 것이다. 같은 카탈로그 스냅샷과 고정 날짜를 쓴다. 합성 시나리오라서 실제 사용자 만족이나 설명 효과를 입증하지는 않는다.
