# -*- coding: utf-8 -*-
"""SA 내보내기 — 레벨·층별 물량·파일·요소 목록을 sa-revit/1 JSON 으로 저장한다.
저장한 파일을 SA 웹앱 6번 탭 'Revit 모델 불러오기'로 연다. 모델은 PC 밖으로 나가지 않는다."""
__title__ = "SA\n내보내기"
__doc__ = "레벨(Building Story)·층별 콘크리트·거푸집 근사·파일 본수·요소를 SA 웹앱용 JSON 으로 저장"

import io
import json
import datetime

from pyrevit import revit, DB, forms, script
import sa_revit as S

doc = revit.doc
out = script.get_output()


def pval(el, bip, default=None):
    p = el.get_Parameter(bip)
    if p is None or not p.HasValue:
        return default
    st = p.StorageType
    if st == DB.StorageType.Double:
        return p.AsDouble()
    if st == DB.StorageType.Integer:
        return p.AsInteger()
    if st == DB.StorageType.ElementId:
        return p.AsElementId()
    return p.AsString()


def level_name(el):
    for bip in (DB.BuiltInParameter.FAMILY_BASE_LEVEL_PARAM, DB.BuiltInParameter.INSTANCE_REFERENCE_LEVEL_PARAM,
                DB.BuiltInParameter.SCHEDULE_LEVEL_PARAM):
        lid = pval(el, bip)
        if isinstance(lid, DB.ElementId) and lid != DB.ElementId.InvalidElementId:
            lv = doc.GetElement(lid)
            if lv is not None:
                return lv.Name
    lid = getattr(el, "LevelId", None)
    if lid is not None and lid != DB.ElementId.InvalidElementId:
        lv = doc.GetElement(lid)
        return lv.Name if lv is not None else None
    return None


# 1) 레벨: 'Building Story' 가 켜진 레벨만, 프로젝트 기준점 기준 고도
levels = []
for lv in DB.FilteredElementCollector(doc).OfClass(DB.Level):
    story = pval(lv, DB.BuiltInParameter.LEVEL_IS_BUILDING_STORY, 1)
    levels.append({"name": lv.Name, "elev_m": lv.ProjectElevation * S.FT, "building_story": bool(story)})
if not [l for l in levels if l["building_story"]]:
    forms.alert(u"Building Story 가 켜진 레벨이 없습니다. 레벨 속성에서 'Building Story'를 켜세요.", exitscript=True)

# 2) 요소: 구조체(벽·슬래브·기둥·보·기초)와 마감 대표(문·창·천장)
CATS = [
    (DB.BuiltInCategory.OST_Walls, "Walls"), (DB.BuiltInCategory.OST_Floors, "Floors"),
    (DB.BuiltInCategory.OST_StructuralColumns, "Structural Columns"), (DB.BuiltInCategory.OST_StructuralFraming, "Structural Framing"),
    (DB.BuiltInCategory.OST_StructuralFoundation, "Structural Foundation"),
    (DB.BuiltInCategory.OST_Doors, "Doors"), (DB.BuiltInCategory.OST_Windows, "Windows"), (DB.BuiltInCategory.OST_Ceilings, "Ceilings"),
]
rows, pile_count = [], 0
for bic, cat in CATS:
    for el in DB.FilteredElementCollector(doc).OfCategory(bic).WhereElementIsNotElementType():
        if cat == "Walls":
            structural = bool(pval(el, DB.BuiltInParameter.WALL_STRUCTURAL_SIGNIFICANT, 0))
        elif cat == "Floors":
            structural = bool(pval(el, DB.BuiltInParameter.FLOOR_PARAM_IS_STRUCTURAL, 0))
        else:
            structural = cat.startswith("Structural")
        area = pval(el, DB.BuiltInParameter.HOST_AREA_COMPUTED)
        vol = pval(el, DB.BuiltInParameter.HOST_VOLUME_COMPUTED)
        if cat == "Structural Foundation":
            sym = getattr(el, "Symbol", None)
            fam = sym.Family.Name if sym is not None else ""
            typ = sym.Name if sym is not None else ""   # IronPython 에서 Name 이 안 되면 SYMBOL_NAME_PARAM 사용
            if S.is_pile(fam, typ):
                pile_count += 1
        rows.append({"uid": el.UniqueId, "ifcGuid": pval(el, DB.BuiltInParameter.IFC_GUID), "cat": cat, "level": level_name(el),
                     "structural": structural, "area_m2": (area or 0) * S.FT2, "volume_m3": (vol or 0) * S.FT3})

# 3) 파일 깊이(모델에서 읽기 어려워 묻는다), 연면적(Gross Building 면적 합 — 없으면 구조 슬래브 합으로 앱이 계산)
depth = forms.ask_for_string(default="25", prompt=u"파일 깊이(m) — 파일이 없으면 0", title="SA 내보내기")
try:
    depth = float(depth or 0)
except ValueError:
    depth = 25.0
gross = 0.0
for ar in DB.FilteredElementCollector(doc).OfCategory(DB.BuiltInCategory.OST_Areas).WhereElementIsNotElementType():
    try:
        if "gross" in ar.AreaScheme.Name.lower() or u"연면적" in ar.AreaScheme.Name:
            gross += (ar.Area or 0) * S.FT2
    except Exception:
        pass

project = {"name": doc.Title, "grossArea_m2": round(gross, 1) if gross else None, "revitVersion": doc.Application.VersionNumber}
data = S.build_export(project, levels, rows, {"count": pile_count, "depth_m": depth, "method": "bored"} if pile_count and depth else {"count": 0})
data["exportedAt"] = datetime.datetime.now().isoformat()

path = forms.save_file(file_ext="json", default_name="sa_revit_export.json")
if path:
    with io.open(path, "w", encoding="utf-8") as fh:
        fh.write(json.dumps(data, ensure_ascii=False, indent=1))
    out.print_md(u"**저장 완료** — 레벨 {} · 요소 {} · 파일 {}본\n\n`{}`".format(len(data["levels"]), len(rows), pile_count, path))
