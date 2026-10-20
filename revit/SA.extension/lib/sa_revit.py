# -*- coding: utf-8 -*-
"""SA 스마트공정관리AI ↔ Revit 교환 — Revit API 에 의존하지 않는 부분(단위·판별·묶기).

IronPython 2.7 과 CPython 3 모두에서 돈다(f-문자열 쓰지 않음).
자가 검사: python sa_revit.py
"""
from __future__ import division

FT = 0.3048            # ft → m
FT2 = 0.09290304       # ft² → m²
FT3 = 0.028316846592   # ft³ → m³
SCHEMA = "sa-revit/1"
ROOF_WORDS = ("roof", "지붕", "옥탑", "ph", "parapet", "파라펫")
PILE_WORDS = ("pile", "파일", "phc", "말뚝", "sip", "강관")


def is_roof(level_name):
    n = (level_name or "").strip().lower()
    return any(n == w or n.startswith(w) or (w in n and w not in ("ph",)) for w in ROOF_WORDS)


def is_pile(family_name, type_name):
    n = ((family_name or "") + " " + (type_name or "")).lower()
    return any(w in n for w in PILE_WORDS)


def formwork_area(cat, area_m2, structural):
    """거푸집 근사 면적: 슬래브 하부 1면, 벽 양면. 기둥·보는 일람표 면적이 없어 제외(과소 추정임을 앱에 표시)."""
    if not structural or not area_m2:
        return 0.0
    if cat == "Floors":
        return area_m2
    if cat == "Walls":
        return 2.0 * area_m2
    return 0.0


def build_export(project, levels, rows, piles):
    """levels: [{name, elev_m, building_story}], rows: [{uid, ifcGuid, cat, level, structural, area_m2, volume_m3}]
    → sa-revit/1 dict. 층별 물량을 묶고 요소 목록을 붙인다."""
    lv = [dict(name=l["name"], elev_m=round(l["elev_m"], 3), roof=is_roof(l["name"])) for l in levels if l.get("building_story", True)]
    q = {}
    for r in rows:
        k = r.get("level")
        if k is None:
            continue
        d = q.setdefault(k, {"level": k, "concrete_m3": 0.0, "formwork_m2": 0.0, "floorArea_m2": 0.0})
        if r.get("structural") and r.get("cat") in ("Walls", "Floors", "Structural Columns", "Structural Framing", "Structural Foundation"):
            d["concrete_m3"] += r.get("volume_m3") or 0.0
        d["formwork_m2"] += formwork_area(r.get("cat"), r.get("area_m2") or 0.0, r.get("structural"))
        if r.get("cat") == "Floors" and r.get("structural"):
            d["floorArea_m2"] += r.get("area_m2") or 0.0
    for d in q.values():
        for k in ("concrete_m3", "formwork_m2", "floorArea_m2"):
            d[k] = round(d[k], 1)
    els = [dict(uid=r["uid"], ifcGuid=r.get("ifcGuid") or None, cat=r.get("cat"), level=r.get("level"), structural=bool(r.get("structural"))) for r in rows]
    return {"schema": SCHEMA, "project": project, "levels": lv, "quantities": sorted(q.values(), key=lambda d: d["level"]),
            "piles": piles, "elements": els}


def risk_color(risk):
    """뷰 필터 색(RGB): High 빨강, Mid 주황, Low 회색."""
    return {"High": (192, 39, 31), "Mid": (230, 150, 30), "Low": (160, 165, 170)}.get(risk, (160, 165, 170))


def check_result(res):
    if not isinstance(res, dict) or res.get("schema") != "sa-revit-result/1":
        raise ValueError(u"SA 결과 파일이 아닙니다(schema: sa-revit-result/1)")
    return res.get("elements") or []


if __name__ == "__main__":
    assert is_roof("ROOF") and is_roof(u"지붕층") and is_roof("PH1") and not is_roof("1F") and not is_roof("B1")
    assert is_pile("PHC Pile", "500") and is_pile(u"기초", u"강관말뚝") and not is_pile("Footing", "F1")
    assert formwork_area("Walls", 10, True) == 20 and formwork_area("Floors", 10, True) == 10 and formwork_area("Walls", 10, False) == 0
    ex = build_export({"name": "t"}, [{"name": "1F", "elev_m": 0, "building_story": True}, {"name": "Ref", "elev_m": 1, "building_story": False}],
                      [{"uid": "a", "cat": "Walls", "level": "1F", "structural": True, "area_m2": 5, "volume_m3": 1}], {"count": 0})
    assert ex["schema"] == SCHEMA and len(ex["levels"]) == 1 and ex["quantities"][0]["formwork_m2"] == 10 and ex["quantities"][0]["concrete_m3"] == 1
    try:
        check_result({"schema": "x"})
        raise AssertionError("should fail")
    except ValueError:
        pass
    print("sa_revit 자가 검사 통과")
