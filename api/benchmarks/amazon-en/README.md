# PASS 영문 Amazon 본실험 재현

측정 설계와 수정 후 결과는 [작업 기록](../../../docs/verification/deepseek-amazon-en-2026-11-23/README.md)에 있다. 이 실행기는 같은 카탈로그와 120개 합성 시나리오를 사용해 실제 Worker의 A/B/C 경로를 호출한다.

## 데이터 준비

[Kaggle Amazon Products Sales Dataset 2023](https://www.kaggle.com/datasets/lokeshparab/amazon-products-dataset)의 ZIP을 로컬에 둔다. Python 3.11 이상과 Node.js 22.13 이상을 사용한다. 명령은 저장소 루트에서 실행한다.

```sh
python3 api/benchmarks/amazon-en/prepare.py data/amazon-products-dataset.zip data/amazon-en/catalog
node api/benchmarks/amazon-en/run.mjs --validate
```

고정 시드는 `pass-amazon-en-v1`이다. 실행기는 영문 카탈로그 300,000개와 SHA-256 `70ab2f30b179efae0807dd6441f1c13881a0deb7a694f05db0bb0c8eee3b478c`를 확인한다. 검증 모드는 API 호출 없이 카탈로그와 과제 수를 확인한다.

## 본실험

실호출에는 서버 `api/.dev.vars` 또는 프로세스 환경의 `LLM_API_KEY`와 OpenAI 호환 공급자 설정이 필요하다. 모델은 DeepSeek V4 Flash, 가격은 백만 토큰당 입력 $0.06·출력 $0.17을 사용한다. 캐시 입력에는 같은 입력 단가를 적용한다.

```sh
node api/benchmarks/amazon-en/run.mjs --mode BC --data data/amazon-en/bc
node api/benchmarks/amazon-en/run.mjs --mode A --data data/amazon-en/a
node api/benchmarks/amazon-en/report.mjs data/amazon-en/a data/amazon-en/bc --output data/amazon-en/report
```

`run.mjs`는 기본적으로 `ABC`를 실행한다. 각 경우에 `A`, `B`, `C`, `BC`, `ABC`를 지정할 수 있다. 앱 코드, 카탈로그, 시나리오, 채점 버전 및 실행기 변경을 메타데이터에 기록한다. 같은 서명의 중단된 실행은 저장된 행 다음부터 재개한다. 다른 수정본으로 시험할 때는 새 결과 폴더를 사용한다.

## 보관된 결과 집계

아래 명령은 두 실행 기록을 읽어 비교 보고서를 다시 만든다.

```sh
node api/benchmarks/amazon-en/report.mjs \
  docs/verification/deepseek-amazon-en-2026-11-23/a \
  docs/verification/deepseek-amazon-en-2026-11-23/bc \
  --output data/amazon-en/archived-report
```

보관 기록을 집계할 때 상품명과 알레르기 응답을 별도 파일로 검토하려면 기존 카탈로그에 대해 `--catalog-dir data/amazon-en/catalog`를 지정한다. 앱 코드나 채점 기준이 다른 실행의 결과는 함께 집계할 수 없다.
