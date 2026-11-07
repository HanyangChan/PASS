# 조건 귀속

`attribute.mjs`는 문장 속 조건이 누구에게 해당하는지 판단하고 수령인의 조건만 반영합니다. `output.mjs`는 모델 출력 스키마와 귀속 결과 변환을 담당합니다. 채팅 B의 API 어댑터가 공유 Luna 전송을 사용해 규칙으로 이해하기 어려운 발화를 보완합니다.

저장소 루트에서 `node --test baseline/agents/c-attribution/tests/*.test.mjs`로 검증합니다.
