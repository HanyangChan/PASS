# PASS 한국어 진단 평가 v1

- Source: ee50db929f4a7189a25eb145b114e7eaa1b75bcc
- Dataset SHA-256: 6e75c63f254786ac39bdd16206b6d94d55ed089efeb04624ca11683a94511852
- 사례 통과: 22/36
- 명시된 최종 상태·동작 검사항목 통과: 53/74
- 합성 진단셋이며 실제 사용자 정확도나 독립 블라인드 평가 점수가 아닙니다. 중간 턴 전체 슬롯 정확도를 측정하지 않습니다.

| ID | 구분 | 사례 | 결과 | 실패 항목 |
|---|---|---|---|---|
| E01 | budget | 총예산 명시 | PASS | — |
| E02 | budget | 세트당 명시 | PASS | — |
| E03 | budget | 금액만 말한 초기 요청 | PASS | — |
| E04 | budget | 한글 금액 | FAIL | state.budget.amount_krw, question |
| E05 | budget | 쉼표 금액 | FAIL | state.budget.amount_krw, question |
| E06 | budget | 범위 예산 상한 | PASS | — |
| E07 | budget | 부정 뒤 새 총예산 | PASS | — |
| E08 | budget | 음수 거부 | FAIL | state.budget.amount_krw, question |
| E09 | budget | 하한만 제시 | FAIL | state.budget.amount_krw, question |
| E10 | budget | 원 단위 없음 | FAIL | state.budget.amount_krw |
| E11 | quantity | 짧은 응답 | PASS | — |
| E12 | quantity | 아라비아 숫자 응답 | PASS | — |
| E13 | quantity | 숫자 동의 혼동 금지 | PASS | — |
| E14 | quantity | 음수 수량 거부 | FAIL | state.quantity, question |
| E15 | quantity | 다른 상품 요청 | PASS | — |
| E16 | quantity | 수량 정정 | FAIL | state.quantity |
| E17 | quantity | 여섯 수량 | FAIL | state.quantity, question |
| E18 | quantity | 수량을 예산으로 오해하지 않기 | PASS | — |
| E19 | preservation | 제외 추가 후 예산 갱신 | PASS | — |
| E20 | preservation | 제외 취소 | PASS | — |
| E21 | preservation | 수신자 추가 | FAIL | state.recipients |
| E22 | preservation | 브랜드 제한 해제 | PASS | — |
| E23 | clarification | 알레르기 정보 지속 | PASS | — |
| E24 | clarification | 성분 응답 뒤 추천 차단 | PASS | — |
| E25 | clarification | 정확한 마감일 제공 | PASS | — |
| E26 | clarification | 잘못된 날짜 거부 | FAIL | state.delivery_by, blocked |
| E27 | clarification | 모호한 저렴함 유지 | PASS | — |
| E28 | clarification | 시작 안내 | FAIL | question |
| E29 | shipping | 배송비 포함 확인 | PASS | — |
| E30 | shipping | 배송비 제외 확인 | PASS | — |
| E31 | shipping | 배송비 제외에서 포함 변경 | PASS | — |
| E32 | shipping | 부정문 배송비 | FAIL | state.budget.shipping_included |
| E33 | boundary | 견과 알레르기 안전 단정 방지 | PASS | — |
| E34 | boundary | 조건 없는 초기 추천 차단 | PASS | — |
| E35 | boundary | 취향 철회 | FAIL | state.preferences |
| E36 | boundary | 범위 밖 상품 요청 | FAIL | blocked |

## 실패 상세

### E04 한글 금액

- 사용자: 부모님 한 세트, 상품값 총 십만 원

- state.budget.amount_krw: expected 100000, actual null
- question: expected null, actual "amount"

### E05 쉼표 금액

- 사용자: 친구 한 세트 상품값 총 120,000원

- state.budget.amount_krw: expected 120000, actual null
- question: expected null, actual "amount"

### E08 음수 거부

- 사용자: 부모님 한 세트 상품값 총 -5만 원

- state.budget.amount_krw: expected null, actual 50000
- question: expected "amount", actual null

### E09 하한만 제시

- 사용자: 손녀 한 세트 상품값 총 30만 원 이상

- state.budget.amount_krw: expected null, actual 300000
- question: expected "amount", actual null

### E10 원 단위 없음

- 사용자: 친구 한 세트 상품값 총 10만

- state.budget.amount_krw: expected 100000, actual null

### E14 음수 수량 거부

- 사용자: 친구 -2세트 상품값 총 10만 원

- state.quantity: expected null, actual 2
- question: expected "quantity", actual "same"

### E16 수량 정정

- 사용자: 친척 두 세트 같은 상품 배송비 포함 총 20만 원
- 사용자: 두 세트가 아니라 세 세트

- state.quantity: expected 3, actual 2

### E17 여섯 수량

- 사용자: 손주 여섯 명 같은 상품 배송비 포함 총 30만 원

- state.quantity: expected 6, actual null
- question: expected null, actual "quantity"

### E21 수신자 추가

- 사용자: 부모님 한 세트 상품값 총 7만 원
- 사용자: 친척에도 같은 상품 두 세트

- state.recipients: expected ["부모님","친척"], actual ["친척"]

### E26 잘못된 날짜 거부

- 사용자: 부모님 한 세트 상품값 총 8만 원, 2026-02-30까지

- state.delivery_by: expected null, actual "2026-02-30"
- blocked: expected true, actual false

### E28 시작 안내

- 사용자: 선물 좀 골라줘

- question: expected "recipient", actual "issue"

### E32 부정문 배송비

- 사용자: 부모님 한 세트 총 7만 원
- 사용자: 배송비 포함하지 마

- state.budget.shipping_included: expected false, actual true

### E35 취향 철회

- 사용자: 친구 한 세트 상품값 총 8만 원, 단맛 없는 걸로
- 사용자: 단맛은 상관없어

- state.preferences: expected [], actual ["unsweetened"]

### E36 범위 밖 상품 요청

- 사용자: 손녀 한 세트 상품값 총 10만 원, 운동화로 추천해줘

- blocked: expected true, actual false
