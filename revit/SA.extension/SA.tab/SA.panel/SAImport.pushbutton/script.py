# -*- coding: utf-8 -*-
"""SA 가져오기 — SA 웹앱이 만든 sa-revit-result/1 JSON 을 읽어 요소에 공정 결과를 쓰고, 현재 뷰를 위험도로 색칠한다.
매개변수(인스턴스, 텍스트): SA_Activity, SA_P50_Finish, SA_P80_Finish, SA_Risk — 없으면 공유 매개변수로 만든다."""
__title__ = "SA\n가져오기"
__doc__ = "SA 결과 JSON → 요소 매개변수(SA_Activity·SA_P50_Finish·SA_P80_Finish·SA_Risk) + 현재 뷰 위험도 필터 색"

import io
import json
import os
import tempfile

from pyrevit import revit, DB, forms, script
import sa_revit as S

doc, out = revit.doc, script.get_output()
PARAMS = ["SA_Activity", "SA_P50_Finish", "SA_P80_Finish", "SA_Risk"]
CATS = [DB.BuiltInCategory.OST_Walls, DB.BuiltInCategory.OST_Floors, DB.BuiltInCategory.OST_StructuralColumns,
        DB.BuiltInCategory.OST_StructuralFraming, DB.BuiltInCategory.OST_StructuralFoundation,
        DB.BuiltInCategory.OST_Doors, DB.BuiltInCategory.OST_Windows, DB.BuiltInCategory.OST_Ceilings]

path = forms.pick_file(file_ext="json", title=u"SA 결과 JSON 선택")
if not path:
    script.exit()
with io.open(path, encoding="utf-8") as fh:
    res = json.load(fh)
try:
    elements = S.check_result(res)
except ValueError as e:
    forms.alert(str(e), exitscript=True)


def ensure_params():
    """없는 SA_ 매개변수를 임시 공유 매개변수 파일로 만들어 인스턴스로 바인딩한다(Revit 버전별 API 차이를 try 로 처리)."""
    have = set()
    it = doc.ParameterBindings.ForwardIterator()
    while it.MoveNext():
        have.add(it.Key.Name)
    need = [p for p in PARAMS if p not in have]
    if not need:
        return
    app = doc.Application
    old = app.SharedParametersFilename
    tmp = os.path.join(tempfile.gettempdir(), "sa_shared_params.txt")
    io.open(tmp, "a", encoding="utf-8").close()
    app.SharedParametersFilename = tmp
    try:
        grp = app.OpenSharedParameterFile().Groups.get_Item("SA") or app.OpenSharedParameterFile().Groups.Create("SA")
        cats = DB.CategorySet()
        for bic in CATS:
            cats.Insert(doc.Settings.Categories.get_Item(bic))
        for name in need:
            d = grp.Definitions.get_Item(name)
            if d is None:
                try:
                    opt = DB.ExternalDefinitionCreationOptions(name, DB.SpecTypeId.String.Text)        # Revit 2022+
                except Exception:
                    opt = DB.ExternalDefinitionCreationOptions(name, DB.ParameterType.Text)            # 이전 버전
                d = grp.Definitions.Create(opt)
            binding = DB.InstanceBinding(cats)
            try:
                doc.ParameterBindings.Insert(d, binding, DB.GroupTypeId.Data)                       # Revit 2024+
            except Exception:
                doc.ParameterBindings.Insert(d, binding, DB.BuiltInParameterGroup.PG_DATA)
    finally:
        if old:
            app.SharedParametersFilename = old


def risk_filters(view):
    """SA_Risk = High/Mid/Low 필터를 만들고 현재 뷰에 색을 입힌다."""
    sample = None
    for e in elements:
        el = doc.GetElement(e["uid"])
        if el is not None and el.LookupParameter("SA_Risk") is not None:
            sample = el.LookupParameter("SA_Risk")
            break
    if sample is None:
        return 0
    pid = sample.Id
    cat_ids = [doc.Settings.Categories.get_Item(b).Id for b in CATS]
    from System.Collections.Generic import List
    ids = List[DB.ElementId](cat_ids)
    solid = next((f for f in DB.FilteredElementCollector(doc).OfClass(DB.FillPatternElement) if f.GetFillPattern().IsSolidFill), None)
    n = 0
    for risk in ("High", "Mid", "Low"):
        try:
            rule = DB.ParameterFilterRuleFactory.CreateEqualsRule(pid, risk)                       # Revit 2023+
        except Exception:
            rule = DB.ParameterFilterRuleFactory.CreateEqualsRule(pid, risk, True)
        name = "SA_Risk_" + risk
        pf = next((f for f in DB.FilteredElementCollector(doc).OfClass(DB.ParameterFilterElement) if f.Name == name), None)
        if pf is None:
            pf = DB.ParameterFilterElement.Create(doc, name, ids, DB.ElementParameterFilter(rule))
        r, g, b = S.risk_color(risk)
        ogs = DB.OverrideGraphicSettings()
        if solid is not None:
            ogs.SetSurfaceForegroundPatternId(solid.Id)
            ogs.SetSurfaceForegroundPatternColor(DB.Color(r, g, b))
        ogs.SetProjectionLineColor(DB.Color(r, g, b))
        if not view.IsFilterApplied(pf.Id):
            view.AddFilter(pf.Id)
        view.SetFilterOverrides(pf.Id, ogs)
        n += 1
    return n


with revit.Transaction(u"SA 결과 가져오기"):
    ensure_params()
    written, missing = 0, 0
    for e in elements:
        el = doc.GetElement(e["uid"])
        if el is None:
            missing += 1
            continue
        for name, key in (("SA_Activity", "activity"), ("SA_P50_Finish", "p50Finish"), ("SA_P80_Finish", "p80Finish"), ("SA_Risk", "risk")):
            p = el.LookupParameter(name)
            if p is not None and not p.IsReadOnly:
                p.Set(str(e.get(key) or ""))
        written += 1
    nf = risk_filters(doc.ActiveView)

out.print_md(u"**완료** — 요소 {}개 기록, 모델에 없는 요소 {}개, 현재 뷰 필터 {}개 적용\n\n시나리오: {} · 프로젝트 P50 {} · 보정 P80 {}".format(
    written, missing, nf, res.get("scenario"), res.get("projectP50"), res.get("projectP80cal")))
