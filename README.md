# PASS — Personalized AI Shopping System

Expo / React Native 기반 iOS·Android 선물 추천 앱입니다. 웹에서도 같은 모바일 화면과 서비스를 사용합니다.

[PASS 웹 앱](https://temporary-prompt-sable-s15js3l.vercel.app) · [추천 API 상태](https://pass-recommendation-api.a73342776.workers.dev/health)

## 실행

Node.js 22.13 이상이 필요합니다.

```sh
npm ci
npm run setup
cp mobile/.env.example mobile/.env.local
npm run dev
```

모바일 환경 변수에는 Supabase URL, 공개 Publishable key, 추천 API 기본 주소를 설정합니다. Gemini 키는 앱에 넣지 않고 Cloudflare secret으로 관리합니다. 서버 로컬 설정은 `api/.dev.vars`에 저장합니다.

```sh
npm run web        # 모바일 웹 개발 서버
npm run ios        # iOS 개발 빌드
npm run android    # Android 개발 빌드
npm run dev:api    # 로컬 추천 API
npm run build      # 모바일 웹 정적 빌드
npm run typecheck
npm run lint
npm test
```

음성 인식은 네이티브 개발 빌드가 필요합니다. 앱스토어 배포용 서명·앱 식별자·EAS 프로젝트 설정은 후속 작업입니다.

## 구조

- `mobile/`: Expo Router 화면, 음성 입력, 로그인, 계정 기록, 추천 API 연결
- `api/`: 인증·요청 제한·CORS를 적용하는 Cloudflare Worker
- `supabase/`: 상품·대화·메시지·선물 기록 스키마와 RLS
- `lib/`: 공유 조건 추출, 추천, 예산 비교, 식품 데모 카탈로그
- `tests/`, `evaluation/`: 공유 엔진 회귀 테스트와 과거 평가 자료

기존 명절 연구 웹과 설문 화면은 제거했습니다. 과거 구현은 Git 이력에서 확인할 수 있습니다. 현재 추천 상품·가격·배송 정보는 데모 데이터이며, 실제 주문·결제 기능은 제공하지 않습니다.

## 배포

Vercel은 `mobile/dist`를 배포합니다. 운영 환경에 `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_CHAT_API_URL`을 등록합니다.

```sh
npx vercel deploy --prod
npm run deploy:api
```

웹 업로드에서 서버·DB·로컬 환경 변수는 `.vercelignore`로 제외합니다. Worker 배치 지역과 허용 웹 주소는 `api/wrangler.jsonc`에 있습니다. 실행 지역이 Gemini에서 지원되지 않으면 API가 `location_unsupported` 오류를 반환합니다.

상세 구현: [모바일](mobile/README.md), [API](api/README.md), [DB](supabase/README.md).

## 아키텍처

[현재 운영 구조와 배포 설정](docs/architecture.md) · [구조도](https://temporary-prompt-sable-s15js3l.vercel.app/architecture.svg)
