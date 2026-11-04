# TRD — PASS B 역할 파이프라인

무엇을 만들지는 [PRD.md](PRD.md)가 기준이다. 이 문서는 **어떻게** 만들지만 정한다. 구조도: [architecture.png](architecture.png)

## 1. 전제: baseline 공통 코어와의 관계
b-pipeline은 `baseline/` 공통 코어 **위에** 얹는다. 공통 코어는 읽고 import만 하며, 수정하지 않는다.

| 공통 코어 (수정 금지) | b-pipeline이 쓰는 방법 |
|---|---|
| `src/index.mjs` `runTurn` | 모든 추천·질문·가상 예산 비교는 이 함수를 거친다. `kind: 'patch' \| 'view' \| 'what_if_budget'` |
| `src/parser.mjs` `parseRules` | ① 대화 이해의 빠른 경로 |
| `src/vendor/engine.mjs` | 순위의 유일한 결정자. 직접 정렬·점수 계산 금지. `budgetCost`·`rankProducts`는 계획기에서 **읽기 전용 계산**으로만 사용 |
| `src/vendor/counterfactual.mjs` `budgetAlternatives` | 가격 옵션 "올리기" 후보 |
| `src/vendor/catalog.mjs` `CATEGORIES`, `toEngineProduct` | 기억 키 어휘, 카탈로그 변환 |
| `src/vendor/allergens.mjs` `ALLERGEN_NAMES` | 알레르기 키 어휘 |
| `agents/runtime.mjs`, `registry.mjs`, `tests/` | 손대지 않는다. 공통 테스트가 계속 통과해야 한다 |

### 지켜야 할 기존 계약
- **진입점 유지:** `b-pipeline/index.mjs`는 `interpretMessage({text,state}) → {patch, questions, unresolved}`와 `createAgent({interpret}) → {id:'b-pipeline', runTurn}`를 계속 내보낸다(registry가 import함).
- **키 없을 때의 기본 동작:** `createAgent()`를 기본값으로 부르고 API 키가 없으면, 지금처럼 자유 발화에 `unresolved: true` 질문을 반환해야 한다. 공통 테스트 `unimplemented agent messages ask for clarification`이 이 동작을 검사한다.
- **새 진입점:** 전체 파이프라인은 별도 진입점 `pipeline/index.mjs`의 `createPipeline(deps)`로 제공한다.

## 2. 폴더 구조 (모두 `baseline/agents/b-pipeline/` 아래)
```
index.mjs                 # 기존 포트 유지 (interpretMessage, createAgent)
package.json              # 의존성 없음. 스크립트만
.env.example              # 키 이름만
.gitignore
CLAUDE.md · AGENTS.md     # 에이전트 규칙
.claude/settings.json     # 경로 가드 훅, 권한
.claude/hooks/guard-scope.mjs
scripts/check-scope.mjs   # b-pipeline 밖 변경 감지 (커밋·푸시 전 필수)
docs/                     # PRD, TRD, 구조도, 결정 기록, 킥오프
config/                   # *.v1.json 실험 중 고정값
pipeline/
  index.mjs               # createPipeline(deps)
  orchestrator.mjs        # runPipelineTurn, explainCards
  merge.mjs               # 조건 후보 병합
dialogue/agent.mjs        # ① 대화 이해
memory/read.mjs           # ② 기억 읽기
memory/write.mjs          # ② 기억 쓰기
memory/keys.mjs           # 기억 키 ↔ 엔진 상태 변환
rag/agent.mjs             # ③ 취향 매핑
rag/index.mjs             # 임베딩 인덱스 (메모리 내 코사인 + 키워드 대체)
planner/                  # contrast.mjs, memory-cf.mjs, value-ladder.mjs, factsheet.mjs
explainer/agent.mjs       # ④ 설명 생성 (+ template.mjs)
verifier/agent.mjs        # ⑤ 검증 (+ banned-words.mjs)
indexer/agent.mjs         # ⑥ 카탈로그 색인 (오프라인)
llm/                      # index.mjs, gemini.mjs, openai-compatible.mjs, fake.mjs
db/                       # schema.sql, store.mjs (node:sqlite), memory-store.mjs (테스트용)
data/                     # 카탈로그 스냅샷 + SHA-256
server/index.mjs          # node:http, SSE
app/                      # 기존 mobile/ UI 복사본 (§9)
eval/                     # simulator.mjs, personas/, metrics.mjs
tests/*.test.mjs          # node:test, 네트워크 금지
```

## 3. 기술 선택
- **런타임:** Node.js 22.13 이상, ESM `.mjs`. baseline처럼 **외부 패키지 없이** 시작한다.
  - DB: `node:sqlite`
  - 서버: `node:http`
  - LLM: 내장 `fetch`
- **새 의존성:** 필요하면 사람에게 먼저 묻고, `b-pipeline/package.json`에만 추가한다.
- **앱:** 기존 `mobile/` Expo 앱을 `app/`으로 복사해 사용한다. 의존성은 `app/package.json` 그대로다.

## 4. 한 턴의 흐름
`runPipelineTurn({ownerId, sessionId, recipientId?, request, experiment})`

1. **세션 로드:** DB에서 세션을 불러온다(`version` 포함). 클라이언트가 보낸 세션은 신뢰하지 않는다.
2. **의도 분기:**
   - `message` → 3단계
   - `patch`(칩 편집) → 4단계
   - `view` → 5단계
   - `what_if_budget` → 계획기만 실행(세션 불변)
   - `feedback`, `memory_edit` → 기억 쓰기 후 5단계
3. **1단계 이해 (병렬):**
   - ① 대화 이해: `parseRules` → 해결 안 되면 LLM 1회 → `{patch, questions, unresolved, critiques, memoryCandidates, mentionedRecipients}`
   - ② 기억 읽기: 수령인 확인 후 확정 기억 → 조건 후보 + 출처
   - ③ 취향 매핑: 엔진 어휘 밖의 자유 취향(`hobby:hiking` 등) → `category:<c>` 후보
4. **병합 (`merge.mjs`):**
   - 우선순위: 이번 발화 > 확정 기억 > 선물 이력에서 나온 선호
   - 알레르기·제외 카테고리는 합집합
   - 결과는 `patch` 1개 + `provenance` 맵(필드 → 출처: utterance | memory:<id> | rag)
   - 수령인이 바뀌는 턴에는 baseline이 이전 조건을 초기화하므로, 새 수령인의 기억 필드를 같은 patch에 포함한다.
5. **공통 코어:** `runTurn({session, request:{kind:'patch', patch, expectedVersion}, products})`
   - `question`이면 SSE `question`으로 보낸다.
   - `recommendation`이면 SSE `cards`로 보낸다(이유 태그는 템플릿).
6. **저장:** 세션을 저장한다(CAS: `UPDATE … WHERE version = ?`, 실패 시 `version_conflict`).
7. **2단계 `explainCards()` (비동기):** 계획기 → Factsheet → ④ → ⑤ → SSE `explanations`
8. **기억 쓰기 (비동기):** 세션 종료 신호나 구매·피드백 때 기억 후보를 모은다. SSE `memory_prompt`("기억할까요?")를 보내고, 사용자가 수락하면 저장한다.

**LLM 호출 상한:** 한 턴에 ① 1회 + ③ 임베딩 1회 + ④ 1회(+재생성 1회).

## 5. 기억 설계
### 5.1 SQLite 스키마 (`db/schema.sql`)
실제 파일이 기준이다. 아래는 그 요약이며, 이전 초안과 다른 점은 `sessions`(K8)와 CHECK 제약이다.
```sql
create table recipients(
  id text primary key, owner_id text not null, name text not null,
  aliases text not null default '[]',        -- JSON: ["엄마","어머님"]
  group_name text,                           -- '부모님'
  budget_cap_krw integer check (budget_cap_krw is null or budget_cap_krw > 0), -- "올리기" 차단에만 사용 (null = 없음)
  price_sensitivity text not null default 'balanced' check (price_sensitivity in ('value','balanced','quality')),
  created_at text not null);
create table memories(
  id text primary key, recipient_id text not null references recipients(id) on delete cascade,
  key text not null,          -- memory/keys.mjs 어휘
  polarity integer not null check (polarity in (1,-1)),
  strength real not null default 0.7 check (strength >= 0 and strength <= 1),
  status text not null check (status in ('confirmed','suggested')),
  source text not null check (source in ('explicit','feedback','purchase')),
  evidence text not null check (length(evidence) between 1 and 200), -- 근거 문장(사용자 발화 그대로)
  created_at text not null, last_used_at text);
create table gift_history(
  id text primary key, recipient_id text not null references recipients(id) on delete cascade,
  product_id text not null, occasion text, given_at text,
  satisfaction integer check (satisfaction is null or satisfaction between 1 and 5)); -- null = 아직 모름
create table sessions(
  id text primary key, owner_id text not null,
  version integer not null check (version >= 0),
  state text not null,                       -- baseline 세션 상태 JSON만 (validateSession 통과)
  meta text not null default '{}',           -- JSON: {recipientId, sensitivity, experiment, provenance}
  updated_at text not null);
create table events(  -- 실험 로그 (원문 발화 저장 안 함)
  id integer primary key, session_id text, type text not null,
  payload text not null default '{}', at text not null);
```
- `sessions`에는 `recipient_id`·`experiment` 컬럼이 없다. 두 값은 `meta`에 둔다(결정 K8).
- 인덱스: `recipients(owner_id)`, `memories(recipient_id)`, `gift_history(recipient_id)`, `events(session_id)`.
모든 조회는 `owner_id`로 거른다. 다른 사용자의 수령인·기억이 섞이면 버그다(AC6).

### 5.2 기억 키 → 엔진 상태 (`memory/keys.mjs`)
| 기억 키 | 엔진 상태 필드 |
|---|---|
| `pref:category:<c>` (c ∈ CATEGORIES) | `preferences += 'category:<c>'` |
| `pref:less_sweet`, `pref:unsweetened` | `preferences += 'less_sweet' \| 'unsweetened'` |
| `dislike:category:<c>` | `excluded_categories += c` |
| `allergy:<a>` (a ∈ ALLERGEN_NAMES) | `excluded_ingredients += a` |
| `constraint:packaging:<formal\|basic>` | `packaging` |
| `hobby:<자유어>` | 직접 반영 안 함 → ③ RAG가 `category:<c>`로 매핑 |

이 표에 없는 키는 저장을 거부한다. LLM이 어휘 밖 키를 내면 버린다.

### 5.3 쓰기 규칙 (`memory/write.mjs`)
1. **명시 진술:** 세션 끝에 확인을 받으면 `confirmed`.
2. **알레르기:** 명시 진술로만 생성한다. 감쇠·추론·피드백으로 생성하거나 삭제하지 않는다. 사용자의 명시적 삭제만 허용한다.
3. **행동 피드백:** 찜·제외는 `suggested`로 저장한다. 서로 다른 세션에서 같은 방향이 2회 나오면 `memory_prompt`로 확인을 받는다.
4. **추론 금지:** 나이·성별·관계·건강 상태로 키를 만들지 않는다.
5. **충돌:** 새 진술이 `confirmed`와 반대면 덮어쓰지 않고 질문을 만든다.
6. **구매:** `gift_history`에 저장한다. 다음 세션 시작 때 만족도를 한 번 묻는다.
7. **삭제:** 행을 실제로 지운다.

### 5.4 수령인 찾기
- 별칭(엄마·어머니·어머님)과 `group_name`(부모님)으로 찾는다.
- "부모님"이 두 분 함께인지 한 분인지 모호하면 칩으로 묻는다(`두 분 함께`/`어머니만`/`아버지만`).
- 함께인 경우: 알레르기·비선호는 합집합, 선호는 둘 중 하나라도 해당하면 포함한다.
- baseline 상태의 `recipients`에는 표시 이름(예: `['부모님']`)을 넣는다. 기억 연결은 `recipientId`로 한다.

## 6. 설명 계획기 (결정적, LLM 0회)
모든 계산은 공통 코어를 다시 호출해서 얻는다. 실제 세션은 바꾸지 않는다.

- **대조 (`contrast.mjs`):** 1위와 2위의 엔진 사실 차이(`sweetness`, `rating_count`, `budgetCost`, 카테고리, 일치한 선호)에서 큰 것 1개를 고른다.
- **기억 반사실 (`memory-cf.mjs`):** 사용된 확정 기억 m마다 다음을 실행한다.
  1. m에서 나온 필드만 뺀 가상 상태를 만든다(알레르기 기억은 제외).
  2. 세션 복제본으로 `runTurn({kind:'view'})`을 실행한다.
  3. 1위가 바뀌면 `{memoryId, newTopId}`를 기록한다. 바뀐 것이 여러 개면 하나만 고른다.
- **가격·만족 옵션 (`value-ladder.mjs`, 설정 `config/value-ladder.v1.json`):**
  - **올리기 후보:** `budgetAlternatives(products, state)`의 대안 중 `effect`가 `top_changed` 또는 `first_match`인 것만 쓴다. 다음 조건을 만족할 때만 채택한다.
    - 적합도 상승: 새 1위의 엔진 `score` − 현재 1위 `score` ≥ `minScoreGain[sensitivity]`, 또는
    - 인기 상승: 1만 원당 `popularity` 상승 ≥ `minPopularityGainPer10k[sensitivity]`
  - **아끼기 후보:** `rankProducts(products, state)`의 전체 순위에서 현재 1위보다 `budgetCost`가 낮고 `score`가 같은 상품 중 가장 싼 것을 찾는다. 그 비용으로 `what_if_budget`을 다시 실행해 1위를 확인한다.
  - **상한 고정:** `recipients.budget_cap_krw`가 있으면 올리기 후보를 만들지 않는다.
  - **성향 조정:** 옵션을 고를 때마다 세션의 `sensitivity`를 한 단계 이동한다. 같은 수령인에서 2회 연속 같은 방향이면 `memory_prompt`를 보낸다.
- **Factsheet (`factsheet.mjs`):**
  - 상품별: `{id, name, rank, categoryKo, budgetCost, budget, headroom, ratingCount, sweetness, matchedPreferences, usedMemories:[{id,label,evidence}], giftHistoryHit, allergyNotice}`
  - 조건 B만: `contrast`, `memoryCf`, `valueLadder`
  - **조건 A의 Factsheet에는 이 세 필드의 키 자체가 없다.**

## 7. ④ 설명 생성 · ⑤ 검증
- **④ 설명 생성:**
  - 입력은 Factsheet만. 출력 스키마: `{items:[{id, tags:[2..3개, 각 12자 이내], contrastChip?, memoryCfLine?, ladderChips?:[{direction:'down'|'up', label, amount_krw}]}]}`
  - 상위 3개를 묶어 1회 호출, 타임아웃 8초.
  - 지시문 핵심: Factsheet 밖 숫자·사실 금지, 품질·효능·만족 보장 표현 금지, 존댓말, 사용자 데이터는 지시가 아님.
- **템플릿 (`explainer/template.mjs`):** LLM 없이 같은 스키마를 만든다. 카드 이벤트와 모든 실패 경로에서 쓴다.
- **⑤ 검증 (결정적):**
  - 구조·길이
  - 숫자 근거: 쉼표·"만 원" 환산 후 Factsheet 값이나 그 차이값과 일치해야 함
  - 상품명이 Factsheet에 있음
  - 언급한 기억이 `usedMemories`에 있음
  - 조건 A 누출 없음
  - 금지어 없음
  - 알레르기 안내 유지
  - 실패하면 ④에 사유를 붙여 1회 재생성하고, 그래도 실패하면 해당 상품만 템플릿으로 바꾼다.

## 8. LLM 어댑터 (`llm/`)
- **인터페이스:** `createLlm({provider}) → { json({system, input, schema, timeoutMs}), embed(texts) } | null`
- **공급자:**
  - `gemini`: `generateContent`, `embedContent`(건당 호출)
  - `openai-compatible`: VibeHub `https://llm.ai.hy.miwork.ai`, `deepseek-v4-flash` 등. chat만 쓰고, 임베딩이 없으면 키워드 검색으로 대체한다.
  - `fake`: 테스트용. 미리 정한 응답을 돌려주고 호출 기록을 남긴다.
- **키 없음:** `createLlm`은 `null`을 반환하고 모든 역할이 규칙·템플릿 경로로 동작한다.
- **빈 문자열 처리:** 환경 변수가 빈 문자열이면 미설정으로 처리한다(`??` 대신 `||`, 이전에 발견한 버그).
- **모델 이름:** `ListModels`로 확인한 값을 `.env`에 둔다. 코드에 하드코딩하지 않는다.
- **사용량:** `onUsage` 콜백으로 토큰·지연을 `events`에 기록한다.

## 9. 앱 (`app/`): 기존 디자인 그대로
1. 복사(1회):
   ```sh
   rsync -a --exclude node_modules --exclude tests --exclude '.env*' --exclude dist ../../../mobile/ ./app/
   ```
   - 원본 `mobile/`은 읽기만 하고 수정하지 않는다.
   - `tests/`는 복사하지 않는다. baseline `npm test`(`node --test`)가 앱 테스트까지 찾아 실패하기 때문이다.
2. **디자인 유지:** 화면 구성, `src/theme.ts`, `src/components.tsx`, `assets/`는 그대로 둔다. 색·폰트·간격·아이콘을 바꾸지 않는다.
3. **바꾸는 것:** 서비스 계층만 바꾼다. `app/src/services/pipelineChatService.ts`를 새로 만들어 `EXPO_PUBLIC_PIPELINE_URL`의 `server/`에 연결하고, SSE `cards` → `explanations` 순서로 화면을 갱신한다.
4. **새 UI 요소:** 기존 컴포넌트를 재사용해 만든다. 이유 태그, 칩, 반영 한 줄, "기억할까요?", [수정].
5. **로그인:** 실험용 참가자 ID 입력으로 대체한다(정식 인증은 범위 밖).

## 10. 서버 API (`server/index.mjs`)
| 메서드·경로 | 본문 | 응답 |
|---|---|---|
| `POST /chat` | `{ownerId, sessionId, recipientId?, request, experiment}` | SSE `question` \| `cards` → `explanations` \| `memory_prompt` \| `error` |
| `GET /recipients?ownerId=` | — | 수령인 목록 |
| `GET /memory/:recipientId?ownerId=` | — | 기억·선물 이력 |
| `PUT/DELETE /memory/:id` | `{ownerId, …}` | 수정·실제 삭제 |
| `POST /memory/confirm` | `{ownerId, candidates[]}` | 수락한 후보 저장 |
| `POST /feedback` | `{ownerId, productId, action}` | chosen \| dismissed \| purchased \| satisfaction |

- 입력은 전부 검증하고 본문 크기를 제한한다.
- 로그·trace·events에 원문 발화를 남기지 않는다.
- 로컬 실험 전용이다. 공개 배포에는 인증이 필요하다(범위 밖).

## 11. 테스트 (`tests/*.test.mjs`, 네트워크 금지)
- **PRD AC 대응:** AC1~AC15를 단위·통합 테스트로 작성한다. AC16은 `server/` 로컬 측정 스크립트로 확인한다.
- **필수 불변 검사:**
  - 기억 없는 파이프라인 = baseline `runTurn` 결과
  - A/B에서 cards 동일
  - 알레르기는 어떤 경로로도 감소하지 않음
  - 반사실 문장 = 재계산 결과
  - 다른 owner의 기억 미사용
  - 키가 없으면 `createAgent()` 기본 동작 유지
- **실행:**
  - `baseline/`에서 `npm test`(공통 + b-pipeline 테스트)
  - `b-pipeline/`에서 `npm test`

## 12. 환경 변수 (`.env.example`)
```
LLM_PROVIDER=          # gemini | openai-compatible | (비우면 LLM 없음)
GEMINI_API_KEY=
GEMINI_MODEL=
GEMINI_EMBED_MODEL=
OPENAI_COMPAT_BASE_URL=https://llm.ai.hy.miwork.ai
OPENAI_COMPAT_API_KEY=
OPENAI_COMPAT_MODEL=
PIPELINE_DB_PATH=.data/pipeline.sqlite
PORT=8787
```

## 13. 작업 범위 가드 (결정적 장치)
- **편집 차단:** `.claude/hooks/guard-scope.mjs`가 Edit/Write/MultiEdit/NotebookEdit의 경로가 `b-pipeline/` 밖이면 차단한다.
- **커밋·푸시 차단:** `git commit`·`git push` 전에 `scripts/check-scope.mjs`를 실행해, 작업 트리·스테이징·푸시할 커밋에 `baseline/agents/b-pipeline/` 밖 경로가 있으면 차단한다.
- **사람이 직접 커밋할 때:** `npm run check:scope`를 먼저 실행한다.
