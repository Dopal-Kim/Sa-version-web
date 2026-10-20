"""앱에 넣을 작업기간 분포(duration prior) JSON 생성.

- 건축 섹터 DSLIB 프로젝트의 작업 실적/계획 비율을 프로젝트별·기간구간별로 저장
  → 앱에서 '프로젝트 하나를 뽑고 그 안에서 비율 추출'(프로젝트 내 상관 유지, backtest 의 lopo_blk)
- 프로젝트 단위 보정 q*(calibration.json) 포함: 앱은 P80 대신 P(q*)를 '보정된 P80'으로 표시
출력: sa_ai/data/duration_prior.json
"""
import csv
import json
import re
import os
from pathlib import Path

ROOT = Path(os.environ.get("SA_ROOT") or Path(__file__).resolve().parents[2])
OUT = ROOT / "sa_ai" / "data"
BUILDING = ("residential", "commercial", "institutional", "industrial")
DUR_BINS = [0, 2, 5, 10, 20, 50]  # 마지막 구간은 50일 이상


def main():
    acts = list(csv.DictReader(open(OUT / "dslib_activities.csv", encoding="utf-8")))
    projs = {p["project"]: p for p in csv.DictReader(open(OUT / "dslib_projects.csv", encoding="utf-8"))}
    cal = json.load(open(OUT / "calibration.json", encoding="utf-8"))
    by = {}
    for a in acts:
        pl, ac = float(a["planned_d"]), float(a["actual_d"])
        if pl < 1 or (ac < 0.25 and pl >= 5) or not any(k in a["sector"].lower() for k in BUILDING):
            continue
        b = sum(1 for e in DUR_BINS[1:] if pl > e)
        by.setdefault(a["project"], [[] for _ in DUR_BINS])[b].append(round(float(a["ratio"]), 4))
    prior = {
        "source": "DSLIB 3.4 (Batselier & Vanhoucke 2015, IJPM 33(3):697-710), 건축 섹터, 자리표시·취소 작업 제외",
        "dur_bins_days": DUR_BINS,
        "calibration_qstar": cal["methods"]["lopo_blk"]["qstar_all"],
        "backtest": {k: {kk: v for kk, v in cal["methods"][k].items() if kk != "pit_all"} for k in cal["methods"]},
        "n_projects": len(by),
        "projects": [{"code": c, "sector": projs[c]["sector"].split("(")[-1].rstrip(")"),
                      "family": re.sub(r"\s*\(\d+\)\s*$", "", projs[c]["name"]).strip(),
                      "ratios_by_bin": rs} for c, rs in sorted(by.items())],
    }
    json.dump(prior, open(OUT / "duration_prior.json", "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    n = sum(len(x) for p in prior["projects"] for x in p["ratios_by_bin"])
    print(f"프로젝트 {prior['n_projects']}, 비율 {n}개, q*={prior['calibration_qstar']:.3f}, "
          f"{(OUT / 'duration_prior.json').stat().st_size / 1024:.0f}KB")


if __name__ == "__main__":
    main()
