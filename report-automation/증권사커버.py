#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""증권사가 최근 이 종목을 다뤘는가 — 국내 종목 커버리지 색인 (2026-09-28)

  python3 증권사커버.py            색인을 새로 받아 캐시에 적고 요약을 찍는다
  python3 증권사커버.py 005930 …   그 종목들의 최근 커버 상황만 본다

왜 필요한가 (2026-09-28 사용자 지시)
  「스카우트 80점 이상을 모두 커버하되, **어느 증권사도 최근 6개월간 다루지 않은
   종목은 제작에서 제외**」

  증권사가 한 곳도 안 보는 종목은 비교할 컨센서스도, 검증에 쓸 남의 추정도 없습니다.
  그런 종목의 보고서는 우리 추정만으로 채워져 검증 강도가 크게 떨어집니다.

자료는 어디서 받나
  네이버 금융의 '종목분석' 리포트 목록입니다. 국내 증권사 20여 곳이 여기로 모입니다.
    https://m.stock.naver.com/api/research/company?page=N&pageSize=100
  종목별 주소는 없어서 **목록을 6개월치 훑어 코드→최근 날짜 색인**을 만듭니다.
  100건씩 약 53쪽, 6초쯤 걸립니다. 하루 한 번만 새로 받고 그 뒤로는 캐시를 씁니다.

  ※ 예전 주소(`finance.naver.com/research/company_list.naver`)는 2026-09 에
    stock.naver.com 으로 옮겨져 302 로 죽었습니다. 표를 긁지 않고 JSON 을 씁니다.

국내 전용입니다
  미국 종목(CDNA·DELL·ANET 등)은 이 목록에 없습니다. **여섯 자리 숫자 코드가
  아니면 판정하지 않고 `None` 을 돌려줍니다** — 부르는 쪽에서 '커버 없음' 과
  '판정 불가' 를 섞지 마십시오. 섞으면 미국 종목이 통째로 제작에서 빠집니다.
"""
from __future__ import annotations
import datetime as dt
import json
import pathlib
import re
import sys
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
캐시 = ROOT / "캐시" / "증권사커버.json"
목록주소 = "https://m.stock.naver.com/api/research/company?page={p}&pageSize=100"
머리 = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                     "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
       "Referer": "https://m.stock.naver.com/"}
개월 = 6
하루 = 86400
국내코드 = re.compile(r"^\d{6}$")

#  이 목록에는 증권사가 아닌 곳도 섞입니다 — 한국IR협의회·평가기관의 **의뢰 리포트**입니다.
#  그런 글은 회사가 비용을 대고 쓰이는 소개서에 가깝고, 목표주가·추정치를 내지 않는 일이
#  많습니다. 「증권사 어느 누구도 안 다룬 종목은 뺀다」는 지시의 뜻은 **애널리스트 커버리지**
#  이므로 이쪽은 증권사로 세지 않습니다. 대신 기록은 남겨 두어 언제든 되돌릴 수 있게 합니다.
비증권사 = {"한국IR협의회", "NICE평가정보", "서울평가정보", "나이스디앤비",
          "한국기업데이터", "이크레더블", "코스콤", "딥서치"}


def 증권사인가(곳: str) -> bool:
    곳 = (곳 or "").strip()
    return bool(곳) and 곳 not in 비증권사


def _받기(url: str):
    요청 = urllib.request.Request(url, headers=머리)
    with urllib.request.urlopen(요청, timeout=15) as 답:
        return json.loads(답.read().decode())


def 새로받기(verbose: bool = True) -> dict:
    """6개월치 종목분석 목록을 훑어 코드 → [날짜, 증권사, 종목명] 을 만든다."""
    끝 = dt.date.today() - dt.timedelta(days=int(30.5 * 개월))
    최근: dict[str, list] = {}
    쪽 = 0
    t0 = time.time()
    for 쪽 in range(1, 200):
        try:
            줄들 = _받기(목록주소.format(p=쪽))
        except Exception as e:
            print(f"[오류] 증권사 리포트 목록을 받다가 막혔습니다({e}) — {쪽}쪽에서 멈춥니다")
            break
        if not 줄들:
            break
        가장오래 = None
        for x in 줄들:
            try:
                날 = dt.date.fromisoformat(str(x.get("writeDate")))
            except Exception:
                continue
            가장오래 = 날
            코드 = str(x.get("itemCode") or "").zfill(6)
            if not 국내코드.match(코드) or 날 < 끝:
                continue
            곳 = x.get("brokerName") or ""
            칸 = 최근.setdefault(코드, {"이름": x.get("itemName") or "",
                                     "아무나": None, "증권사": None})
            for 키, 조건 in (("아무나", True), ("증권사", 증권사인가(곳))):
                if not 조건:
                    continue
                앞 = 칸[키]
                if not 앞 or 날 > dt.date.fromisoformat(앞[0]):
                    칸[키] = [str(날), 곳]
        if 가장오래 and 가장오래 < 끝:
            break
        time.sleep(0.05)

    if len(최근) < 100:
        # 목록 주소가 또 바뀌면 여기서 조용히 0건이 됩니다. 시끄럽게 알립니다.
        print(f"[오류] 증권사 커버 색인이 {len(최근)}종목뿐입니다 — "
              f"주소({목록주소}) 가 또 바뀌었을 수 있습니다")

    묶음 = {"갱신": dt.datetime.now().isoformat(timespec="seconds"),
           "기준일": str(끝), "쪽수": 쪽, "종목": 최근}
    캐시.parent.mkdir(parents=True, exist_ok=True)
    캐시.write_text(json.dumps(묶음, ensure_ascii=False), encoding="utf-8")
    if verbose:
        print(f"  증권사 커버 색인 — {쪽}쪽 훑어 {len(최근):,}종목 "
              f"({끝} 이후) · {time.time() - t0:.1f}초")
    return 묶음


def 색인(최대나이초: int = 하루, verbose: bool = False) -> dict:
    """캐시를 쓰되 하루가 지났으면 새로 받는다."""
    if 캐시.exists():
        try:
            묶음 = json.loads(캐시.read_text(encoding="utf-8"))
            갱신 = dt.datetime.fromisoformat(묶음["갱신"])
            if (dt.datetime.now() - 갱신).total_seconds() < 최대나이초 and 묶음.get("종목"):
                return 묶음
        except Exception:
            pass
    return 새로받기(verbose=verbose)


def 커버(코드: str, 표=None):
    """이 종목을 최근 6개월 안에 다룬 증권사 기록.

    돌려주는 값
      [날짜, 증권사, 종목명]  다뤘다
      []                    국내 종목인데 6개월간 아무도 안 다뤘다
      None                  판정 못 한다 (미국 종목 등 — '없다' 와 섞지 마십시오)
    """
    c = str(코드 or "").strip().upper()
    if not 국내코드.match(c):
        return None
    표 = 표 if 표 is not None else 색인()
    칸 = (표.get("종목") or {}).get(c)
    if not 칸:
        return []
    r = 칸.get("증권사")
    return (r + [칸.get("이름", "")]) if r else []


def 커버_의뢰포함(코드: str, 표=None):
    """증권사가 아닌 곳(IR협의회·평가기관)까지 쳐서 본다. 참고용."""
    c = str(코드 or "").strip().upper()
    if not 국내코드.match(c):
        return None
    표 = 표 if 표 is not None else 색인()
    칸 = (표.get("종목") or {}).get(c)
    if not 칸:
        return []
    r = 칸.get("아무나")
    return (r + [칸.get("이름", "")]) if r else []


def main(argv) -> int:
    묶음 = 새로받기() if not argv else 색인(verbose=True)
    if not argv:
        종목 = 묶음.get("종목") or {}
        증 = sum(1 for v in 종목.values() if v.get("증권사"))
        print(f"  증권사가 다룬 종목 {증:,}개 · 의뢰 리포트만 있는 종목 {len(종목) - 증:,}개")
        곳 = {}
        for v in 종목.values():
            if v.get("증권사"):
                곳[v["증권사"][1]] = 곳.get(v["증권사"][1], 0) + 1
        상위 = sorted(곳.items(), key=lambda kv: -kv[1])[:8]
        print("  증권사:", ", ".join(f"{k}({v})" for k, v in 상위))
        return 0
    for c in argv:
        r = 커버(c, 묶음)
        if r is None:
            print(f"  {c:<8} 판정 안 함 (국내 종목이 아닙니다)")
        elif r:
            print(f"  {c:<8} ✓ {r[0]} {r[1]}  {r[2]}")
        else:
            print(f"  {c:<8} ✗ 최근 {개월}개월간 커버 없음")
    return 0


if __name__ == "__main__":
    sys.exit(main([a for a in sys.argv[1:] if not a.startswith("-")]))
