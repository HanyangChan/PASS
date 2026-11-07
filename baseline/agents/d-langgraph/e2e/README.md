# 로컬 E2E (배포·운영 계정 없이 실제 앱 화면으로 확인)

로컬 웹 빌드를 실제 추천 Worker에 연결한다. 데모 계정은 페이지 안 대역(`mock-supabase.js`)을 사용하고 상품은 저장소에 포함된 카탈로그를 읽는다.

```sh
# 저장소 루트 기준
npm run setup
npm run setup:local
# 1) 앱 웹 빌드 (환경 변수를 바꾼 뒤에는 --clear로 캐시를 지운다)
cd mobile && EXPO_PUBLIC_SUPABASE_URL=https://pass-mock.test EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_demo \
  EXPO_PUBLIC_CHAT_API_URL=http://127.0.0.1:8788 \
  npx expo export -p web --clear --output-dir ../baseline/agents/d-langgraph/e2e/web && cd ..
# 2) 로컬 데모 API. 모델 호출은 api/.dev.vars의 LLM 설정을 사용한다.
node baseline/agents/d-langgraph/e2e/local-api.mjs
# 3) 앱 서버 → http://127.0.0.1:8767/chat
node baseline/agents/d-langgraph/e2e/serve.mjs
```

`mock-supabase.js`는 데모 계정과 캘린더를 브라우저에 준비한다. 채팅의 A~D 슬라이더에서 B를 선택하면 귀속과 자문을 확인할 수 있다. 기존 예시 구매 이력은 분석용으로 남긴다. C와 D를 시험하려면 [공유 LLM 설정](../../../../api/README.md#로컬-시험)에 따라 유효한 모델 키를 지정한다. `e2e/web/`은 Git에서 제외한다.

## 2026-11-05 이전 데모 검증 기록

| 시나리오 | 결과 |
| --- | --- |
| "엄마 선물 5만원 이하 배송비 포함" | 네 에이전트 의견과 출처, 취향 자동 반영으로 뷰티 상품 추천, 마감·과자 제외 제안과 후보 수 미리보기. LLM 0회 |
| 취향 에이전트 끄기 | 추천이 뷰티 → 주방·홈데코로 바뀜, 취향 제안 사라짐. LLM 0회, 242ms |
| "나는 과자 좋아하는데 엄마는 견과류 알레르기가 있고 피부 관리에 관심이 많으셔" | Gemini 1회(6.2초). 과자 = 나·미반영, 견과류·뷰티 = 엄마. 상위 3개 모두 뷰티. 기억하기 → 기기에 뷰티·견과류만 저장 |
| 마감 제안 누르기 | 조건 수정 요청으로 적용, 제안 목록에서 사라짐 |
| "아빠랑 엄마 중에 한 분이 우유 알레르기야" | "우유 알레르기는 누구에게 해당하나요?" 질문, 받는 분·저장된 조건 유지 |

이 과정에서 앱 쪽 버그 두 개를 찾아 고쳤다. (1) 앱이 서버로 보내기 전에 발화 전체를 해석해 내 취향(과자)을 엄마 조건에 넣던 문제, (2) 여러 사람이 언급된 문장에서 받는 분을 바꾸고 조건을 초기화하던 문제. 에이전트 모드에서는 둘 다 서버의 귀속 에이전트가 판단한다.
