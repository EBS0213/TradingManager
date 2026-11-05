#!/usr/bin/env python3
"""한국투자증권 「독점 글로벌 리서치」 목록을 받아 둔다. (2026-09-14 신설)

    "$PY3" 한투리서치받기.py --새것              새로 올라온 것만 받아서 쌓고 찍는다
    "$PY3" 한투리서치받기.py --새것 --쪽수 10     더 깊이 (한 쪽 10건)
    "$PY3" 한투리서치받기.py --목록 --갈래 report 다른 갈래를 그냥 보기만
    "$PY3" 한투리서치받기.py --찾기 TSM           쌓아 둔 것에서 찾기

무엇이 받아지고 무엇이 안 받아지나 — 2026-09-14 실물 확인
    ○ **목록은 로그인 없이 공개됩니다.** 갈래·제목·요약·애널리스트·날짜까지 옵니다.
      요약(body_sub)에 결론 문장이 들어 있어 그것만으로도 쓸 만합니다.
    ✗ **PDF 원문은 로그인해야 합니다.** 원문 단추는 `StrategyDetail.jsp?cmd=loginCheck`
      를 거치는데, 로그인 안 한 상태면 로그인 화면 주소를 돌려줍니다.
      그런데 한국투자증권 로그인은 **Xecure 보안키보드·전자서명 모듈**을 거칩니다.
      자동 로그인은 그 보안장치를 우회하는 일이라 **하지 않습니다.**
      원문이 필요하면 브라우저에서 직접 받아 `입력_전략리포트PDF/` 에 넣으십시오 —
      그 뒤는 기존 `리포트넣기.py` 흐름이 그대로 처리합니다.

저작권
    스티펠·국태해통증권 같은 **제휴사 저작물**입니다. 목록과 요약은 우리가 읽는 자료로만
    쓰고, **원문을 게시판에 옮기지 마십시오.** 보고서에는 우리 말로 쓴 해석만 싣습니다.

쌓이는 곳: `캐시/한투리서치.json`
"""
from __future__ import annotations

import html
import json
import pathlib
import re
import sys
from datetime import datetime

import requests

뿌리 = pathlib.Path(__file__).resolve().parent
담는곳 = 뿌리 / "캐시" / "한투리서치.json"
사이트 = "https://securities.koreainvestment.com"
목록주소 = 사이트 + "/main/research/research/Search.jsp"
한꺼번에 = "?cmd=TF07ae000000_List_v2_all"        # 모든 갈래 요약 화면
갈래하나 = "?cmd=TF07ae000001_List_v2_single"      # 갈래 하나 (쪽 넘김이 된다)

갈래이름 = {"global": "독점 글로벌 리서치", "report": "리포트", "ai": "인공지능리서치",
          "spotComment": "스팟코멘트", "morningBrief": "모닝브리프",
          "recommendStock": "추천종목", "all": "모든리서치"}


def _머리() -> dict:
    return {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                          "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": 목록주소}


def _글(s: str) -> str:
    return html.unescape(re.sub(r"\s+", " ", s or "")).strip()


def 한쪽(session, 갈래: str, 쪽: int) -> list[dict]:
    """한 쪽(10건)을 뜯어 온다. 화면 구조가 바뀌면 0건이 나오므로 부른 쪽에서 살펴야 한다."""
    주소 = 목록주소 + (한꺼번에 if 갈래 == "all" else 갈래하나)
    r = session.post(주소, headers=_머리(), timeout=30,
                     data={"tab1Name": 갈래, "tab2Name": "all", "searchColumn": "all",
                           "searchValue": "", "currentPage": str(쪽)})
    r.raise_for_status()
    본문 = r.text

    덩어리 = re.split(r"<li>\s*(?=<a class=\"view_con\")", 본문)[1:]
    나온것 = []
    for d in 덩어리:
        제목 = re.search(r'<span class="body_tit">([^<]+)</span>', d)
        if not 제목:
            continue
        머리 = re.search(r'<div class="head[^"]*">([^<]+)</div>', d)
        요약 = re.search(r'<span class="body_sub">(.*?)</span>', d, re.S)
        글쓴이 = re.search(r"<em>([^<]*)</em>", d)
        때 = re.search(r"(\d{4}\.\d{2}\.\d{2})(?:\s+(\d{2}:\d{2}))?", d[제목.end():] or "")
        상세 = re.search(r"goDetail\('([^']+)'\)", d)
        pdf = re.search(r"prePdfFileView2\(\s*'([^']*)'\s*,\s*'[^']*'\s*,\s*'([^']*)'", d)
        나온것.append({
            "갈래": _글(머리.group(1)) if 머리 else "",
            "제목": _글(제목.group(1)),
            "요약": _글(re.sub(r"<[^>]+>", " ", 요약.group(1))) if 요약 else "",
            "애널리스트": _글(글쓴이.group(1)) if 글쓴이 else "",
            "날짜": 때.group(1).replace(".", "-") if 때 else "",
            "시각": (때.group(2) or "") if 때 else "",
            "상세": (사이트 + html.unescape(상세.group(1))) if 상세 else "",
            "원문파일": pdf.group(2) if pdf else "",
            "원문묶음": pdf.group(1) if pdf else "",
        })
    return 나온것


def 티커뽑기(제목: str) -> str:
    """「TSMC(ADR)(TSM USA):…」 처럼 제목에 박힌 티커를 뽑는다. 없으면 빈 글자."""
    m = re.search(r"\(([A-Z0-9]{1,6})\s+(USA|HKG|JPN|KOR)\)", 제목)
    if m:
        return m.group(1)
    m = re.search(r"\((\d{6})\)", 제목)              # 국내 종목코드
    return m.group(1) if m else ""


def 쌓인것() -> dict:
    if 담는곳.exists():
        try:
            return json.loads(담는곳.read_text(encoding="utf-8"))
        except Exception:                            # noqa: BLE001
            pass
    return {"갱신": "", "글": {}}


def 열쇠(r: dict) -> str:
    return r.get("원문파일") or f"{r.get('날짜')}|{r.get('제목')}"


def 받기(갈래: str = "global", 쪽수: int = 3) -> list[dict]:
    쌓임 = 쌓인것()
    s = requests.Session()
    s.get(목록주소, headers={"User-Agent": _머리()["User-Agent"]}, timeout=30)   # 쿠키 한 번

    새것, 본수 = [], 0
    for 쪽 in range(1, 쪽수 + 1):
        줄들 = 한쪽(s, 갈래, 쪽)
        if not 줄들:
            print(f"  {쪽}쪽에서 한 건도 못 뜯었습니다. 화면 구조가 바뀌었을 수 있습니다.",
                  file=sys.stderr)
            break
        본수 += len(줄들)
        for r in 줄들:
            k = 열쇠(r)
            if k in 쌓임["글"]:
                continue
            r["티커"] = 티커뽑기(r["제목"])
            r["받은때"] = datetime.now().isoformat(timespec="seconds")
            r["탭"] = 갈래
            쌓임["글"][k] = r
            새것.append(r)

    쌓임["갱신"] = datetime.now().isoformat(timespec="seconds")
    담는곳.parent.mkdir(parents=True, exist_ok=True)
    담는곳.write_text(json.dumps(쌓임, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  {갈래이름.get(갈래, 갈래)} {쪽수}쪽 {본수}건을 봤습니다 · "
          f"새것 {len(새것)}건 · 쌓인 것 모두 {len(쌓임['글'])}건")
    return 새것


def 찍기(줄들: list[dict]) -> None:
    for r in sorted(줄들, key=lambda r: (r.get("날짜", ""), r.get("시각", "")), reverse=True):
        표 = f"{r['날짜']} [{r['갈래']}]"
        티 = f" ({r['티커']})" if r.get("티커") else ""
        print(f"  {표} {r['제목'][:60]}{티}")
        if r.get("요약"):
            print(f"      {r['요약'][:110]}")


def main() -> int:
    인자 = sys.argv[1:]
    갈래 = "global"
    쪽수 = 3
    if "--갈래" in 인자:
        갈래 = 인자[인자.index("--갈래") + 1]
    if "--쪽수" in 인자:
        쪽수 = int(인자[인자.index("--쪽수") + 1])

    if "--찾기" in 인자:
        말 = 인자[인자.index("--찾기") + 1].upper()
        쌓임 = 쌓인것()
        맞는것 = [r for r in 쌓임["글"].values()
                if 말 in (r.get("제목", "") + r.get("요약", "") + r.get("티커", "")).upper()]
        print(f"「{말}」 {len(맞는것)}건")
        찍기(맞는것)
        return 0

    if "--목록" in 인자:
        s = requests.Session()
        s.get(목록주소, headers={"User-Agent": _머리()["User-Agent"]}, timeout=30)
        모음 = []
        for 쪽 in range(1, 쪽수 + 1):
            모음 += 한쪽(s, 갈래, 쪽)
        print(f"{갈래이름.get(갈래, 갈래)} {len(모음)}건 (쌓지 않고 보기만)")
        찍기(모음)
        return 0

    if "--새것" in 인자:
        새것 = 받기(갈래, 쪽수)
        if 새것:
            print()
            찍기(새것)
        return 0

    print(__doc__)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
