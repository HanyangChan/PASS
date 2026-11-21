# 새 상황 단어(병문안·집들이·송별 등)를 엔진이 읽게 하려면 — 수정 계획

작성 2026-11-21 · 브랜치 `data/naver-catalog-extra` · **갱신 2026-11-21: 1~5번(상황 표, 태그 매핑, 인식, 빠른 답변, 품목어 제외)은 구현했다. 구현 결과는 맨 아래 "구현 결과".** 6번(모바일 표시)과 "먼저 정해야 할 것"은 그대로 남아 있다.

## 지금 구조 (엔진은 상황 단어 5개만 안다)

상품의 `occasions` 태그(`holiday`·`birthday`·`exam`·`flower`)는 이미 `lib/catalog-source.mjs:47`에서 엔진 상품까지 그대로 넘어온다. 막혀 있는 곳은 "사용자 말 → 상황 단어 → 태그" 구간이다.

| 구간 | 위치 | 현재 | 새 상황에서 생기는 문제 |
|---|---|---|---|
| 말에서 상황 뽑기 | `lib/engine.mjs:101-104` (`extract`) | 정규식이 `추석`·`설`·`명절`·`생일`만 인식 | "집들이 선물", "병문안 가는데"는 `occasion`이 비어 있는 채로 남음 |
| 말에서 상황 뽑기 (a-router) | `baseline/agents/a-router/parser.mjs:150-158` (`occasionOf`, 닫힌 단어 정규식) | 명절·설날·추석·생일·합격·기념일·수험·개업·졸업·입학·취업·승진·이직·퇴직·은퇴·집들이·결혼·출산·환갑·칠순·돌잔치·크리스마스 등만 `occasion`으로 잡음 | 병문안·퇴원·송별(회)·프러포즈·약혼·전시회·공연·연주회·수상·마니또·경품·여행·답례·반려동물 입양·100일은 `occasion`이 `null`. 이 파서가 위 `extract`보다 먼저 쓰이므로 두 곳을 같이 고쳐야 함 |
| 단어 → 태그 | `lib/ranking.mjs:27-28` (`OCCASION_TAGS`, `occasionFit`) | 5개 단어 → 3개 태그(holiday·birthday·exam). `합격`·`기념일`·`집들이`·`출산`은 파서가 잡아도 태그가 없음 | 파서가 `집들이`를 잡아도 `invitation` 태그 상품에 가점이 없음(2026-11-21 확인: 새 상황 태그 상품이 상위 3개에 들어온 경우는 감사·프로젝트 완료의 1/3뿐이고 우연). 새 단어는 `occasion`이 비어 있어 모든 상황에서 같은 결과(식품·데코·커피차)가 나옴 |
| 빠른 답변 패턴 | `lib/single-gift.mjs:7-9` (`giftOccasions`, `occasionReplyPattern`), `api/worker.mjs:43` | `명절·생일·합격·기념일·수험` + 설날류 | "병문안이야"라고 답해도 패턴에 안 걸려 일반 경로로 감 |
| 동의어 정리 | `lib/condition-compat.mjs:5-6` (`normalizeGiftOccasion`) | 설날·추석·한가위·설 → 명절 | 송별회/송별, 집들이/초대처럼 같은 상황의 다른 표기가 따로 집계됨 |
| 선택 칩 | `mobile/src/ChatTools.tsx:~233` (`giftOccasions` 재사용) | 5개 칩 + 직접 입력 | 칩은 그대로 둬도 되지만 직접 입력이 위 구간을 탈 수 있어야 함 |
| 품목 필터 | `lib/item-filter.mjs:18`, `lib/item-terms.mjs` | 상품의 `seed_keywords`에서 품목어를 뽑음 | 새 검색어의 상황 단어(`병문안`, `경품`, `송별`…)가 품목어로 등록돼, "병문안 선물"이라고만 해도 병문안 단어가 든 상품으로 좁혀질 수 있음 (`ITEM_FILTER=on`일 때) |
| 제목 충돌 | `lib/ranking.mjs:30-31` (`SPECIFIC_OCCASIONS`) | 개업·승진·수능 제목만 다른 상황에서 감점 | 새 상황 전용 상품(예: "합격 떡")이 다른 상황에서 감점 없이 노출 |
| LLM 모드 A~D | `lib/llm.mjs:8` | `occasion`은 자유 텍스트 | 구조는 그대로. LLM이 뽑은 단어도 같은 정규화·매핑을 타면 됨 |

엔진의 점수식(`engine.mjs:75-77, 89`)은 `occasionFit`이 true면 +1이고 `hasContextualVotes`일 때 동점 정렬에 쓴다. 새 태그가 연결되면 점수 코드를 건드리지 않고도 같은 방식으로 작동한다.

## 수정 계획 (순서대로)

**1. 상황 표를 한 곳에 둔다 — 새 파일 `lib/occasions.mjs`**
- 항목: `id`(태그, 예 `hospital_visit`), `label`, `words`(말에서 잡을 표기들), `group`.
- 32개 신규 상황 + 기존 4개(`holiday`·`birthday`·`exam`·`flower`)를 한 표로. `OCCASION_TAGS`, 빠른 답변 패턴, 동의어 정리, 정규식이 모두 이 표에서 만들어지게 한다.
- `occasion-seeds.v2-extra.json`의 id·label과 어긋나지 않는지 확인하는 테스트를 같이 둔다(표의 id 집합 ⊇ `products-kr.json`의 모든 occasions 태그).

**2. `lib/ranking.mjs`: `OCCASION_TAGS`를 표에서 파생**
- 한 단어가 여러 태그를 가질 수 있게 `occasionFit`을 "단어 → 태그 배열"로 바꾼다. 예: `축하`는 `award`·`exhibition`·`publication`을 모두 포함, `합격`은 `exam`+`cert_exam`, `기념일`은 `couple_100days`·`proposal`·`engagement`.
- `SPECIFIC_OCCASIONS`는 상품 제목에 상황이 박힌 경우만 추가(예: `송별`·`병문안`·`프러포즈`·`출산`). 먼저 데이터에서 실제로 문제 되는 제목을 확인한 뒤 필요한 것만 넣는다.

**3. `lib/engine.mjs` `extract`와 `baseline/agents/a-router/parser.mjs`: 새 상황 인식**
- 파서(`parser.mjs:150-158`)의 `occasionOf`와 두 정규식에 새 단어를 같은 표에서 만들어 넣는다. 이미 잡히는 단어(집들이·출산·퇴직 등)는 표에 태그만 연결하면 바로 가점이 붙는다.
- `(명절|생일)` 정규식을 표의 `words`로 생성. 기존 `추석|설` 분기와 우선순위는 그대로 둔다.
- 모호한 단어는 맨 단어로 매칭하지 않는다: `사과`(과일/사과하다), `백일`(아기 백일/연인 100일), `첫`, `전시`, `응원`. `미안해서 선물`, `사과의 선물`, `100일 선물`처럼 문맥 패턴이 있을 때만 잡는다. 시드 파일 노트가 같은 문제를 이미 피해 갔다.

**4. `lib/single-gift.mjs`, `lib/condition-compat.mjs`**
- `giftOccasions`(칩과 빠른 답변)는 기존 5개를 유지하고, `occasionReplyPattern`에는 표의 `words`를 추가해 "병문안이야"가 걸리게 한다. 칩에 32개를 모두 올리지는 않는다(모바일 화면이 길어짐). 상위 몇 개를 칩에 올릴지는 결정이 필요하다.
- `normalizeGiftOccasion`을 표 기반으로 확장: 송별회→송별, 초대→집들이 같은 정규 표기 하나로 합친다. 어느 쪽을 대표로 삼을지 정해야 한다.

**5. `lib/item-terms.mjs`: 상황 단어를 품목어에서 제외**
- 파이프라인 `config.mjs`의 `OCCASION_WORDS`(현재 40여 개)를 `lib/item-terms.mjs`의 `GENERIC_WORDS`(또는 `ITEM_STOPWORDS`)로 옮기고, 파이프라인은 거기서 가져다 쓰게 한다. 한 목록이 선정(select)과 품목 필터를 같이 다루는 구조라 이중 관리를 피한다.
- 이 단계가 빠지면 `ITEM_FILTER=on`에서 "경품"·"병문안"이 품목으로 취급된다.

**6. 모바일 표시 (선택)**
- `mobile/src/cardReason.ts:22`는 명절 선물세트만 이유 문구를 만든다. 새 상황에서 `occasionFit`이 true일 때 "병문안에 어울리는 상품" 같은 문구를 붙일지는 UI 결정 사항이라 후순위.
- `mobile/src/domain.ts`의 `occasion`은 `string | null`이라 타입 변경은 없다.

**7. 테스트**
- `tests/ranking.test.mjs`: 새 단어마다 `occasionFit` true/false 쌍, 다중 태그 단어.
- `tests/engine.test.mjs`: "집들이 선물 추천", "병문안 갈 때 줄 선물", "미안해서 주는 선물"이 올바른 상황으로 잡히고, "사과 한 상자", "백일 떡"은 잡히지 않는 반례.
- `tests/catalog-source.test.mjs`: `products-kr.json`의 모든 태그가 표에 있음.
- 기존 `npm test`(176+3개)가 그대로 통과해야 한다. `lib/test-dialogues.json`의 추석·설 대화는 결과가 바뀌면 안 된다.

## 먼저 정해야 할 것

1. **주류 태그 규칙.** v1 결정(2026-11-13)은 주류를 명절에만 붙이는 것인데, 새 시드에는 `초대 선물 와인`, `축하 와인 선물`, `와인 선물세트`, `샴페인잔 세트`(잔은 주방) 같은 검색어가 있다. 규칙을 그대로 두면 이 상품들이 새 상황 태그를 잃는다. 그래서 `enrich.mjs`는 extra 실행에서 주류를 `enrich-held.extra.json`의 `held_liquor`로 보류한다. 규칙을 상황별 허용 목록(예: 초대·축하·약혼·재회·프러포즈는 허용)으로 바꿀지 결정이 필요하다. 엔진 쪽 `avoid_wine`·`excluded_categories`는 이미 있어 별도 수정이 필요 없다.
2. **칩에 올릴 상황 수**와 **정규 표기**(송별/송별회 등).
3. **새 상황에도 명절식 가중치가 필요한가.** 지금 `holidaySet` 정렬 가중(`engine.mjs:46,76,88`)은 명절 전용이다. 새 상황은 `occasionFit` +1만으로 충분한지 추천 결과를 보고 판단한다.

## 이 브랜치의 데이터 쪽 준비 (이미 반영)

- `occasion-seeds.v2-extra.json`을 읽는 `SEEDS=extra` 모드, 그룹 단위 수동 저장, 상황 태그만 합치는 `merge-extra.mjs`. 사용법은 `scripts/catalog/README.md` 참고.
- 엔진이 읽는 필드(`occasions`, `seed_keywords`, `gift_set`, `alcohol`)와 스키마는 바뀌지 않는다.

## 구현 결과 (2026-11-21)

- **`lib/occasions.mjs`** (새 파일): 36개 상황(원래 4개 + v2-extra 32개)의 id·단어·모호한 단어를 한 표로 둔다. `tagsForOccasion`, 파서용 `extractableOccasionSource`.
- **`lib/ranking.mjs`:** `OCCASION_TAGS`를 표에서 파생. 한 단어가 여러 태그를 가질 수 있다(합격 → exam·cert_exam). `SPECIFIC_OCCASIONS`의 수험 항목에 시험·자격시험을 추가.
- **`lib/engine.mjs` `extract`:** 새 단어를 "선물" 앞 또는 문장 끝의 통단어로 인식. 사과·백일은 뽑지 않는다.
- **`baseline/agents/a-router/parser.mjs`:** 단어 목록 사본(`EXTRA_OCCASIONS`)을 파서 안에 둔다(baseline 독립성 유지). `tests/occasions.test.mjs`가 표와 어긋나면 실패한다.
- **`lib/single-gift.mjs`:** "선물하는 날은?" 답변 패턴이 새 단어를 받는다. 칩 목록(`giftOccasions`)은 그대로.
- **점수식은 바꾸지 않았다.** 상황 일치는 기존대로 +1이다.

확인 결과(5만 원, `CATALOG_SOURCE=web`): 새 단어가 게스트·서버 두 경로에서 모두 `occasion`으로 잡히고, 받는 사람 카테고리와 겹치면 해당 태그 상품이 상위 3개에 들어온다(부모님 병문안 3/3, 부모님 퇴원 3/3, 직장동료 감사 2/3, 친구 집들이 2/3, 친구 첫만남 3/3). 겹치지 않으면(친구 송별·공연·전시회, 여자친구 프러포즈 등) 받는 사람 카테고리 점수가 앞서 0/3이다. 상황 일치 가중치를 올릴지는 위 "먼저 정해야 할 것" 3번에 그대로 남아 있다.
