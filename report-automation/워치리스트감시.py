#!/usr/bin/env python3
"""관심종목(워치리스트)이 바뀌었는지 보고, 새로 들어온 종목을 알려 준다.

  python3 워치리스트감시.py --새것     새 종목을 "코드,이름" 줄로 찍는다 (없으면 아무것도)
  python3 워치리스트감시.py --적기     지금 목록을 '봤다'고 기억한다
  python3 워치리스트감시.py --지금     기억을 지금 목록으로 맞춘다 (처음 켤 때)

「새 종목」의 뜻 — 지난번에 본 목록에 없던 코드 가운데,
  · 아직 보고서(report/*.pdf)가 없고
  · 아직 자료도 없는(out/<코드>_*/datapack.md) 것.
이미 보고서가 있는 종목을 다시 넣어도 다시 만들지 않습니다.

기억은 캐시/워치리스트_지문.json 에 둡니다.
"""
import json
import datetime as dt
import os
import pathlib
import sys
import unicodedata as u
from 보고서기록 import 보고서코드, 보고서날짜

뿌리 = pathlib.Path(__file__).resolve().parent
지문 = 뿌리 / "캐시" / "워치리스트_지문.json"


def nfc(x): return u.normalize("NFC", x or "")


def 지금목록() -> dict:
    sys.path.insert(0, str(뿌리))
    import 워치리스트도구 as W
    return W.읽기() or {}


def 본적있는것() -> set:
    try:
        return set(json.loads(지문.read_text(encoding="utf-8")).get("codes", []))
    except Exception:
        return set()


def 기억하기(본: dict):
    지문.parent.mkdir(parents=True, exist_ok=True)
    지문.write_text(json.dumps({"codes": sorted(본.keys())}, ensure_ascii=False),
                   encoding="utf-8")


def 보고서있나(코드: str, 이름: str) -> bool:
    """최근에 만든 보고서가 있으면 True.

    2026-09-08 두 곳을 고쳤습니다.
      ① 예전에는 파일 이름 **어디에든** 코드가 들어 있으면 있다고 봤습니다.
         그래서 SM · PR · GS · SUN 같은 짧은 티커가 엉뚱한 종목 파일에 걸려
         「이미 있다」고 잘못 판단했습니다. 이제 `_` 로 끊은 **조각과 통째로** 견줍니다.
      ② 날짜를 봅니다. 재제작일수(기본 30일)가 지난 보고서는 없는 것으로 칩니다.
         종목고르기.py 와 같은 규칙입니다.
    """
    보고서 = 뿌리 / "report"
    if not 보고서.is_dir():
        return False
    # 2026-10-22 — 정기 제작과 같은 코드·기준일·30일 규칙으로
    # 판단한다. 회사명 조각이나 PDF 수정시각으로 판단하면 중복/누락이 생긴다.
    재제작일수 = int(os.environ.get("REMAKE_DAYS", "20"))
    찾을코드 = nfc(코드).upper()
    오늘 = dt.date.today()
    for f in 보고서.glob("*.pdf"):
        if 보고서코드(f) == 찾을코드:
            if (오늘 - 보고서날짜(f)).days <= 재제작일수:
                return True
    return False


def main() -> int:
    본 = 지금목록()
    if not 본:
        print("워치리스트를 읽지 못했습니다.", file=sys.stderr)
        return 2

    if "--지금" in sys.argv or "--적기" in sys.argv:
        기억하기(본)
        if "--지금" in sys.argv:
            print(f"지금 관심종목 {len(본)}개를 기준으로 삼았습니다. "
                  f"이 뒤로 새로 넣는 종목만 자동으로 만듭니다.")
        return 0

    옛것 = 본적있는것()
    if not 지문.exists():
        # 처음 켠 것입니다. 지금 있는 것을 몽땅 만들어 버리면 곤란하니 기준만 잡습니다.
        기억하기(본)
        print("처음 켰습니다. 지금 관심종목을 기준으로 삼았고, 이번에는 아무것도 만들지 않습니다.",
              file=sys.stderr)
        return 0

    새것 = []
    for 코드, 이름 in 본.items():
        if 코드 in 옛것:
            continue
        # 2026-09-08 — 예전에는 `또는 자료있나(코드)` 가 붙어 있었습니다.
        #  그런데 datapack 만 있고 보고서가 없는 종목이야말로 만들어야 할 것입니다.
        #  (종목종합 보고서가 자료만 먼저 모아 두는 일이 있습니다.)
        if 보고서있나(코드, 이름):
            continue          # 최근에 만든 보고서가 있습니다
        새것.append((코드, 이름))

    for 코드, 이름 in 새것:
        print(f"{코드},{이름}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
