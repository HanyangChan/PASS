# PASS 배포

[메인 README](../README.md) · [실행](getting-started.md) · [프로젝트 구조](project-structure.md) · [배포](deployment.md)

명령어와 파일 경로는 저장소 루트를 기준으로 합니다.

Vercel은 `mobile/dist`를 배포합니다. 운영 환경에 `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EXPO_PUBLIC_CHAT_API_URL`을 등록합니다.

```sh
npx vercel deploy --prod
npm run deploy:api
```

웹 업로드에서 서버·DB·로컬 환경 변수는 `.vercelignore`로 제외합니다. Worker 배치 지역과 허용 웹 주소는 `api/wrangler.jsonc`에 있습니다. 실행 지역이 Gemini에서 지원되지 않으면 API가 `location_unsupported` 오류를 반환합니다.

상세 구현: [모바일](../mobile/README.md), [API](../api/README.md), [DB](../supabase/README.md).
