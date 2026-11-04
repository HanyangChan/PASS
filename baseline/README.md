# PASS 공통 베이스라인 v0.1

첨부된 다섯 설계가 함께 사용할 수 있는 실행 가능한 추천 코어다. 기존 앱을 대체하지 않으며 `baseline/`만으로 실행된다. 네트워크·API 키·패키지 설치가 필요 없다. Node.js 22.13 이상에서 사용한다.

```sh
cd baseline
npm test
npm run demo
```

## 고정하는 공통 흐름

사용자 요청 → 입력·버전 검증 → 조건 후보 해석 → 조건 검증·세션 갱신 → 부족하면 질문 → PASS 엔진 추천·정렬·계산 → 하드 제약 재검증 → 사실 기반 템플릿 응답.

- `src/contracts.mjs`: 요청 상태와 상품 입력 검증, 세션 생성.
- `src/parser.mjs`: 좁고 보수적인 한국어 규칙 파서. 처리하지 못한 내용은 추측하지 않고 질문한다.
- `src/index.mjs`: `runTurn`, 세션 상태, 질문, 가상 예산 비교, 결과 검증, 설명.
- `src/vendor/`: 기존 `PASS-auth/lib` 엔진과 의존 파일의 독립 스냅샷. 원본·해시를 `provenance.json`에 기록했다. 순위·금액·예산 대안 계산은 여기서만 한다.
- `examples/`: 고정 합성 상품 3개와 실행 예제. 실상품 데이터가 아니다.
- `agents/`: 다섯 설계별 작업 폴더, 공통 연결기, 실행 예제 선택. [작업 안내](agents/README.md).
- `tests/`: 공통 수용 기준. 브랜치에서도 같은 검사를 실행한다.

## 사용 계약

```js
import {createSession, runTurn} from './src/index.mjs';
const output = await runTurn({
  session: createSession('session-1'),
  request: {
    kind: 'patch', expectedVersion: 0,
    patch: {
      recipients: ['어머니'], quantity: 1, same_product: true,
      budget: {amount_krw: 50000, scope: 'per_set', shipping_included: true}
    }
  },
  products // examples/catalog.mjs의 엔진 상품 계약 참조
});
```

요청은 `message`(+`text`), `patch`(+`patch`), `view`, `what_if_budget`(+`amount_krw`) 네 종류다. 모두 `expectedVersion`을 전달한다. 반환 `kind`는 `question`, `recommendation`, `comparison`이다. 상태 변경 때만 버전이 증가하며 조회·가상 비교는 세션을 바꾸지 않는다. 비교 결과의 `evaluatedState`만 가정 예산을 가진다.

수령인 목록이 바뀌면 이전 수령인의 단기 조건을 초기화하고 이번 요청의 명시적 조건만 적용한다. 현재 계약에서 수령인은 화면 표시 문자열이다. 계정별 장기 기억을 연결할 때는 별도 안정적인 `recipientId`가 필요하다.

자유 발화 확장은 선택적인 `interpret({text,state})` 함수로 주입한다. 출력은 `{patch, questions: string[], unresolved: boolean}`이다. 규칙으로 해결하지 못했을 때 한 번 호출하며, 반환 후보도 동일하게 검증한다. 확정할 수 없으면 `unresolved: true`로 질문한다. LLM 공급자·모델·재시도·비용·타임아웃 정책은 브랜치에서 구현한다. 베이스라인 실행의 LLM 호출은 0회다.

## 의도적인 범위

이 산출물은 앱·인증 서버·DB를 포함한 전체 서비스가 아니라 공통 백엔드 코어다. 인증, 상품 로딩, 사용자별 저장, 원자적인 버전 비교 후 저장(CAS)은 호스트의 책임이다. 함수의 버전 검사는 두 동시 요청의 저장 충돌까지 해결하지 않는다. 서버에 연결할 때는 인증된 소유자의 세션을 서버에서 불러와야 한다. 클라이언트 세션을 그대로 신뢰하지 않는다.

공통 세션 기억은 구현했지만 장기 기억 저장은 안마다 정책·스키마가 달라 포함하지 않았다. 외부 문서·검색 결과는 데이터로 취급하며 확장 파서가 내놓은 후보를 검증한다. 이 구조만으로 LLM의 의미 해석 오류를 모두 탐지하지는 않는다.

알레르겐 정보는 기존 엔진의 선언·추정 태그 기준이다. 미표기 성분의 안전을 보장하지 않으며 기존 성분표 확인 안내를 유지한다. 설명은 엔진의 이름·비용·예산 사실로만 만든다. 이미지, SSE, RAG, 벡터/그래프 검색, 반성 루프, 합성 사용자, 실제 Gemini 호출은 각 브랜치 범위다.

설계별 대응과 분기 원칙은 [공통 범위](docs/common-scope.md), 검증 기준은 [수용 기준](docs/acceptance.md)을 참조한다.

## 에이전트 작업 시작

`agents/a-router`, `b-pipeline`, `c-attribution`, `d-langgraph`, `e-tiered` 중 담당 폴더에서 시작한다. 각 폴더의 `index.mjs`는 공통 코어의 해석기 확장 지점에 연결된 시작 틀이다.

```sh
npm run demo:agent -- a-router
npm test
```

에이전트 구성·브랜치·확장 한계는 [agents 안내](agents/README.md)를 따른다.
