# 결정 기록 · 팀 요청

## 확정된 결정
| # | 결정 | 이유 |
|---|---|---|
| K1 | 순위는 공통 PASS 엔진만 결정한다. 자체 점수 모델(8요인)은 만들지 않는다 | `baseline/docs/common-scope.md`: 엔진·정렬·비용 계산은 공통 고정. 다섯 설계를 같은 기준으로 비교하기 위함 |
| K2 | ③은 '후보 풀 생성'이 아니라 '취향 매핑'이다. 엔진은 전체 카탈로그를 본다 | 후보 풀을 자르면 순위가 공통 엔진과 달라져 설계 비교가 오염된다 |
| K3 | 기억은 조건 후보(patch)로만 들어가고 `checkedPatch` 검증을 거친다 | 기억이 검증 없이 점수에 들어가는 경로를 없앰 |
| K4 | 반사실·가격 옵션은 세션 복제본으로 `runTurn`을 다시 호출해 계산한다 | 실제 세션 불변, 하드 제약 재검증 게이트 유지 |
| K5 | 설명은 문장이 아니라 태그·칩 | 사용자 피드백: 설명 글을 읽기 싫어함 |
| K6 | 저장소는 `node:sqlite` (의존성 0) | baseline처럼 설치 없이 실행. Supabase는 후속 어댑터 |
| K7 | 실험은 참가자 ID 기반. 정식 인증·공개 배포는 범위 밖 | 수업 범위, 보안 위험 최소화 |
| K8 | `sessions.state`에는 baseline 세션 상태만 저장한다. `recipientId`·`sensitivity`·`experiment`·`provenance`는 `sessions.meta`(JSON)에 둔다. TRD §5.1의 `sessions.recipient_id`·`experiment` 컬럼은 `meta`로 옮겼다 | baseline `validateSession`이 저장·로드 때 그대로 검증되게 하고, 파이프라인 필드가 엔진 상태에 섞이지 않게 함 (P0) |
| K9 | 카탈로그 스냅샷은 `data/products-amazon.json`(seed 원본 그대로), 해시는 `data/catalog.sha256`, 출처·기준일은 `data/provenance.json`, 라이선스는 `data/ATTRIBUTION.md`. 도착일 기준일은 복사일 `2026-11-05`로 고정. AC 테스트는 `tests/fixtures/catalog.mjs` 합성 카탈로그를 쓴다 | D4 기본값 이행. `toEngineProduct`가 기준일로 도착일을 만들기 때문에 날짜를 고정해야 순위가 재현됨 (P0) |
| K10 | `npm test`를 `node --test "tests/**/*.test.mjs"`로 바꿨다 | Node 22에서 `node --test tests/`는 디렉터리를 모듈로 열려다 실패함 (P0) |
| K11 | `scripts/check-scope.mjs`는 접두 경로를 `git rev-parse --show-prefix`로 얻는다 | 훅은 NFC 경로로, git은 NFD 경로로 한글 폴더명을 보고해 `path.relative`가 `../../인간…` 접두를 만들어 모든 변경을 범위 밖으로 막았음. 범위 밖 파일 차단은 그대로 확인함 (P0) |

## 팀 결정이 필요한 것 (D)
| # | 질문 | 현재 기본값 |
|---|---|---|
| D1 | 작년에 드린 선물의 순위를 낮출 것인가? 공통 엔진에는 반복 회피 요인이 없다 | 순위는 그대로 두고 카드에 "작년 추석에 드린 선물" 표시만. 순위를 낮추려면 공통 엔진 변경이 필요하므로 팀 합의 필요 |
| D2 | `config/value-ladder.v1.json` 기준값 | 초안 값. 파일럿 2명 후 확정 |
| D3 | 앱 배포를 VibeHub로 할지 | 로컬 실험 우선. VibeHub 공개는 관리자 승인 필요 |
| D4 | 카탈로그 스냅샷 출처 | 팀 seed(`supabase/seed/products-amazon.json`)를 `data/`로 복사하고 SHA-256 기록 |

## 공통 코어 변경 요청
(필요해지면 여기에 적는다. b-pipeline 담당자는 공통 코어를 직접 수정하지 않는다.)
