# PASS (Personalized AI Shopping System)

Session-based personalized recommendation chatbot with contrastive and budget counterfactual explanations.

한국어 명절 선물 대화에서 예산·수량·선호·제외 조건을 갱신하고, 변경 내역·추천 상품·가상 예산 비교를 함께 표시하는 연구용 프로토타입입니다.

## 데모

[명절 선물 추천 데모](https://myeongjeol-gift-lab.hwangma.chatgpt.site/) — 현재 소유자 전용 접근입니다.

## 실행

Node.js 22.13 이상이 필요합니다.

```sh
npm ci
npm run dev
```

터미널에 표시되는 로컬 주소로 접속합니다.

```sh
node --test tests/*.test.mjs
npm run build
```

## 구현 범위

- 세션 내 조건 추출·유지·변경·해제
- 세트당/총예산, 배송비, 수량, 제외 상품군, 배송 기한 필터
- 상품 속성에 기반한 추천 카드 최대 3개
- 직전 턴 대비 조건 변경 표시 및 표시 켜기/끄기
- “다른 조건이었다면?”: 예산만 변경한 가상 결과와 현재 추천 비교
- 후보 확대와 실제 추천 변경 구분, 비교 예산을 명시적으로 적용
- 가상 상품 30개, 테스트 대화 10개·30턴

현재 자연어 처리는 **규칙 기반**입니다. LLM API와 벡터 검색은 아직 연결하지 않았으며, 예시 이외의 자유로운 한국어 전반의 정확도를 보장하지 않습니다. 모든 상품·가격·배송일·브랜드는 합성 데이터입니다. 실제 구매를 제공하지 않습니다. 대화는 브라우저 메모리에만 유지됩니다.

## 구조

- `app/page.tsx`: 채팅·조건 패널·추천 카드
- `app/globals.css`: 반응형 화면 스타일
- `lib/engine.mjs`: 조건 추출, 상태 갱신, 차이 계산, 추천
- `lib/counterfactual.mjs`: 가상 예산 검색과 근거 생성
- `app/counterfactual-panel.tsx`: 비교 카드와 예산 적용
- `lib/products.json`: 가상 상품 카탈로그
- `lib/test-dialogues.json`: 턴별 정답 상태
- `tests/*.test.mjs`: 기존 14개 + 비교 기능 12개 로직 테스트
- `docs/research/`: 데이터 계약, 연구 계획, 사람이 읽는 테스트 대화

React와 Vinext를 사용하며 Sites용 설정을 포함합니다. `.openai/hosting.json`은 기존 비공개 데모의 프로젝트 식별자입니다. 저장소를 다른 프로젝트에 재사용할 때는 기존 Sites 프로젝트에 게시하지 않도록 호스팅 연결을 별도로 설정해야 합니다. GitHub에 push해도 자동 배포되지는 않습니다.

## 검증과 제한

개발용 대화 30턴의 정답 상태 및 비용·제외·배송일·변경 계산을 포함한 기존 14개 및 비교 설명 12개, 총 26개 테스트로 검증합니다. 이는 별도 평가셋의 일반화 성능이 아닙니다. 브라우저 클릭·스크린샷 검사는 수행하지 않았습니다. WebMCP 읽기 도구는 지원 환경에서 등록하도록 구현했으나 실제 호출은 검증하지 않았습니다.

여러 수령인에게 서로 다른 상품 조합 추천, 실제 재고, 묶음배송, 구어적 금액과 복합 부정 표현은 지원 범위 밖입니다. 성분 정보가 불완전하여 알레르기 적합 상품을 확정하지 않습니다. 배송비 미지정 시 상품 금액 기준으로 계산합니다.

## 다음 단계

1. 서버에서 LLM 구조화 출력을 연결하고 API 키는 서버 비밀값으로 관리
2. 개발용 대화와 분리한 한국어 평가셋 구성
3. 동일 추천 로직·조건 패널에서 대조·반사실 설명 유무에 따른 조건 이해 효과 평가

[두 축의 연구 방향과 비교 설명 설계](docs/research/counterfactual-explanations.md)를 참고하세요. 초기 버전은 예산 증액만 비교하며, 후보 추가와 추천 순위 변경을 구분합니다. 비교 카드는 적용 버튼을 누르기 전까지 실제 조건을 바꾸지 않습니다.

## 2026-09-15 — HCI guided conversation

- Added `lib/conversation.mjs`: one question at a time, contextual short answers, and in-chat read-back of recipient, quantity and budget.
- Unspecified budget scope stays unconfirmed; recommendations and what-if cards wait for recipient, quantity, budget scope, shipping and same-product confirmation.
- Allergy/deadline clarification survives unrelated edits. Different gifts per recipient remain unsupported and are explained explicitly.
- Larger quick-reply targets and automatic conversation scrolling.
- Validation: 34 automated tests pass (26 existing + 8 conversation regressions). No user study or browser interaction testing conducted. Synthetic food catalog only; no LLM, voice, real checkout or age-specific matching.
- Next: independent Korean evaluation set; A/B task/log design; senior-user pilot; LLM structured-output integration.

## 2026-09-15 — Diagnostic evaluation baseline

Added [36-case Korean diagnostic set and runner](evaluation/README.md). The frozen deployed-source baseline passes 22/36 cases and 53/74 explicit final-state checks. Fourteen failures remain visible with reproduction transcripts and a prioritized backlog. This agent-authored set is separate from development examples but is not an independent blind or human-validated evaluation. The application has not changed in this evaluation-only step.

## 2026-09-15 — Language error corrections

Corrected the 14 diagnosed failures without changing the diagnostic labels. Frozen baseline 22/36 → regression result 36/36 cases (74/74 checks); automated tests 41/41. Added bounded Korean money normalization, negation handling, recipient/quantity corrections, invalid-date and unsupported-goods clarification. Clarifications survive unrelated edits and recover after explicit corrections. This is regression improvement on known cases, not independent user accuracy. See `evaluation/results/after-language-fix.md`.
