#!/usr/bin/env python3
"""홈페이지 워치리스트를 맥의 관심종목 CSV 에 맞춘다.

  python3 워치리스트맞추기.py            홈페이지에만 있는 종목을 맥에 더한다 (기본)
  python3 워치리스트맞추기.py --그대로     홈페이지와 똑같이 만든다 (맥에만 있던 것은 뺍니다)
  python3 워치리스트맞추기.py --확인       무엇이 달라지는지만 보여준다

왜 필요한가 (2026-09-06)
  워치리스트를 **홈페이지 「내 기록」에서** 관리하시는데, 맥의 자료수집·보고서 제작은
  `관심종목/watchlist.csv` 를 봅니다. 둘이 어긋나면 홈페이지에 새로 넣은 종목이
  맥에서는 없는 것이 되어 보고서가 안 만들어집니다. 실제로 넷이 어긋나 있었습니다.

  기본은 **더하기만** 합니다. 맥에만 있는 종목을 함부로 지우지 않습니다 —
  홈페이지에서 뺐어도 자료와 보고서는 남겨 두고 싶을 수 있기 때문입니다.
"""
import csv
import datetime as dt
import pathlib
import subprocess
import sys

뿌리 = pathlib.Path(__file__).resolve().parent


def 사이트워치() -> dict:
    r = subprocess.run([sys.executable, str(뿌리 / "내기록받기.py"), "--워치", "전체"],
                       capture_output=True, text=True, timeout=120, cwd=str(뿌리))
    if r.returncode != 0:
        raise SystemExit("홈페이지 워치리스트를 읽지 못했습니다:\n" + (r.stderr or "")[:300])
    본 = {}
    for line in r.stdout.strip().splitlines():
        if "," in line:
            c, n = line.split(",", 1)
            본[c.strip()] = n.strip()
    return 본


def main() -> int:
    확인만 = "--확인" in sys.argv
    그대로 = "--그대로" in sys.argv

    파일 = 뿌리 / "관심종목" / "watchlist.csv"
    if not 파일.exists():
        print(f"관심종목 파일이 없습니다: {파일}"); return 2

    글 = 파일.read_text(encoding="utf-8-sig")
    줄 = list(csv.DictReader(글.splitlines()))
    맥 = {str(r.get("코드", "")).strip(): r for r in 줄 if str(r.get("코드", "")).strip()}

    사이트 = 사이트워치()
    더할것 = [c for c in 사이트 if c not in 맥]
    뺄것 = [c for c in 맥 if c not in 사이트]

    print(f"맥 {len(맥)}개 · 홈페이지 {len(사이트)}개")
    print(f"· 더할 것 {len(더할것)}개: " + (", ".join(f"{c}({사이트[c]})" for c in 더할것) or "없음"))
    print(f"· 맥에만 있는 것 {len(뺄것)}개: "
          + (", ".join(f"{c}({맥[c].get('종목명','')})" for c in 뺄것) or "없음")
          + ("  → 뺍니다" if 그대로 else "  → 그대로 둡니다"))

    if 확인만:
        print("(--확인 이라 고치지 않았습니다)"); return 0
    if not 더할것 and not (그대로 and 뺄것):
        print("이미 맞습니다."); return 0

    오늘 = dt.date.today().isoformat()
    새것 = dict(맥)
    if 그대로:
        for c in 뺄것:
            새것.pop(c, None)
    for c in 더할것:
        새것[c] = {"코드": c, "종목명": 사이트[c], "메모": "", "추가일": 오늘}

    # 원본은 남겨 둡니다 — 잘못되면 되돌릴 수 있게
    백업 = 뿌리 / "백업" / f"watchlist_{dt.datetime.now():%Y%m%d_%H%M%S}.csv"
    백업.parent.mkdir(parents=True, exist_ok=True)
    백업.write_text(글, encoding="utf-8")

    with 파일.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["코드", "종목명", "메모", "추가일"], quoting=csv.QUOTE_ALL)
        w.writeheader()
        for r in 새것.values():
            w.writerow({k: r.get(k, "") for k in ("코드", "종목명", "메모", "추가일")})

    print(f"맞췄습니다 — 이제 {len(새것)}개 (원본은 {백업.name} 에 남겨 뒀습니다)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
