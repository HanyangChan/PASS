# 명절 선물 테스트 대화 10개

모든 상품·배송일은 합성 데이터입니다. 날짜는 달력상의 명절 날짜를 주장하지 않는 테스트 입력입니다.

## T01 예산 범위와 수량 변경

1. **사용자:** 추석 부모님 선물 한 세트, 상품값 10만 원 이하로 추천해줘.
   - 변경: `{"occasion": "추석", "recipients": ["부모님"], "quantity": 1, "budget": {"amount_krw": 100000, "scope": "per_set", "shipping_included": false}}`
   - 확인 질문: 필수 아님
2. **사용자:** 너무 단 건 안 좋아하셔.
   - 변경: `{"preferences": ["less_sweet"]}`
   - 확인 질문: 필수 아님
3. **사용자:** 처가에도 같은 걸 보낼게. 두 세트 상품값 합쳐 15만 원 이하로.
   - 변경: `{"recipients": ["부모님", "처가"], "quantity": 2, "same_product": true, "budget": {"amount_krw": 150000, "scope": "total"}}`
   - 확인 질문: 필수 아님

## T02 명시적 제외 추가와 해제

1. **사용자:** 설 선물 한 세트, 상품값 8만 원 이하. 견과류는 빼줘.
   - 변경: `{"occasion": "설", "quantity": 1, "budget": {"amount_krw": 80000, "scope": "per_set", "shipping_included": false}, "excluded_categories": ["nuts"]}`
   - 확인 질문: 필수 아님
2. **사용자:** 한과도 제외해줘.
   - 변경: `{"excluded_categories": ["nuts", "hangwa"]}`
   - 확인 질문: 필수 아님
3. **사용자:** 견과류는 다시 포함해도 돼.
   - 변경: `{"excluded_categories": ["hangwa"]}`
   - 확인 질문: 필수 아님

## T03 모호한 가격 표현

1. **사용자:** 추석 선물 한 세트, 상품값 10만 원 이하.
   - 변경: `{"occasion": "추석", "quantity": 1, "budget": {"amount_krw": 100000, "scope": "per_set", "shipping_included": false}}`
   - 확인 질문: 필수 아님
2. **사용자:** 좀 더 저렴하게.
   - 변경: `{}`
   - 확인 질문: 새 예산 상한 또는 현재 후보보다 저렴한 순위 선호인지 확인
3. **사용자:** 상품값 5만 원 이하로 해줘.
   - 변경: `{"budget": {"amount_krw": 50000}}`
   - 확인 질문: 필수 아님

## T04 관계로 취향을 추측하지 않기

1. **사용자:** 부모님께 드릴 추석 선물이야.
   - 변경: `{"occasion": "추석", "recipients": ["부모님"]}`
   - 확인 질문: 필수 아님
2. **사용자:** 차 한 세트로 상품값 6만 원 이하.
   - 변경: `{"quantity": 1, "preferences": ["category:tea"], "budget": {"amount_krw": 60000, "scope": "per_set", "shipping_included": false}}`
   - 확인 질문: 필수 아님
3. **사용자:** 아니, 받는 분은 교수님이야. 격식 있는 포장으로.
   - 변경: `{"recipients": ["교수님"], "packaging": "formal"}`
   - 확인 질문: 필수 아님

## T05 배송비 포함 총예산

1. **사용자:** 추석 선물 같은 걸 세 집에 한 세트씩, 배송비 포함 총 12만 원 이하.
   - 변경: `{"occasion": "추석", "quantity": 3, "same_product": true, "budget": {"amount_krw": 120000, "scope": "total", "shipping_included": true}}`
   - 확인 질문: 필수 아님
2. **사용자:** 총예산 15만 원으로 올릴게.
   - 변경: `{"budget": {"amount_krw": 150000}}`
   - 확인 질문: 필수 아님
3. **사용자:** 배송비는 예산에서 빼고 상품값만 계산해.
   - 변경: `{"budget": {"shipping_included": false}}`
   - 확인 질문: 필수 아님

## T06 상대 날짜 확인

1. **사용자:** 추석 선물 한 세트, 상품값 8만 원 이하.
   - 변경: `{"occasion": "추석", "quantity": 1, "budget": {"amount_krw": 80000, "scope": "per_set", "shipping_included": false}}`
   - 확인 질문: 필수 아님
2. **사용자:** 명절 전날까지 와야 해.
   - 변경: `{}`
   - 확인 질문: 원하는 수령 마감일을 YYYY-MM-DD로 확인
3. **사용자:** 2026년 9월 21일까지 받으면 돼.
   - 변경: `{"delivery_by": "2026-09-21"}`
   - 확인 질문: 필수 아님

## T07 브랜드 제한 해제

1. **사용자:** 설 선물 한 세트. 가상브랜드4만, 상품값 8만 원 이하.
   - 변경: `{"occasion": "설", "quantity": 1, "brand": "가상브랜드4", "budget": {"amount_krw": 80000, "scope": "per_set", "shipping_included": false}}`
   - 확인 질문: 필수 아님
2. **사용자:** 브랜드는 상관없어.
   - 변경: `{"brand": null}`
   - 확인 질문: 필수 아님
3. **사용자:** 단맛 없는 걸 선호해.
   - 변경: `{"preferences": ["unsweetened"]}`
   - 확인 질문: 필수 아님

## T08 조건 만족 상품 없음

1. **사용자:** 추석 선물 한 세트, 상품값 1만 원 이하로.
   - 변경: `{"occasion": "추석", "quantity": 1, "budget": {"amount_krw": 10000, "scope": "per_set", "shipping_included": false}}`
   - 확인 질문: 필수 아님
2. **사용자:** 예산은 그대로 두고 격식 있는 포장으로.
   - 변경: `{"packaging": "formal"}`
   - 확인 질문: 필수 아님
3. **사용자:** 그럼 상품값 6만 원까지 괜찮아.
   - 변경: `{"budget": {"amount_krw": 60000}}`
   - 확인 질문: 필수 아님

검증: 1~2턴은 후보 0개. 예산 자동 완화 금지. 3턴에는 formal 포장과 60000원 이하 조건 모두 적용.

## T09 알레르기와 불완전 상품정보

1. **사용자:** 추석 선물 한 세트, 상품값 8만 원 이하. 땅콩 알레르기가 있는 분께 드려.
   - 변경: `{"occasion": "추석", "quantity": 1, "budget": {"amount_krw": 80000, "scope": "per_set", "shipping_included": false}, "excluded_ingredients": ["땅콩"]}`
   - 확인 질문: 필수 아님
2. **사용자:** 호두도 피해야 해.
   - 변경: `{"excluded_ingredients": ["땅콩", "호두"]}`
   - 확인 질문: 필수 아님
3. **사용자:** 예산만 10만 원으로 올려.
   - 변경: `{"budget": {"amount_krw": 100000}}`
   - 확인 질문: 필수 아님

검증: 알레르기 정보가 불완전하므로 안전한 상품이라고 단정하거나 적합 추천하지 않는다. 성분·교차접촉 정보 확인 필요 상태를 반환한다.

## T10 단위 예산에서 총예산으로 전환

1. **사용자:** 설 선물 같은 걸 네 세트. 세트당 상품값 5만 원 이하.
   - 변경: `{"occasion": "설", "quantity": 4, "same_product": true, "budget": {"amount_krw": 50000, "scope": "per_set", "shipping_included": false}}`
   - 확인 질문: 필수 아님
2. **사용자:** 다섯 세트로 바꿀게.
   - 변경: `{"quantity": 5}`
   - 확인 질문: 필수 아님
3. **사용자:** 세트당 말고 다섯 세트 상품값 합쳐 20만 원 이하로.
   - 변경: `{"budget": {"amount_krw": 200000, "scope": "total"}}`
   - 확인 질문: 필수 아님
