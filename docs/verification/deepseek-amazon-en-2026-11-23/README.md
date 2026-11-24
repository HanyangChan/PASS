# PASS 영문 Amazon 실험 작업 기록

PASS의 A/B/C가 영문 상품을 추천하는 정확도, 알레르기 제외 조건 처리, API 응답 시간, 모델 사용 비용을 비교했다. 수정본에서 DeepSeek V4 Flash로 측정한 결과를 보존한다. 같은 기준에서 B와 C의 추천 성과는 같았고, B의 응답 시간과 비용이 더 낮았다. [수정 후 전체 결과](comparison.md)

## 작업 흐름

| 단계 | 진행 내용 |
|---|---|
| 계획 수립 | 사용자 요청은 한국어, 상품명은 Amazon 영어 원문으로 고정했다. 정확 상품은 정답 ASIN, 일반 추천은 요청 조건에 맞는 카드, 알레르기는 조건 반영과 카드 보류로 평가하기로 했다. |
| 카탈로그 준비 | 공개 Kaggle ZIP을 검증했다. 집계 CSV 551,585행에서 유효한 중복 제거 상품 454,562개를 확인하고, 원본 대분류 비율을 유지해 고정 시드로 300,000개를 선택했다. PASS 분류에 대응하지 않는 상품 165,011개는 `unmapped`로 표시했다. |
| 파일럿과 실행기 | 파일럿 24개를 작성하고 합성 모델로 API 연결을 확인했다. 이후 DeepSeek V4 Flash와 GPT-5.6 Luna의 A/B/C를 실호출하며 세션과 추천 카드, HTTP 상태, 지연, 토큰 사용량을 기록했다. 사용자 제공 단가를 비용 추정에 적용했다. |
| 본실험 입력 확정 | 파일럿과 다른 요청으로 정확 상품, 일반 추천, 알레르기, 다중 턴을 각 30개씩 구성했다. DeepSeek A/B/C와 Luna A, B, C 순으로 기존 동작을 재현했다. |
| 원인 확인 | C에서 단계별 검토와 수정이 이어지면 공통 호출 한도를 소진하거나 같은 동작으로 되돌아갈 수 있었다. 한도·반복 종료에서 이미 계산한 추천을 버리는 동작을 모의 입력으로 재현했다. B/C가 사용하던 검색 동작은 일반 조건 조회였고, 이름이나 ASIN으로 특정 상품을 좁히는 경로가 필요했다. |
| B/C 수정 | 간단한 요청은 검증된 도구 결과가 나오면 응답을 마친다. C의 검토는 조건 변경과 확인 질문 등 판단이 필요한 동작에 집중한다. 앱에서 응답을 중지하면 진행 중인 호출을 취소하고 작성한 입력을 복원한다. 명시적인 종료 요청은 모델 없이 처리한다. 잘못된 모델 응답이나 조건 변경 후보는 한 번 교정하고, 복구 가능한 장애는 기존 상태를 보존한 채 채팅 안내로 반환한다. |
| 추가 오류 수정 | B/C에서 ASIN·상품명·모델명으로 고유하게 식별된 상품만 좁혀서 조회한다. 여러 후보가 나오면 추가 단서를 묻는다. 성분 미상이나 일부만 반영된 알레르기 요청은 카드 없이 성분 확인을 먼저 한다. 단일 선물 범위를 넘는 합산 수량에는 제한을 안내한다. 설문 주소의 잘못된 모드와 선택 전 실행을 차단했다. |
| 채점과 재검증 | 카드와 세션의 적용 조건을 함께 확인하고, 질문이나 재시도 안내는 추천 성공에서 제외했다. 미지원 복수 수량은 별도 집계했다. 새 실행 기록에 동작·검토 판정·적용 조건·소스 해시를 추가했다. API, 에이전트, 모바일 테스트와 타입 검사, 린트를 확인했다. |
| 수정 후 본실험 | 2026-11-23 KST에 DeepSeek B/C를 먼저 실행한 뒤 A를 같은 소스와 채점 기준으로 실행했다. 총 1,080회, API 요청 1,350건이다. |
| GitHub 정리 | 기존 원격 브랜치 35개를 정리하고, `main`에서 직접 추적되지 않는 브랜치 팁 13개를 `archive/branches/…` 태그에 보존했다. 수정 코드는 `codex/pass-deepseek-bc-reliability`의 커밋 `52736b2`에 게시했다. |
| 실험 브랜치 이름 변경 | 전체 비교 실험을 반영해 `codex/pass-amazon-en-abc-benchmark`로 이름을 바꿨다. |
| GPT-5.6 Luna 수정 후 실험 | 같은 120개 시나리오와 채점 버전 2로 A/B의 실행 순서를 번갈아 총 720회를 순차 실행했다. 성분 미상 27건에서 A는 카드 27건, B는 카드 0건을 반환했다. [수정 후 GPT A/B 결과](../gpt-luna-amazon-en-2026-11-23/comparison.md) |
| GPT-5.6 Luna B 개선 및 재실험 | 모델 번호 조회와 명시 조건 처리를 보강하고 동일한 조건의 추천 결과를 재사용했다. 상품 조회·모델 호출·순위 계산·응답 구성 시간을 기록했다. 기존 120개 시나리오로 개선 B를 360회 실행했다. [B 전후 비교](../gpt-luna-b-upgrade-2026-11-24/before-after.md) |
| DeepSeek V4 Flash A 개선 및 재실험 | 명확한 조건과 ASIN 조회를 규칙으로 처리하고, 모델 해석은 변경 필드만 받도록 줄였다. 최종 추천을 재사용하고 성분 확인이 필요하면 카드를 보류했다. 기존 120개 시나리오로 개선 A를 360회 실행했다. [A 전후 비교](../deepseek-a-upgrade-2026-11-24/before-after.md) |
| DeepSeek V4 Flash B/C 개선 및 재실험 | B의 상품군 전환과 조건 보존을 보강하고, C는 서버가 확인할 수 있는 단순 변경의 검토를 생략하도록 했다. 같은 120개 시나리오를 B와 C에서 각각 3회씩 번갈아 실행했다. [A/B/C 전후 비교](../deepseek-abc-upgrade-2026-11-24/before-after.md) |
| GPT-5.6 Luna 전체 재실험 | 최신 A/B/C를 동일 세션에서 번갈아 실행했다. 총 1,080회, API 요청 1,350건이다. 이전 GPT A/B 및 같은 시나리오의 최신 DeepSeek 결과와 비교했다. [GPT A/B/C 전체 비교](../gpt-luna-abc-2026-11-24/abc-comparison.md) |
| DeepSeek·GPT C 정확 상품 개선 | C에서 상품명과 모델 번호를 확인하는 경로를 확대하고, 명확한 일반 추천 조건을 서버에서 바로 적용했다. 같은 120개 시나리오에서 모델별로 360회 검증했다. [C 모델별 전후 비교](../c-quality-2026-11-24/c-comparison.md) |
| DeepSeek·GPT C 결과 검증 | C의 최종 응답에 요청 조건 검증과 상품 근거 검증을 순서대로 적용했다. 두 모델을 각각 360회 재실험해 정확도, 비용과 응답 시간을 기존 A/B 기록과 비교했다. [C 결과 검증 비교](../c-result-audit-2026-11-24/c-comparison.md) |

## 평가 조건

- **A/B/C 진입점**은 각각 `a-router`, `full-chat`, `full-chat-feedback-2`다. 모델은 `deepseek-v4-flash`로 고정했다. A는 `single` 해석 모드, 모델 추론 옵션은 `false`였다.
- **요청 120개를 모드별로 3회** 실행했다. 재시도와 호출 제한을 포함한 실제 응답을 기록했다. 일반 추천은 카드 조건과 세션의 예산·배송비·요청 납기가 충족될 때 성공으로 계산했다. 정확 상품은 확인 질문 없이 반환된 카드의 ASIN을 비교했다.
- 카탈로그는 Amazon 영어 원문을 사용했다. 배송비·도착일·재고·포장은 PASS의 합성 규칙을 적용했다. 상품의 실제 성분 판단은 제조사 근거를 확보한 4개 ASIN에 한정했다. [카탈로그 출처](https://www.kaggle.com/datasets/lokeshparab/amazon-products-dataset)
- 지연은 로컬 Worker 처리와 모델 왕복을 포함한 API 응답 시간이다. 합성 인증·세션을 사용했고 원격 DB와 UI는 측정 범위 밖이다. A와 B/C는 다른 시간대에 순차 실행했다.

## 자료

- [수정 후 A/B/C 통합 결과](comparison.md)
- [수정 후 A 실행별 기록](a/runs.jsonl)과 [집계](a/progress.json)
- [수정 후 B/C 실행별 기록](bc/runs.jsonl)과 [집계](bc/progress.json)
- [수정 후 GPT-5.6 Luna A/B 결과](../gpt-luna-amazon-en-2026-11-23/comparison.md)
- [GPT-5.6 Luna B 업그레이드 전후 비교](../gpt-luna-b-upgrade-2026-11-24/before-after.md)
- [DeepSeek V4 Flash A 업그레이드 전후 비교](../deepseek-a-upgrade-2026-11-24/before-after.md)
- [DeepSeek V4 Flash A/B/C 개선 전후 비교](../deepseek-abc-upgrade-2026-11-24/before-after.md)
- [GPT-5.6 Luna A/B/C 전체 비교](../gpt-luna-abc-2026-11-24/abc-comparison.md)
- [DeepSeek·GPT C 정확 상품과 일반 추천 개선](../c-quality-2026-11-24/c-comparison.md)
- [DeepSeek·GPT C 결과 검증과 A/B/C 비교](../c-result-audit-2026-11-24/c-comparison.md)
- [고정 시나리오](../../../api/benchmarks/amazon-en/fixtures.mjs)와 [재현 방법](../../../api/benchmarks/amazon-en/README.md)
- [B 동작](../../../baseline/agents/full-chat/index.mjs), [C 검토](../../../baseline/agents/full-chat-feedback/index.mjs), [상품 조회](../../../api/catalog-item-lookup.mjs), [API 응답 처리](../../../api/full-chat-agent.mjs)

실행별 기록은 합성 입력, 응답, 카드 ID, 카탈로그 해시, 토큰 사용량을 담는다. 원본 카탈로그 ZIP과 API 환경 설정은 로컬 자료다. 보관본 헤더에는 원래 실행 서명을 `sourceRunSignature`로 남겼고, 로컬 경로를 빼고 보관본 서명을 계산했다.
