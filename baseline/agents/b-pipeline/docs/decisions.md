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
| K12 | `.claude/hooks/guard-scope.mjs`는 작업 공간·대상·cwd를 모두 NFC로 바꿔 비교한다. `tests/guard-scope.test.mjs`가 NFC·NFD 경로 양쪽에서 범위 안 허용, 범위 밖 차단을 확인한다 | 수정 전 훅은 NFC 경로로 들어온 범위 안 편집을 잘못 차단했음(작업 공간은 NFD). 범위 밖 차단은 원래도 유지됐음 (P1 전) |
| K13 | TRD §5.1을 실제 `db/schema.sql`에 맞춰 고쳤다(`sessions.meta`, CHECK 제약, NOT NULL). `tests/fixtures/catalog.mjs`는 P1부터 고정하고, 바꿔야 하면 이 표에 이유를 먼저 적는다 | 문서와 스키마가 달라 구현자가 잘못된 컬럼을 쓸 위험 (P1 전) |
| K14 | 기억 극성: `allergy:`·`dislike:`는 -1(회피), `pref:`·`hobby:`·`constraint:`는 +1. 부호가 반대인 진술은 저장하지 않고 충돌 확인에만 쓴다. 알레르기의 반대 진술은 K18로 대체됨 | S5(AC8)와 알레르기 불감소(AC7)를 같은 규칙으로 처리 (P1) |
| K15 | `memory/write.mjs`의 후보는 `basis:'explicit'`일 때만 받는다. 알레르기는 근거 문장에 해당 알레르겐 이름이 있어야 한다. 피드백 `suggested`의 세션 목록은 K17로 `signals` 컬럼에 둔다 | 규칙 2·3·4를 스키마 변경 없이 구현 (P1) |
| K16 | 선물 이력은 `preferences`에 넣지 않는다. 카드 표시·반영 한 줄 근거로만 쓰고, 선호는 사용자가 칩을 누른 발화 patch로만 들어간다. `merge`의 이력 병합을 제거했고 "이력만으로 preferences가 바뀌지 않는다" 테스트를 넣었다. "작년 선물이 1위가 되지 않는다" 테스트는 만들지 않는다 | 엔진은 `category:<c>`에 +3을 주고 반복 회피가 없어, 이력을 선호로 넣으면 작년 선물 카테고리가 오히려 올라간다 (P1 수정, D1 기본값과 같은 방향) |
| K17 | `memories.signals`(JSON 배열, 기본 `[]`)를 추가해 suggested 신호의 세션 ID를 저장한다. `evidence`에는 사용자 문장만 둔다. 사용자 문장이 없는 suggested 행의 `evidence`는 `NOT NULL` 제약 때문에 고정 라벨 `행동 피드백(찜·제외)`을 넣는다(추측). 기존 파일 DB는 열기 때 `alter table`로 컬럼을 추가한다 | 세션 ID가 근거 문장처럼 보이는 문제 제거. 스키마는 TRD §5.1에 같이 반영해야 함 |
| K18 | 기억된 알레르기의 반대 진술("이제 땅콩 먹어도 돼")은 거부하지 않고 `memory_prompt`(`kind:'allergy_delete'`, "기억에서 삭제할까요?")로 연결한다. 문장에 알레르겐 이름이 있어야 하고 수락(`resolveConflict accept:true`) 때만 실제 삭제한다. 거절·무응답은 상태 불변. 이 외의 경로(수정·피드백·병합·LLM)는 여전히 줄이지 못한다 | AC7은 "명시적 삭제만 허용"(TRD §5.3-2)이므로 사용자가 말했는데 거부하면 막다른 길이 됨 |
| K19 | 기억에 없는 세션 전용 알레르기를 칩·발화로 지우면 `allergy_release_session`("알레르기 제외를 해제할까요?")을 1회 묻고, 확인(`confirmedReleases`)한 뒤에만 해제한다. 기억에 있는 알레르기는 확인해도 해제되지 않고 K18 삭제 질문으로만 풀린다 | 세션에서 임시로 넣은 알레르기가 영구히 갇히지 않게 함. `merge`는 순수 함수라 확인 결과를 인자로 받음 |
| K20 | 어머니 → 부모님 전환 턴에서 어머니 알레르기가 그룹 합집합으로 유지되는지 `tests/merge.test.mjs`(두 저장소)에서 확인한다 | 수령인 변경 시 baseline이 상태를 초기화하므로 기억 합집합이 유일한 경로 |

## 팀 결정이 필요한 것 (D)
| # | 질문 | 현재 기본값 |
|---|---|---|
| D1 | 작년에 드린 선물의 순위를 낮출 것인가? 공통 엔진에는 반복 회피 요인이 없다 | 순위는 그대로 두고 카드에 "작년 추석에 드린 선물" 표시만. 순위를 낮추려면 공통 엔진 변경이 필요하므로 팀 합의 필요 |
| D2 | `config/value-ladder.v1.json` 기준값 | 초안 값. 파일럿 2명 후 확정 |
| D3 | 앱 배포를 VibeHub로 할지 | 로컬 실험 우선. VibeHub 공개는 관리자 승인 필요 |
| D4 | 카탈로그 스냅샷 출처 | 팀 seed(`supabase/seed/products-amazon.json`)를 `data/`로 복사하고 SHA-256 기록 |

## 공통 코어 변경 요청
(필요해지면 여기에 적는다. b-pipeline 담당자는 공통 코어를 직접 수정하지 않는다.)
