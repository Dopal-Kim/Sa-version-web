"""단계 B-2: 프로젝트 단위 분위 보정(split-conformal 방식의 quantile recalibration).

작업 분포만으로는 '작업 사이 중단·대기' 같은 프로젝트 단위 지연을 못 잡는다.
다른 계열 프로젝트들에서 '실제 공기가 예측 분포의 몇 분위에 떨어졌나(PIT)'를 모아,
목표 80%를 맞추는 분위 수준 q* 를 구하고, 시험 프로젝트의 P80 대신 Pq* 를 쓴다.
검증은 계열(형제 프로젝트) 단위로 빼고 한다.

출력: sa_ai/data/calibration.json (앱에 넣을 전체 데이터 기준 q* 포함)
"""
import csv
import json
import re
import os
from pathlib import Path

import numpy as np

OUT = Path(os.environ.get("SA_ROOT") or Path(__file__).resolve().parents[2]) / "sa_ai" / "data"
TARGET = 0.80


def family(name):
    return re.sub(r"\s*\(\d+\)\s*$", "", str(name)).strip().lower()


def qstar(pits, target=TARGET):
    """PIT 표본에서 '실제 ≤ Pq' 비율이 target 이 되는 q. 유한표본 보정 포함(conformal)."""
    pits = np.sort(np.asarray(pits))
    n = len(pits)
    k = min(n - 1, int(np.ceil((n + 1) * target)) - 1)
    return float(min(1.0, pits[k]))


def crps(x, y):
    x = np.sort(x)
    n = len(x)
    return np.mean(np.abs(x - y)) - np.sum((2 * np.arange(1, n + 1) - n - 1) * x) / (n * n)


def main():
    rows = list(csv.DictReader(open(OUT / "backtest_projects.csv", encoding="utf-8")))
    names = {p["project"]: p["name"] for p in csv.DictReader(open(OUT / "dslib_projects.csv", encoding="utf-8"))}
    S = np.load(OUT / "backtest_samples.npz")
    for r in rows:
        r["fam"] = family(names[r["project"]])
    fams = sorted({r["fam"] for r in rows})
    out = {"target": TARGET, "methods": {}}
    for meth in ("sym15", "expert", "lopo", "lopo_blk"):
        hits, hits_raw, w, crps_cal = [], [], [], []
        for r in rows:
            others = [float(o[f"{meth}_pit"]) for o in rows if o["fam"] != r["fam"]]
            q = qstar(others)
            T = S[f"{r['project']}|{meth}"]
            real = float(r["real"])
            p80c = float(np.quantile(T, q))
            hits.append(int(real <= p80c))
            hits_raw.append(int(r[f"{meth}_hit80"]))
            w.append(1.0 / sum(1 for o in rows if o["fam"] == r["fam"]))
            # 보정된 분포: 다른 계열 PIT 의 경험분포로 분위를 다시 매핑해 표본 생성
            u = np.sort(np.array(others))
            levels = np.quantile(u, np.linspace(0, 1, len(T)))
            crps_cal.append(crps(np.quantile(T, levels), real) / float(r["pd"]))
        w = np.array(w)
        allp = [float(o[f"{meth}_pit"]) for o in rows]
        out["methods"][meth] = {
            "p80_hit_raw": float(np.mean(hits_raw)),
            "p80_hit_raw_famW": float(np.sum(np.array(hits_raw) * w) / w.sum()),
            "p80_hit_cal": float(np.mean(hits)),
            "p80_hit_cal_famW": float(np.sum(np.array(hits) * w) / w.sum()),
            "crps_cal_over_pd": float(np.mean(crps_cal)),
            "crps_cal_famW": float(np.sum(np.array(crps_cal) * w) / w.sum()),
            "qstar_all": qstar(allp),  # 앱에서 쓸 값(전체 데이터 기준)
            "pit_all": allp,
        }
        m = out["methods"][meth]
        print(f"{meth:9s} 원래 P80적중 {m['p80_hit_raw']:.2f}(계열가중 {m['p80_hit_raw_famW']:.2f}) → 보정 {m['p80_hit_cal']:.2f}"
              f"(계열가중 {m['p80_hit_cal_famW']:.2f}) | 보정 CRPS {m['crps_cal_over_pd']:.3f}(계열 {m['crps_cal_famW']:.3f}) | q*={m['qstar_all']:.3f}")
    out["n_projects"], out["n_families"] = len(rows), len(fams)
    json.dump(out, open(OUT / "calibration.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    assert abs(qstar(np.linspace(0, 1, 101), 0.8) - 0.80) < 0.02
    main()
