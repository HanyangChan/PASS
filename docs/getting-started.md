# PASS 실행

[메인 README](../README.md) · [실행](getting-started.md) · [프로젝트 구조](project-structure.md) · [배포](deployment.md)

명령어와 파일 경로는 저장소 루트를 기준으로 합니다.

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
