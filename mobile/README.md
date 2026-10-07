# PASS mobile

Expo / React Native iOS·Android 앱. 화면 이동은 Expo Router와 공유 상태 Provider로 구성했습니다. 모바일 소스는 `mobile/`, 기존 웹 앱과 서버는 저장소 루트에 있습니다.

```sh
cd mobile
npm ci
npm start
```

호환되는 Expo Go에서 QR을 열어 실행합니다. `npm run ios`는 Xcode/iOS Simulator, `npm run android`는 Android SDK/에뮬레이터가 필요합니다. Node.js 22.13 이상, Expo SDK 57을 사용합니다. 앱스토어 서명·식별자·EAS 프로젝트는 아직 설정하지 않았고 기본 Expo 아이콘은 임시입니다.

## 구현

첨부된 `E-commerce AI Shopping Assistant (Community).zip`의 홈·대화·수령인별 랭킹·상품 상세·하단 탭 구조를 React Native로 옮겼습니다. 원본 ZIP은 버전 3 수준의 소스로, 마이는 자리 표시자이며 음성·첨부파일·가짜 로그인·고정 점수 추천 기능은 포함되어 있지 않습니다.

- 홈: 8개 선물 카테고리, 인기 상품, 실제로 열어본 상품의 최근 기록.
- AI 추천: 기존 `lib/single-gift.mjs`/`engine.mjs`의 조건 추출과 추천. 고정 모의 응답 대신 실제 기존 로직으로 처리하며, 규칙 기반 식품 선물 범위입니다.
- 추천 결과: 현재 추천 카드, `lib/counterfactual.mjs`의 예산만 바꾼 재계산 결과와 명시적 적용. 비교 열람만으로 현재 예산은 변하지 않습니다.
- 랭킹: 원본의 전체·부모님·친구·직장동료별 10개 데모 목록, 이름 검색, 상품군 필터, 가격 정렬.
- 상세: 원본 이미지·상품 설명·전체 화면 상세, 공유, 찜. 선물하기는 구매 준비 중 안내를 표시합니다.
- 마이: 찜/최근 본 선물과 도움말. 실제 계정이나 구매 이력을 꾸며 표시하지 않습니다.
- 설문: 모바일 진입 경로 없음. 웹 `/study`도 홈으로 리다이렉트하며 설문 코드는 보존합니다.

## 디자인과 데이터

Make의 화면 구조와 제공된 상품 사진 URL/Lucide 아이콘을 사용하고, 두 번째 Figma `cajZ71MOH37gT4ltwQlvbb / 36:1701`에서 확보한 Noto Sans KR·색상·세그먼트·칩·랭킹 카드 스타일로 통일했습니다. Make 원본의 Noto Serif KR는 적용하지 않았습니다. UI 토큰과 카드/칩은 `src/theme.ts`, `src/components.tsx`에서 재사용합니다.

`src/make-data.json`은 첨부 소스의 데이터 리터럴에서 추출한 스냅샷입니다. 상품·가격·평점·인기 수치·배송 정책은 모두 프로토타입용이며 실제 판매나 검증된 상거래 정보가 아닙니다. 랭킹의 다양한 상품군과 기존 대화의 30개 식품 카탈로그는 구분됩니다. 원본 상품 사진은 제공된 Unsplash URL에서 로드하므로 인터넷이 필요합니다. 원본의 일부 사진 URL은 로드되지 않아 사진 로드 실패 안내를 표시합니다. SVG 7개와 한국어 폰트는 로컬에 포함됩니다. 저작권 출처는 `ATTRIBUTIONS.md`에 보존했습니다.

찜과 최근 기록(최대 20개)은 AsyncStorage에 저장하고, 대화는 메모리에만 유지합니다. 모바일은 기존 Gemini 서버를 호출하지 않습니다. 서버는 같은 origin 요청만 허용하므로 모바일 API 인증/계약을 갖춘 후 LLM을 연결해야 합니다. API 키는 앱에 포함하지 않았습니다.

## 검증

```sh
npm run typecheck
npm run lint
npx expo export --platform all
# 저장소 루트
node --test tests/*.test.mjs
npm run build
```

2026-10-06: 타입 검사·린트·Expo Doctor 21개 검사 및 iOS·Android·웹 번들 생성 통과, 기존 테스트 66개 통과. 브라우저 모바일 미리보기에서 홈→상세→찜→마이, 새로고침 후 찜/최근 기록 유지, 부모님 랭킹, 검색/상품군 필터, 대화→추천→예산 비교→55,000원 적용→대화 복귀를 확인했습니다. 실기기/네이티브 시뮬레이터/앱스토어 빌드는 미검증입니다.

### 채팅 프로토타입 조작

- `음성 입력`: 말하기 시작 → 완료 → 예시 문장 확인·수정 → 입력창 적용. 실제 녹음이나 마이크 권한 요청 없이 체험합니다. 적용 후 보내기 버튼으로 추천에 반영합니다.
- `현재 조건 확인`: 대화의 받는 분, 예산, 배송비, 선호·제외 조건, 브랜드, 수령일, 포장을 확인·수정합니다. 취소는 기존 조건을 보존하고 적용은 추천 결과를 갱신합니다.
- 새 Figma 파일은 읽기 권한이 확보되지 않아 기존 디자인 토큰으로 구성한 임시 화면입니다.

### 전체 화면 흐름도 참고

첨부된 흐름도를 참고해 선물 확인·완료, 로그인 체험·실패, 계정/준비 기록, 첨부 예시 선택·전송, 가격/정렬/상품군 필터, 결과 없음 상태를 추가했습니다. 상세 범위와 추가 보완 항목은 [화면 흐름 정리](src/prototype-flow-reference.md)에 기록합니다. 실제 구매·인증·파일 업로드는 발생하지 않습니다.

### Vercel 데모 배포

저장소 루트의 `vercel.json`이 모바일 앱의 웹 버전을 빌드하도록 설정합니다. Vercel에 PASS 저장소를 가져올 때 Root Directory는 저장소 루트(`.`)로 유지합니다. `mobile` 밖에 있는 추천 엔진 파일도 함께 빌드해야 합니다.

- Framework Preset: Other
- Install Command: `npm --prefix mobile ci`
- Build Command: `npm --prefix mobile run build:web`
- Output Directory: `mobile/dist`
- 환경변수: 데모에 필요 없음

GitHub 배포는 최신 변경이 들어 있는 브랜치를 먼저 push한 뒤 해당 브랜치를 연결해야 합니다. 웹 정적 페이지이므로 모든 경로를 홈으로 강제하는 SPA rewrite는 추가하지 않습니다. `cleanUrls`로 `/chat`, `/ranking` 등의 직접 접근을 처리합니다.

GitHub 연결 없이 CLI로 배포하려면 저장소 루트에서 `npx vercel@latest`를 실행하고 로그인/프로젝트 설정을 완료합니다. 첫 명령은 미리보기 배포이며, 공개 운영 주소를 갱신할 때는 `npx vercel@latest --prod`를 실행합니다.

Vercel에는 브라우저 데모가 배포됩니다. 앱스토어용 iOS/Android 설치 파일 배포는 별도의 EAS 빌드로 진행합니다.
