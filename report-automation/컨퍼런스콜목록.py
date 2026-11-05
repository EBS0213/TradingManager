#!/usr/bin/env python3
"""홈페이지 「데이터 → 컨퍼런스콜」에 담긴 요약 목록을 만든다.

  python3 컨퍼런스콜목록.py             목록을 새로 만들어 파일에 쓰고 화면에도 보여 준다
  python3 컨퍼런스콜목록.py --보기만     파일을 쓰지 않는다

사이트가 원본입니다. 이 목록은 사이트에서 읽어 옵니다 — 여기 있는데 사이트에 없는 일은
없습니다. 반대로 `브리핑/*/컨퍼런스콜_*.json` 에만 있고 사이트에 없는 것은 「안 올라간 것」
으로 따로 적어 둡니다. 그것이 2026-09-15 에 열 건이 조용히 빠져 있던 자리입니다.
"""
import json
import os
import pathlib
import sys
import urllib.request

뿌리 = pathlib.Path(__file__).resolve().parent
사이트 = os.environ.get("TM26_URL", "http://127.0.0.1:8766").rstrip("/")
목록파일 = 뿌리 / "브리핑" / "컨퍼런스콜_목록.md"


def 키찾기():
    k = os.environ.get("SCREENER_KEY", "").strip()
    if k:
        return k
    p = pathlib.Path.home() / ".tm26_key"
    return p.read_text(encoding="utf-8").strip() if p.exists() else ""


def 사이트목록(키):
    요청 = urllib.request.Request(사이트 + "/api/calls", headers={"x-screener-key": 키})
    with urllib.request.urlopen(요청, timeout=90) as r:
        답 = json.loads(r.read().decode("utf-8"))
    if not 답.get("ok"):
        raise RuntimeError("사이트가 목록을 주지 않았습니다: " + str(답.get("error"))[:120])
    return 답.get("items") or [], 답.get("updated_at") or ""


def 로컬요약():
    """브리핑 폴더에 만들어 둔 요약. 어느 날 배치에서 나왔는지 같이 들고 있는다."""
    결과 = {}
    for f in sorted((뿌리 / "브리핑").glob("*/컨퍼런스콜_*.json")):
        try:
            items = json.loads(f.read_text(encoding="utf-8")).get("items") or []
        except (ValueError, OSError):
            continue
        for x in items:
            결과[(str(x.get("code") or ""), str(x.get("quarter") or ""))] = f.relative_to(뿌리)
    return 결과


def 만들기(items, updated_at, 로컬):
    담김 = {(str(x.get("code") or ""), str(x.get("quarter") or "")) for x in items}
    안올라간것 = sorted((k, v) for k, v in 로컬.items() if k not in 담김)
    줄 = ["# 컨퍼런스콜 요약 목록", "",
          f"홈페이지 **데이터 → 컨퍼런스콜** 탭에 담긴 것입니다 — 모두 **{len(items)}건**.",
          f"{사이트}/screener#macro", ""]
    if updated_at:
        줄.append(f"사이트 최종 갱신: `{updated_at}`")
        줄.append("")
    줄 += ["이 파일은 `컨퍼런스콜목록.py` 가 사이트에서 읽어 만듭니다. 손으로 고치지 마십시오.", "",
          "| 발표일 | 티커 | 회사 | 분기 | 업종 | 한 줄 |", "|---|---|---|---|---|---|"]
    for x in sorted(items, key=lambda x: (str(x.get("date") or ""), str(x.get("code") or "")), reverse=True):
        한줄 = str(x.get("headline") or "").replace("|", "·").strip()
        if len(한줄) > 70:
            한줄 = 한줄[:69] + "…"
        줄.append(f"| {x.get('date','')} | `{x.get('code','')}` | {x.get('name','')} | "
                  f"{x.get('quarter','')} | {x.get('sector','')} | {한줄} |")
    줄 += ["", "## 아직 안 올라간 것", ""]
    if 안올라간것:
        줄.append("만들어는 뒀는데 사이트에 없는 것입니다. `컨퍼런스콜올리기.py <파일>` 로 올립니다.")
        줄.append("")
        for (code, quarter), 파일 in 안올라간것:
            줄.append(f"- `{code}` {quarter} — `{파일}`")
    else:
        줄.append("없습니다. 만들어 둔 요약이 모두 올라가 있습니다.")
    줄.append("")
    return "\n".join(줄), 안올라간것


def main() -> int:
    키 = 키찾기()
    if not 키 or len(키) < 20:
        print("SCREENER_KEY 를 찾지 못했습니다 (~/.tm26_key)."); return 2
    try:
        items, updated_at = 사이트목록(키)
    except Exception as e:
        print("사이트 목록을 읽지 못했습니다:", e); return 1
    글, 안올라간것 = 만들기(items, updated_at, 로컬요약())
    if "--보기만" not in sys.argv:
        목록파일.parent.mkdir(parents=True, exist_ok=True)
        임시 = 목록파일.with_name(목록파일.name + ".tmp")
        임시.write_text(글, encoding="utf-8")
        임시.replace(목록파일)
        print(f"목록을 썼습니다 → {목록파일.relative_to(뿌리)}")
    print(글)
    if 안올라간것:
        print(f"\n※ 사이트에 없는 요약이 {len(안올라간것)}건 있습니다.")
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
