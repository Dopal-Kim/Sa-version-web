"""R0 검증: 계열(형제 프로젝트) 단위 반복 K-겹 교차검증으로 작업기간 분포 방식을 비교한다.

방법 6가지(같은 네트워크·같은 난수 생성기):
  plan      : 계획 공기 그대로(점 예측) — 결정론 CPM
  sym15     : 계획 ±15% 삼각분포(기존 SA 앱)
  tri3      : DSLIB 전문가 3점(낙관/최빈/비관) 삼각분포
  pert3     : 같은 3점의 Beta-PERT(α=1+4(m−a)/(b−a), β=1+4(b−m)/(b−a))
  learned   : 학습 묶음 프로젝트 하나를 뽑아 그 안에서 기간 구간별 비율 추출(앱과 같은 방식)
  learned_c : learned + 보정 분위 q*(학습 묶음 안에서 계열 단위로 구한 PIT 로 결정 — 시험 프로젝트 정보 미사용)

지표: P80 적중(실제 ≤ 예측 P80, 보정은 P(q*)), 계열 가중 적중, CRPS/계획공기, 분위별 적중(캘리브레이션 곡선), PIT 히스토그램
출력: sa_ai/data/r0_validation.json
"""
import csv
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from backtest import (BUILDING, DSLIB, OUT, bin_of, cpm, family, load_project, topo, tri)  # noqa: E402

K, REPEATS, N_TEST, N_NEST, SEED = 5, 10, 1000, 400, 20261021
QS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]


def crps(samples, y):
    x = np.sort(samples)
    n = len(x)
    return np.mean(np.abs(x - y)) - np.sum((2 * np.arange(1, n + 1) - n - 1) * x) / (n * n)


def qstar(pits, target=0.8):
    p = np.sort(np.asarray(pits))
    k = min(len(p) - 1, int(np.ceil((len(p) + 1) * target)) - 1)
    return float(min(1.0, p[k]))


def pert(rng, a, m, b, n):
    if b <= a:
        return np.full(n, m)
    al, be = 1 + 4 * (m - a) / (b - a), 1 + 4 * (b - m) / (b - a)
    return a + (b - a) * rng.beta(al, be, n)


def main():
    acts = list(csv.DictReader(open(OUT / "dslib_activities.csv", encoding="utf-8")))
    projs = {p["project"]: p for p in csv.DictReader(open(OUT / "dslib_projects.csv", encoding="utf-8"))}
    clean = [a for a in acts if float(a["planned_d"]) >= 1 and not (float(a["actual_d"]) < 0.25 and float(a["planned_d"]) >= 5)
             and any(k in a["sector"].lower() for k in BUILDING)]
    ratios = {}
    for a in clean:
        ratios.setdefault(a["project"], []).append((bin_of(float(a["planned_d"])), float(a["ratio"])))
    files = {p.name.split(" ")[0]: p for p in (DSLIB / "Excel").glob("*.xlsx")}

    # 시험 가능한 프로젝트(네트워크 해석이 계획 공기와 ±15% 이내) — backtest 와 같은 기준
    P = {}
    for code in ratios:
        p = projs[code]
        try:
            el, pd_days = float(p["early_late"]), float(p["pd_days"])
        except ValueError:
            continue
        dur, preds, expert = load_project(code, files[code])
        order = topo(list(dur), preds)
        if not order:
            continue
        det = float(cpm(order, preds, {k: np.array([v]) for k, v in dur.items()})[0])
        if not (0.85 <= det / pd_days <= 1.15):
            continue
        P[code] = dict(dur=dur, preds=preds, order=order, expert=expert, det=det, pd=pd_days, real=pd_days * (1 + el), fam=family(p["name"]))
    codes = sorted(P)
    fams = sorted({P[c]["fam"] for c in codes})
    print(f"시험 프로젝트 {len(codes)}개, 계열 {len(fams)}개", file=sys.stderr)

    def simulate(code, meth, pool_codes, rng, n):
        x = P[code]
        sd = {}
        donors = rng.choice(pool_codes, n) if meth.startswith("learned") else None
        for k, d in x["dur"].items():
            if d <= 0:
                sd[k] = np.zeros(n); continue
            if meth == "sym15":
                sd[k] = tri(rng, d * 0.85, d, d * 1.15, n)
            elif meth in ("tri3", "pert3"):
                o, m, pp = x["expert"].get(k, (1.0, 1.0, 1.0))
                sd[k] = (tri if meth == "tri3" else pert)(rng, d * o, d * m, d * pp, n)
            else:
                b, r = bin_of(d), np.empty(n)
                for c in set(donors):
                    idx = donors == c
                    src = [v for bb, v in ratios[c] if bb == b]
                    src = np.array(src if len(src) >= 3 else [v for _, v in ratios[c]])
                    r[idx] = rng.choice(src, idx.sum())
                sd[k] = d * r
        return np.sort(cpm(x["order"], x["preds"], sd) * (x["pd"] / x["det"]))

    meths = ["plan", "sym15", "tri3", "pert3", "learned", "learned_c"]
    rows = []   # (repeat, code, meth, hit80, crps/pd, pit, hits at QS)
    rng = np.random.default_rng(SEED)
    for rep in range(REPEATS):
        order_f = list(fams); rng.shuffle(order_f)
        folds = [order_f[i::K] for i in range(K)]
        for fi, test_f in enumerate(folds):
            test = [c for c in codes if P[c]["fam"] in test_f]
            train = [c for c in codes if P[c]["fam"] not in test_f]
            # 보정 q*: 학습 묶음 안에서 계열 단위로 뺀 PIT
            pits = []
            for c in train:
                pool = [d for d in train if P[d]["fam"] != P[c]["fam"]]
                T = simulate(c, "learned", pool, rng, N_NEST)
                pits.append(float(np.mean(T <= P[c]["real"])))
            qs = qstar(pits)
            for c in test:
                x = P[c]
                for m in meths:
                    if m == "plan":
                        T = np.array([x["pd"]])
                    else:
                        T = simulate(c, "learned" if m == "learned_c" else m, train, rng, N_TEST)
                    p80 = np.quantile(T, qs if m == "learned_c" else 0.8)
                    lv = (lambda q: np.quantile(T, min(1.0, q * qs / 0.8))) if m == "learned_c" else (lambda q: np.quantile(T, q))
                    rows.append(dict(rep=rep, code=c, fam=x["fam"], meth=m, hit80=int(x["real"] <= p80), crps=float(crps(T, x["real"]) / x["pd"]),
                                     pit=float(np.mean(T <= x["real"])), qhits=[int(x["real"] <= lv(q)) for q in QS], qstar=qs))
            print(f"반복 {rep + 1}/{REPEATS} 묶음 {fi + 1}/{K} q*={qs:.3f}", file=sys.stderr)

    out = {"k": K, "repeats": REPEATS, "n_projects": len(codes), "n_families": len(fams), "quantiles": QS, "methods": {}}
    fam_n = {f: sum(1 for c in codes if P[c]["fam"] == f) for f in fams}
    for m in meths:
        R = [r for r in rows if r["meth"] == m]
        w = np.array([1 / fam_n[r["fam"]] for r in R])
        hit = np.array([r["hit80"] for r in R]); cr = np.array([r["crps"] for r in R])
        per_rep = [np.mean([r["hit80"] for r in R if r["rep"] == k]) for k in range(REPEATS)]
        out["methods"][m] = {
            "p80_hit": float(hit.mean()), "p80_hit_famW": float((hit * w).sum() / w.sum()),
            "p80_hit_rep_min": float(min(per_rep)), "p80_hit_rep_max": float(max(per_rep)),
            "crps_over_pd": float(cr.mean()), "crps_famW": float((cr * w).sum() / w.sum()),
            "calibration": [float(np.mean([r["qhits"][i] for r in R])) for i in range(len(QS))],
            "pit_hist": np.histogram([r["pit"] for r in R], bins=10, range=(0, 1))[0].tolist(),
            "qstar_mean": float(np.mean([r["qstar"] for r in R])) if m == "learned_c" else None,
        }
        s = out["methods"][m]
        print(f"{m:10s} P80적중 {s['p80_hit']:.2f}(계열 {s['p80_hit_famW']:.2f}, 반복 {s['p80_hit_rep_min']:.2f}~{s['p80_hit_rep_max']:.2f}) "
              f"CRPS/PD {s['crps_over_pd']:.3f}(계열 {s['crps_famW']:.3f})")
    json.dump(out, open(OUT / "r0_validation.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)


if __name__ == "__main__":
    assert abs(qstar(np.linspace(0, 1, 101)) - 0.8) < 0.02
    main()
