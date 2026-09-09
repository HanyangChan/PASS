# 데이터 계약 초안 v0.1

## 세션 상태
- occasion: 문자열 또는 null. 사용자 발화의 명절 이름.
- recipients: 문자열 배열. 관계 정보이며 취향 추론의 정답 근거가 아니다.
- quantity: 양의 정수 또는 null. 총 세트 수. 언급하지 않았으면 1로 확정 저장하지 않는다.
- same_product: boolean 또는 null. 여러 세트가 동일 상품인지 여부.
- budget.amount_krw: 양의 정수 또는 null. 원 단위 상한.
- budget.scope: per_set / total / null. 세트당 또는 전체 예산.
- budget.shipping_included: boolean 또는 null. true면 배송비 포함. 불명확하면 예산 경계 후보의 적합성을 확정하기 전에 확인한다.
- preferences: 문자열 배열. 순위 선호이며 필수 필터가 아니다. 초안 허용 값은 less_sweet, unsweetened, category:tea.
- excluded_categories: fruit / hangwa / nuts / tea / coffee / oil 중 제외 항목 배열.
- excluded_ingredients: 피해야 할 성분 문자열 배열.
- brand: 지정 브랜드 문자열 또는 null.
- delivery_by: YYYY-MM-DD 또는 null. 명확한 날짜만 저장한다.
- packaging: basic / formal / null. 지정 시 필수 필터.

null은 현재 활성 제한이 없거나 미확인인 상태를 뜻한다. 사용자에 의한 명시적 해제 여부는 턴 기록의 patch로 구분한다. 배열은 patch에 등장할 때 전체 교체한다. 중첩 budget 객체는 등장한 필드만 갱신한다. patch에 없는 필드는 유지한다. 자유 발화가 허용 값 밖의 새 선호를 표현하면 검증 오류나 확인 대상으로 다루고 조용히 버리지 않는다.

## 상품
id는 고유 식별자이며 name, category, price_krw, shipping_fee_per_set_krw, ingredients, allergens_declared, allergen_information_complete, sweetness, packaging, brand, arrival_date, stock_sets, description, synthetic 필드를 갖는다.

sweetness는 sweet / naturally_sweet / unsweetened다. less_sweet 선호는 unsweetened, naturally_sweet, sweet 순서로 점수를 준다. 이는 합성 데이터의 순위 규칙이며 건강 적합성 판단이 아니다. category:tea는 차 상품에 가산점을 준다. 동점이면 가격 오름차순, ID 오름차순으로 정렬한다. 점수 예시: category 일치 +3, unsweetened 선호 일치 +2, less_sweet는 각각 +2/+1/+0.

성분 문자열과 알레르기 표시는 불완전한 모의 정보다. 빈 알레르기 배열은 무알레르기를 뜻하지 않는다. 성분 제외가 있으면 알려진 일치 상품을 제외하고, 잔여 후보의 성분 정보가 불완전하면 적합 판정을 보류한다. 특히 알레르기 발화에서는 이 카탈로그로 안전한 상품을 확정 추천할 수 없다.

## 비용 및 검색
동일 상품 q세트의 상품 총액은 q × price_krw. 배송비 포함이면 q × shipping_fee_per_set_krw를 더한다. 이는 세트마다 배송비를 부과하는 실험 규칙이며 묶음 배송 할인은 모델링하지 않는다.

per_set은 한 세트 비용과 예산을 비교한다. total은 총비용과 비교한다. total인데 quantity가 없으면 수량을 확인한다. same_product가 false이거나 미확정인 여러 수령인에게 서로 다른 상품 조합을 구성하는 최적화는 첫 MVP 범위 밖이다. 동일 상품을 여러 세트 보내는 시나리오인지 확인한 뒤 진행한다.

브랜드, 제외 상품군, 포장, 예산, 재고, 배송일을 필터로 적용한다. 배송일은 합성 고정 날짜끼리 비교한다. 현재 날짜를 기준으로 실제 배송 가능성을 주장하지 않는다.

## 턴 기록과 표시
실제 런타임에는 turn_id, user, previous_state, patch, state, diff, clarification_topics, candidate_ids, response_status를 기록한다. diff는 코드로 깊게 비교해 budget.amount_krw 같은 필드 경로별 old/new 값을 만든다. 테스트의 changed_fields는 점검을 위한 최상위 필드 목록이다.

확인 질문이 있다고 모든 추천을 중단할 필요는 없지만, 미확정 조건을 충족했다고 표시해서는 안 된다. 테스트의 recommendation_ready는 확인 질문 주제가 비어 있다는 뜻만 가진다. 후보 존재나 알레르기 적합성을 보장하지 않는다. 런타임 response_status는 ready / needs_clarification / no_match / insufficient_product_info로 별도 계산한다.

UI의 조건 변화 표시는 상태 비교 결과를 사용하고, 추천 설명은 선택된 상품의 ID·가격·속성에서 생성한다. 금액 변화와 수량 변화가 동시에 일어나면 둘 다 표시한다.
