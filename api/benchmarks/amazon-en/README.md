# PASS 영문 Amazon 본실험 재현

측정 설계와 수정 후 결과는 [작업 기록](../../../docs/verification/deepseek-amazon-en-2026-11-23/README.md)에 있다. 이 실행기는 같은 카탈로그와 120개 합성 시나리오를 사용해 실제 Worker의 A/B/C 경로를 호출한다.

## 데이터 준비

[Kaggle Amazon Products Sales Dataset 2023](https://www.kaggle.com/datasets/lokeshparab/amazon-products-dataset)의 ZIP을 로컬에 둔다. Python 3.11 이상과 Node.js 22.13 이상을 사용한다. 명령은 저장소 루트에서 실행한다.

```sh
python3 api/benchmarks/amazon-en/prepare.py data/amazon-products-dataset.zip data/amazon-en/catalog
node api/benchmarks/amazon-en/run.mjs --validate
```

고정 시드는 `pass-amazon-en-v1`이다. 기본 매핑은 원본 대분류 비율로 선정한 영문 상품 300,000개의 ASIN을 유지한 채, 원본 소분류와 상품명 근거가 있는 문구·홈데코·음향기기 분류를 보완한다. 기존 카탈로그를 재현하려면 준비 명령에 `--mapping legacy`를 추가하고 다른 출력 폴더를 지정한다. 실행기는 두 카탈로그 버전의 카운트와 SHA-256을 검사한다.

`--validate`는 모델을 호출하지 않고 과제 수와 상품군·배송비 포함 예산·재고·납기에 맞는 카탈로그 후보가 없는 요청을 집계한다. 보고서에는 전체 성공률과 후보가 있는 요청의 성공률이 함께 표시된다.

## 회귀 평가

실호출에는 서버 `api/.dev.vars` 또는 프로세스 환경의 `LLM_API_KEY`와 OpenAI 호환 공급자 설정이 필요하다. 기본 모델은 DeepSeek V4 Flash이며 백만 토큰당 입력 $0.06·출력 $0.17을 적용한다. GPT-5.6 Luna는 `--model gpt-5.6-luna`로 선택하며 백만 토큰당 입력 $0.20·출력 $1.20을 적용한다. 캐시 입력에는 같은 입력 단가를 적용한다.

```sh
node api/benchmarks/amazon-en/run.mjs --mode BC --data data/amazon-en/bc
node api/benchmarks/amazon-en/run.mjs --mode A --data data/amazon-en/a
node api/benchmarks/amazon-en/report.mjs data/amazon-en/a data/amazon-en/bc --output data/amazon-en/report
node api/benchmarks/amazon-en/run.mjs --model gpt-5.6-luna --mode AB --data data/amazon-en/luna-ab
node api/benchmarks/amazon-en/report.mjs data/amazon-en/luna-ab
```

`run.mjs`는 기본적으로 `ABC`를 실행한다. `A`, `B`, `C`, `AB`, `BC`, `ABC`를 지정할 수 있다. 앱 코드, 카탈로그, 시나리오, 채점 버전 및 실행기 변경을 메타데이터에 기록한다. 같은 서명의 중단된 실행은 저장된 행 다음부터 재개한다. 다른 수정본으로 시험할 때는 새 결과 폴더를 사용한다.

기본 120개 시나리오는 개발 중 개선에도 사용한 회귀 평가 세트다. 세 반복은 동일 문장의 일관성을 측정한다.

## 비공개 평가

평가 대상 Git 커밋을 먼저 고정한다. 새 정답 ASIN·문구·질문 패턴을 고른 뒤 `data/` 아래의 로컬 JSON에 보관한다. 이전 사례의 말투만 바꾼 문장과 같은 모델 계열·변형 상품의 중복도 작성 단계에서 따로 확인한다. 실행기는 기존 정답 ASIN과 정규화한 문장의 직접 중복을 검사하며, 의미가 비슷한 문장까지 판정하는 과정은 따로 필요하다. 공개 데이터로 다시 튜닝할 때는 이 비공개 세트의 결과를 별도로 보관하고, 다음 일반화 평가에는 새 세트를 사용한다.

비공개 JSON에는 `baseline`(전체 커밋 SHA), `tasks`(기존 시나리오와 같은 형태), 선택 항목인 `ingredientEvidence`를 넣는다. 질문과 정답이 함께 들어 있는 JSON 및 실행 원본은 `data/` 아래에 둔다. 공개 보고서에는 별도로 집계한 수치만 사용한다. 실제 모델 호출에서는 사용자 질의 문장이 모델 서비스에 전달된다.

```sh
node api/benchmarks/amazon-en/run.mjs --holdout-file data/amazon-en/private/holdout.json --validate
node api/benchmarks/amazon-en/run.mjs --holdout-file data/amazon-en/private/holdout.json --mode ABC --model deepseek-v4-flash --data data/amazon-en/private/deepseek
node api/benchmarks/amazon-en/report.mjs data/amazon-en/private/deepseek
```

두 모델을 평가할 때는 같은 파일과 커밋을 사용하고 모델별 결과 폴더를 분리한다. 정확 상품은 정답이 나온 첫 카드 위치를 별도로 집계한다. Top 3와 Top 1의 차이는 2·3번째 카드에서 적중한 요청 수다.

이미 평가한 비공개 요청을 새 커밋에서 그대로 재실행할 때는 복사본의 `baseline`을 대상 커밋으로 지정하고 `--comparison`을 추가한다. 보고서에는 동일 시나리오 재평가로 표시한다.

## 보관된 결과 집계

아래 명령은 두 실행 기록을 읽어 비교 보고서를 다시 만든다.

```sh
node api/benchmarks/amazon-en/report.mjs \
  docs/verification/deepseek-amazon-en-2026-11-23/a \
  docs/verification/deepseek-amazon-en-2026-11-23/bc \
  --output data/amazon-en/archived-report
```

보관 기록을 집계할 때 상품명과 알레르기 응답을 별도 파일로 검토하려면 해당 실행에 사용한 카탈로그를 `--catalog-dir`로 지정한다. 앱 코드나 채점 기준이 다른 실행의 결과는 함께 집계할 수 없다.

[GPT-5.6 Luna A/B 보관 결과](../../../docs/verification/gpt-luna-amazon-en-2026-11-23/comparison.md)는 다음 명령으로 집계한다.

```sh
node api/benchmarks/amazon-en/report.mjs \
  docs/verification/gpt-luna-amazon-en-2026-11-23 \
  --output data/amazon-en/luna-archived-report
```
