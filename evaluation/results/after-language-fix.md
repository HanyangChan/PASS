# PASS 한국어 진단 평가 v1

- Source: 8b71a43e81714af6ab464f6878560c005ea3211b
- Dataset SHA-256: 6e75c63f254786ac39bdd16206b6d94d55ed089efeb04624ca11683a94511852
- 사례 통과: 36/36
- 명시된 최종 상태·동작 검사항목 통과: 74/74
- 합성 진단셋이며 실제 사용자 정확도나 독립 블라인드 평가 점수가 아닙니다. 중간 턴 전체 슬롯 정확도를 측정하지 않습니다.

| ID | 구분 | 사례 | 결과 | 실패 항목 |
|---|---|---|---|---|
| E01 | budget | 총예산 명시 | PASS | — |
| E02 | budget | 세트당 명시 | PASS | — |
| E03 | budget | 금액만 말한 초기 요청 | PASS | — |
| E04 | budget | 한글 금액 | PASS | — |
| E05 | budget | 쉼표 금액 | PASS | — |
| E06 | budget | 범위 예산 상한 | PASS | — |
| E07 | budget | 부정 뒤 새 총예산 | PASS | — |
| E08 | budget | 음수 거부 | PASS | — |
| E09 | budget | 하한만 제시 | PASS | — |
| E10 | budget | 원 단위 없음 | PASS | — |
| E11 | quantity | 짧은 응답 | PASS | — |
| E12 | quantity | 아라비아 숫자 응답 | PASS | — |
| E13 | quantity | 숫자 동의 혼동 금지 | PASS | — |
| E14 | quantity | 음수 수량 거부 | PASS | — |
| E15 | quantity | 다른 상품 요청 | PASS | — |
| E16 | quantity | 수량 정정 | PASS | — |
| E17 | quantity | 여섯 수량 | PASS | — |
| E18 | quantity | 수량을 예산으로 오해하지 않기 | PASS | — |
| E19 | preservation | 제외 추가 후 예산 갱신 | PASS | — |
| E20 | preservation | 제외 취소 | PASS | — |
| E21 | preservation | 수신자 추가 | PASS | — |
| E22 | preservation | 브랜드 제한 해제 | PASS | — |
| E23 | clarification | 알레르기 정보 지속 | PASS | — |
| E24 | clarification | 성분 응답 뒤 추천 차단 | PASS | — |
| E25 | clarification | 정확한 마감일 제공 | PASS | — |
| E26 | clarification | 잘못된 날짜 거부 | PASS | — |
| E27 | clarification | 모호한 저렴함 유지 | PASS | — |
| E28 | clarification | 시작 안내 | PASS | — |
| E29 | shipping | 배송비 포함 확인 | PASS | — |
| E30 | shipping | 배송비 제외 확인 | PASS | — |
| E31 | shipping | 배송비 제외에서 포함 변경 | PASS | — |
| E32 | shipping | 부정문 배송비 | PASS | — |
| E33 | boundary | 견과 알레르기 안전 단정 방지 | PASS | — |
| E34 | boundary | 조건 없는 초기 추천 차단 | PASS | — |
| E35 | boundary | 취향 철회 | PASS | — |
| E36 | boundary | 범위 밖 상품 요청 | PASS | — |

## 실패 상세


