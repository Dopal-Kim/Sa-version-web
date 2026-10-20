# research — 학습 분포·검증 재현

앱(6번 탭)에 들어간 작업기간 분포와 검증 수치를 다시 만드는 스크립트와 결과입니다. 배포에서는 빠집니다(`.vercelignore`).

## 데이터 (저장소에 포함하지 않음)
- **DSLIB 3.4** — Ghent대 OR&S 실제 프로젝트 231개. https://github.com/MarioVanhoucke/DSLIB-Dynamic-Scheduling-Empirical-Project-Library (릴리스 `DSLIB3.4.zip`).
  사용 시 인용: Batselier, J., & Vanhoucke, M. (2015). Construction and evaluation framework for a real-life project database. *IJPM*, 33(3), 697–710.
- **LH 주택건설공사 공사기간 산정지침** 2021.9.17 제2601호 원본 PDF → 텍스트 추출본 `LH_지침_2021.9_text.txt`

## 폴더 배치
`SA_ROOT` 환경변수(없으면 이 저장소의 상위 폴더)를 기준으로:
```
SA_ROOT/
  data_raw/dslib/DSLIB 3.4/      ← DSLIB 압축 해제
  data_raw/lh/LH_지침_2021.9_text.txt
  sa_ai/data/                    ← 중간 결과(CSV·JSON)가 생기는 곳
```

## 실행 순서
```
python -P research/scripts/dslib_extract.py   # 작업별 계획/실적 → dslib_activities.csv
python -P research/scripts/backtest.py        # 방법별 공기 시뮬레이션 → backtest_*.csv/npz
python -P research/scripts/calibrate.py       # 보정 분위 q* → calibration.json
python -P research/scripts/build_prior.py     # 앱 입력 → duration_prior.json (index.html 의 sa-duration-prior)
python -P research/scripts/lh_tables.py       # LH 별표 → lh_rules.json (index.html 의 sa-lh-core 에 내장)
python -P research/scripts/validate_r0.py     # 계열 단위 5겹 × 10회 교차검증 → r0_validation.json
```
필요 패키지: numpy, pandas, openpyxl.

## 결과 (`results/`)
- `r0_validation.json` — R0 검증. 요약은 [R0_검증.md](R0_검증.md)
- `calibration.json`, `duration_prior.json`, `lh_rules.json` — 앱에 들어간 값
