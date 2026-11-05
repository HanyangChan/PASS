# 로컬 E2E (배포·운영 계정 없이 실제 앱 화면으로 확인)

실제 앱 웹 빌드 + 실제 Worker 코드 + LangGraph 그래프 + 실제 Gemini를 localhost에서 연결한다. Supabase만 페이지 안 대역(`mock-supabase.js`, `https://pass-mock.test`)으로 바꾼다. 운영 Supabase·Cloudflare에는 아무것도 보내지 않는다.

```sh
# 저장소 루트 기준
# 1) 앱 웹 빌드 (환경 변수를 바꾼 뒤에는 --clear로 캐시를 지운다)
cd mobile && EXPO_PUBLIC_SUPABASE_URL=https://pass-mock.test EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_demo \
  EXPO_PUBLIC_CHAT_API_URL=http://127.0.0.1:8788 EXPO_PUBLIC_AGENTS_MODE=on \
  npx expo export -p web --clear --output-dir ../baseline/agents/d-langgraph/e2e/web && cd ..
# 2) 로컬 API (AGENTS_MODE on). GEMINI_API_KEY가 없으면 규칙만 쓴다.
node --env-file=<GEMINI_API_KEY가 든 .env> baseline/agents/d-langgraph/e2e/local-api.mjs
# 3) 앱 서버 → http://127.0.0.1:8767/chat
node baseline/agents/d-langgraph/e2e/serve.mjs
```

`mock-supabase.js`는 데모 계정(`demo-user`) 세션, 어머니 구매 기록 2건(뷰티 만족, 과자 불만족), 10일 뒤 "엄마 생일" 캘린더를 브라우저 저장소에 넣는다. 캘린더는 비어 있을 때만 넣으므로, 다시 넣으려면 개발자 도구에서 `pass.calendar-events.v1`을 지운다. `e2e/web/`은 Git에서 제외한다.

## 2026-11-05 확인 결과

| 시나리오 | 결과 |
| --- | --- |
| "엄마 선물 5만원 이하 배송비 포함" | 네 에이전트 의견과 출처, 취향 자동 반영으로 뷰티 상품 추천, 마감·과자 제외 제안과 후보 수 미리보기. LLM 0회 |
| 취향 에이전트 끄기 | 추천이 뷰티 → 주방·홈데코로 바뀜, 취향 제안 사라짐. LLM 0회, 242ms |
| "나는 과자 좋아하는데 엄마는 견과류 알레르기가 있고 피부 관리에 관심이 많으셔" | Gemini 1회(6.2초). 과자 = 나·미반영, 견과류·뷰티 = 엄마. 상위 3개 모두 뷰티. 기억하기 → 기기에 뷰티·견과류만 저장 |
| 마감 제안 누르기 | 조건 수정 요청으로 적용, 제안 목록에서 사라짐 |
| "아빠랑 엄마 중에 한 분이 우유 알레르기야" | "우유 알레르기는 누구에게 해당하나요?" 질문, 받는 분·저장된 조건 유지 |

이 과정에서 앱 쪽 버그 두 개를 찾아 고쳤다. (1) 앱이 서버로 보내기 전에 발화 전체를 해석해 내 취향(과자)을 엄마 조건에 넣던 문제, (2) 여러 사람이 언급된 문장에서 받는 분을 바꾸고 조건을 초기화하던 문제. 에이전트 모드에서는 둘 다 서버의 귀속 에이전트가 판단한다.
