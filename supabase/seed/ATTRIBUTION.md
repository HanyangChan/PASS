# products-amazon.json 출처와 라이선스

- **원본**: "Amazon Products Sales Dataset 2023" by Lokesh Parab — https://www.kaggle.com/datasets/lokeshparab/amazon-products-dataset
- **라이선스**: [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) (저작자 표시–비영리). 이 파일도 같은 조건으로만 이용할 수 있다. PASS는 수업용 비상업 프로젝트다.
- **원본 데이터는 업로더가 amazon.in에서 수집한 것**이며 Amazon과 무관하다. 상품명·가격·평점은 2023년 수집 시점 값이다.

## 원본에서 바꾼 점

`scripts/catalog/build.mjs`로 생성했다.

1. 선물용 하위 카테고리 20개, 평점 3.5 이상·리뷰 20개 이상·₹150 이상 상품만 선별하고 ASIN과 색상 변형 기준으로 중복 제거, 하위 카테고리별 리뷰 수 상위 200개로 제한
2. Gemini로 한국어 상품명(`name`)을 만들고 16개 카테고리로 재분류, 선물로 부적합하거나 어색한 건강식품은 제외. 원문 상품명은 `name_en`에 보존
3. 가격을 원화로 환산(`price_krw`, 한국 가격대 보정 포함)
4. 이미지 URL의 렌더링 경로 정리(`image_url`), 상품 링크를 `https://www.amazon.in/dp/<ASIN>`으로 정규화(`source_url`)
5. 상품명 키워드로 알레르기 태그(`allergens`) 추정
6. 원본에 없는 배송비·도착일·재고·포장을 규칙으로 합성하고 `demo_fields`에 표시

이미지 파일은 포함하지 않는다(URL만 있음). 문제가 제기되면 이 파일을 삭제하고 `products`를 비활성화한다.
