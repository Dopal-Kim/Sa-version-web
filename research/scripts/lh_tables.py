"""LH 주택건설공사 공사기간 산정지침(2021.9, 제2601호) 별표 → JSON.

입력: data_raw/lh/LH_지침_2021.9_text.txt (원본 PDF 텍스트 추출본)
출력: sa_ai/data/lh_rules.json
  nonwork.{earth,frame,wetfinish,dryfinish}[지역] = 월별 비작업일 12개 (별표 1~4)
  grade[지역] = 급지(1~6), alias[미산출 지역] = 기준 지역 (별표 5)
  winter[급지] = 골조 동절기 기간 [시작 MM-DD, 끝 MM-DD] (별표 7)
검증: 각 지역 행의 12개월 합 = 소계
"""
import json
import re
import os
from pathlib import Path

ROOT = Path(os.environ.get("SA_ROOT") or Path(__file__).resolve().parents[2])
SRC = ROOT / "data_raw" / "lh" / "LH_지침_2021.9_text.txt"
OUT = ROOT / "sa_ai" / "data" / "lh_rules.json"

ROW = re.compile(r"^\s*(\d{1,2})\s+([가-힣]+)\s+((?:\d{1,2}\s+){12})(\d{2,3})\s")
TABLE_PAGES = {"earth": (15, 17), "frame": (17, 19), "wetfinish": (19, 21), "dryfinish": (21, 23)}


def parse_rows(text):
    out = {}
    for line in text.splitlines():
        m = ROW.match(line)
        if not m:
            continue
        months = [int(x) for x in m.group(3).split()]
        total = int(m.group(4))
        assert sum(months) == total, f"{m.group(2)}: 월 합 {sum(months)} ≠ 소계 {total}"
        out[m.group(2)] = months
    return out


def main():
    pages = SRC.read_text(encoding="utf-8").split("\n\n===PAGE===\n")
    rules = {"source": "LH 주택건설공사 공사기간 산정지침 2021.9.17 제2601호(주택기술처), 원본 PDF", "nonwork": {}}
    for key, (a, b) in TABLE_PAGES.items():
        rows = parse_rows("\n".join(pages[a:b]))
        assert len(rows) == 77, f"{key}: 지역 {len(rows)}개(77개여야 함)"
        rules["nonwork"][key] = rows
    # 별표 5: 급지와 미산출 지역 → 기준 지역
    p5 = pages[23]
    grade, alias = {}, {}
    for g in range(1, 7):
        m = re.search(rf"{g}급지(.*?)(?={g + 1}급지|\Z)", p5, re.S)
        seg = m.group(1) if m else ""
        for name in rules["nonwork"]["frame"]:
            if re.search(rf"(?<![가-힣]){name}(?![가-힣])", seg) and name not in grade:
                grade[name] = g
        for base, alts in re.findall(r"([가-힣]+)\(([가-힣,\s]+)\)", seg):
            if base in rules["nonwork"]["frame"]:
                for a in re.split(r"[,\s]+", alts.strip()):
                    if a and a not in rules["nonwork"]["frame"]:
                        alias[a] = base
    rules["grade"], rules["alias"] = grade, alias
    # 별표 7: 급지별 골조 동절기(가열보온 양생) 기간
    p7 = pages[25]
    winter = {}
    for g, s1, s2, e1, e2 in re.findall(r"(\d)급지.*?\(\s*(\d{1,2})\.\s*(\d{1,2})\s*[～~]\s*(\d{1,2})\.\s*(\d{1,2})\s*\)", p7, re.S):
        winter[g] = [f"{int(s1):02d}-{int(s2):02d}", f"{int(e1):02d}-{int(e2):02d}"]
    rules["winter"] = winter
    OUT.write_text(json.dumps(rules, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"표 4종 × 77지역, 급지 {len(grade)}지역, 별칭 {len(alias)}, 동절기 {winter}")
    print("서울 골조:", rules["nonwork"]["frame"]["서울"], "급지", grade.get("서울"))


if __name__ == "__main__":
    main()
