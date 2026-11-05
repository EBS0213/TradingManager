#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""네이버 금융에 올라온 증권사 리포트를 받아 입력 폴더를 채웁니다 (2026-10-03)

  python3 네이버리포트받기.py              제작 대상 종목 + 산업·전략 전부
  python3 네이버리포트받기.py 005930 096530  종목코드를 직접 (종목분석만)
  python3 네이버리포트받기.py --산업만        산업·전략만
  python3 네이버리포트받기.py --확인          받을 것만 세어 보고 내려받지 않음
  python3 네이버리포트받기.py --목록 제작목록.txt   그 목록(코드,종목명)의 종목분석만
                                              (자동제작이 종목을 고른 뒤 부릅니다.
                                               국내 여섯 자리 코드만 보고 미국은 건너뜁니다)

왜 만들었나
  `와이즈수집.py` 는 한국투자증권에 **로그인해서** 받습니다. 그래서 받히는 범위가
  한국투자 + 제휴사뿐이고, `입력_리포트PDF` 에 32건밖에 없었습니다.
  네이버 금융은 국내 증권사 열여섯 곳의 리포트를 **로그인 없이 PDF 까지** 내려줍니다
  (2026-10-01 에 1년치 10,900건을 훑어 확인했고, 표본 PDF 도 200 으로 받아집니다).

  계정이 필요한 곳은 따로 있습니다 — 네이버에 리포트를 안 내는 NH·KB·LS·신영·BNK,
  그리고 PDF 가 안 딸려 오는 한국투자증권·신한투자증권(가끔)입니다.
  그쪽은 `증권사계정.py` 로 계정을 넣고 따로 받습니다. **이 파일은 계정이 필요 없습니다.**

받는 길 (세 번 두드립니다)
  ① 목록   /api/research/<갈래>?page=N&pageSize=100   → researchId · 종목코드 · 증권사 · 날짜
  ② 상세   /api/research/company/<researchId>          → attachUrl (PDF 직링크)
  ③ 원문   stock.pstatic.net/stock-research/…pdf

어디에 넣는가 — 제작지시 §2 가 읽는 세 폴더 그대로입니다
  종목분석                        → 입력_리포트PDF/<종목명>/
  산업분석                        → 입력_산업리포트PDF/
  시황정보·경제분석·투자전략·채권분석  → 입력_전략리포트PDF/

★ 원문 PDF 는 **읽는 재료로만** 씁니다. 게시하거나 통째로 옮기지 않습니다.
  지금 와이즈 PDF 를 쓰는 방식과 같습니다.
"""
from __future__ import annotations
import csv
import datetime as dt
import io
import json
import os
import pathlib
import re
import sys
import time
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent
머리 = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                     "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
       "Referer": "https://m.stock.naver.com/"}
목록 = "https://m.stock.naver.com/api/research/{갈래}?page={쪽}&pageSize=100"
상세 = "https://m.stock.naver.com/api/research/company/{번호}"
기록 = ROOT / "캐시" / "네이버리포트.json"

#  갈래 → (넣을 폴더, 파일 이름 앞머리)
갈래표 = {
    "company":   ("입력_리포트PDF", "C"),
    "industry":  ("입력_산업리포트PDF", "I"),
    "market":    ("입력_전략리포트PDF", "P"),
    "economy":   ("입력_전략리포트PDF", "P"),
    "invest":    ("입력_전략리포트PDF", "P"),
    "debenture": ("입력_전략리포트PDF", "P"),
}
개월 = 6
종목당 = int(os.environ.get("NAVER_PER_STOCK", "5"))
#  갈래마다 몇 건까지 — 다섯 갈래라 이 값의 다섯 배가 한 번에 받는 양입니다.
#  처음 한 번만 많이 받고 그 뒤로는 새 것만 받습니다(받은 번호를 캐시에 적습니다).
산업최대 = int(os.environ.get("NAVER_INDUSTRY", "40"))

#  회사가 비용을 대는 의뢰 리포트는 받지 않습니다 — 목표주가·추정치가 없는 일이 많습니다
#  (증권사커버.py 의 같은 목록과 맞춰 두십시오)
비증권사 = {"한국IR협의회", "NICE평가정보", "서울평가정보", "나이스디앤비",
          "한국기업데이터", "이크레더블", "코스콤", "딥서치", "한국기술신용평가(주)"}


def 받기(url: str, 글자=True, 시도=3):
    마지막 = None
    for i in range(시도):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=머리),
                                        timeout=30) as 답:
                몸 = 답.read()
            return json.loads(몸.decode()) if 글자 else 몸
        except Exception as e:
            마지막 = e
            time.sleep(0.6 * (i + 1))
    raise RuntimeError(f"받기 실패({마지막}): {url[:90]}")


def 안전한이름(s: str, 길이=60) -> str:
    """파일 이름에 쓸 수 있게 다듬습니다. 슬래시·따옴표 따위를 걷어냅니다."""
    s = re.sub(r"[\\/:*?\"<>|\n\r\t]", " ", str(s or ""))
    s = re.sub(r"\s+", " ", s).strip()
    #  **공백을 가운뎃줄로 바꿉니다.** 파일 이름에 공백이 있으면 셸 변수·shebang·
    #  정규식에서 연달아 깨집니다(2026-10-01 에 `out/LTC_LTC/LTC Properties_….html`
    #  때문에 인계 파서가 경로를 못 읽은 일이 있었습니다). 한글 제목은 그대로 남아
    #  업종·주제로 찾는 데 지장이 없습니다.
    s = s.replace(" ", "-")
    return s[:길이].strip("-") or "무제"


def 기록읽기() -> dict:
    try:
        return json.loads(기록.read_text(encoding="utf-8"))
    except Exception:
        return {}


def 기록쓰기(d: dict):
    기록.parent.mkdir(parents=True, exist_ok=True)
    기록.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")


def 목록훑기(갈래: str, 끝날: dt.date, 최대쪽=80):
    """그 갈래의 최근 리포트를 끝날 이후까지 모읍니다."""
    모음 = []
    for 쪽 in range(1, 최대쪽 + 1):
        try:
            줄들 = 받기(목록.format(갈래=갈래, 쪽=쪽))
        except Exception as e:
            print(f"  [오류] {갈래} {쪽}쪽에서 막혔습니다({e})")
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
            if 날 < 끝날:
                continue
            if (x.get("brokerName") or "") in 비증권사:
                continue
            모음.append(x)
        if 가장오래 and 가장오래 < 끝날:
            break
        time.sleep(0.04)
    return 모음


def 첨부주소(번호) -> str:
    d = 받기(상세.format(번호=번호))
    칸 = d.get("researchContent") or d
    u = str(칸.get("attachUrl") or "")
    return u if u.lower().endswith(".pdf") else ""


def 내려받기(x, 폴더: pathlib.Path, 앞머리: str, 본것: dict, 확인만=False):
    """한 건을 받아 폴더에 넣습니다. 이미 있으면 건너뜁니다."""
    번호 = str(x.get("researchId"))
    if 번호 in 본것:
        return "이미"
    코드 = str(x.get("itemCode") or "").zfill(6) if x.get("itemCode") else ""
    조각 = [앞머리, str(x.get("writeDate") or ""), 안전한이름(x.get("brokerName"), 16)]
    if 코드:
        조각.append(코드)
    조각.append(안전한이름(x.get("title"), 40))
    이름 = "_".join(조각) + f"_{번호}.pdf"
    갈곳 = 폴더 / 이름
    if 갈곳.exists():
        본것[번호] = {"file": str(갈곳.relative_to(ROOT)), "at": "기존"}
        return "이미"
    if 확인만:
        return "받을것"
    try:
        u = 첨부주소(번호)
    except Exception as e:
        print(f"     [오류] 상세를 못 읽었습니다 {번호}({e})")
        return "실패"
    if not u:
        본것[번호] = {"file": None, "at": dt.datetime.now().isoformat(timespec="seconds"),
                    "note": "PDF 없음(홈페이지 경유)"}
        return "PDF없음"
    try:
        몸 = 받기(u, 글자=False)
    except Exception as e:
        print(f"     [오류] PDF 를 못 받았습니다 {번호}({e})")
        return "실패"
    if not 몸.startswith(b"%PDF"):
        return "실패"
    폴더.mkdir(parents=True, exist_ok=True)
    갈곳.write_bytes(몸)
    본것[번호] = {"file": str(갈곳.relative_to(ROOT)),
                "at": dt.datetime.now().isoformat(timespec="seconds"),
                "bytes": len(몸)}
    time.sleep(0.08)
    return "받음"


def 목록파일읽기(파일: str) -> dict:
    """제작목록.txt 꼴(`코드,종목명` 한 줄씩)에서 국내 종목만 {코드: 종목명} 으로."""
    본 = {}
    try:
        줄들 = pathlib.Path(파일).read_text(encoding="utf-8-sig").splitlines()
    except Exception as e:
        print(f"  [오류] 목록 파일을 못 읽었습니다({파일}: {e})")
        return 본
    for 줄 in 줄들:
        코드, _, 이름 = 줄.strip().partition(",")
        코드 = 코드.strip()
        if re.fullmatch(r"\d{6}", 코드):
            본[코드] = 이름.strip() or 코드
    return 본


def 대상종목(인자) -> dict:
    """{코드: 종목명}. 코드를 주면 그것만, 안 주면 워치리스트를 씁니다."""
    준것 = [a.upper() for a in 인자 if re.fullmatch(r"\d{6}|[A-Z.]{1,6}", a.upper())]
    본 = {}
    for f in sorted((ROOT / "관심종목").glob("*.csv")):
        with f.open(encoding="utf-8-sig") as fp:
            for row in csv.DictReader(fp):
                c = (row.get("코드") or "").strip().strip('"').upper()
                n = (row.get("종목명") or "").strip().strip('"') or c
                if c:
                    본.setdefault(c, n)
    if 준것:
        return {c: 본.get(c, c) for c in 준것}
    return 본


def main(argv) -> int:
    확인 = "--확인" in argv
    산업만 = "--산업만" in argv
    목록파일 = None
    if "--목록" in argv:
        i = argv.index("--목록")
        목록파일 = argv[i + 1] if i + 1 < len(argv) else ""
        argv = argv[:i] + argv[i + 2:]
    인자 = [a for a in argv if not a.startswith("--")]
    끝날 = dt.date.today() - dt.timedelta(days=int(30.5 * 개월))
    본것 = 기록읽기()
    셈 = {"받음": 0, "이미": 0, "PDF없음": 0, "실패": 0, "받을것": 0}

    if not 산업만:
        종목 = 목록파일읽기(목록파일) if 목록파일 is not None else 대상종목(인자)
        print(f"── 종목분석 — 대상 {len(종목)}종목 · 최근 {개월}개월 · 종목당 최대 {종목당}건")
        줄들 = 목록훑기("company", 끝날)
        묶음: dict[str, list] = {}
        for x in 줄들:
            c = str(x.get("itemCode") or "").zfill(6)
            묶음.setdefault(c, []).append(x)
        for 코드, 이름 in 종목.items():
            것들 = sorted(묶음.get(코드, []),
                        key=lambda v: str(v.get("writeDate")), reverse=True)[:종목당]
            if not 것들:
                print(f"   · {코드} {이름[:16]:<18} 네이버에 최근 리포트가 없습니다")
                continue
            if 이름 == 코드:      # 워치리스트에 없는 종목 — 네이버가 붙인 이름을 씁니다
                이름 = str(것들[0].get("itemName") or 코드)
            폴더 = ROOT / "입력_리포트PDF" / 안전한이름(이름, 40)
            결과 = [내려받기(x, 폴더, "C", 본것, 확인) for x in 것들]
            for r in 결과:
                셈[r] = 셈.get(r, 0) + 1
            print(f"   · {코드} {이름[:16]:<18} "
                  + " · ".join(f"{k} {결과.count(k)}" for k in dict.fromkeys(결과)))

    if (not 인자 and 목록파일 is None) or 산업만:
        print(f"\n── 산업·전략 — 최근 {개월}개월 · 갈래마다 최대 {산업최대}건")
        for 갈래 in ("industry", "market", "economy", "invest", "debenture"):
            폴더이름, 앞머리 = 갈래표[갈래]
            줄들 = 목록훑기(갈래, 끝날)[:산업최대]
            폴더 = ROOT / 폴더이름
            결과 = [내려받기(x, 폴더, 앞머리, 본것, 확인) for x in 줄들]
            for r in 결과:
                셈[r] = 셈.get(r, 0) + 1
            print(f"   · {갈래:<10} {len(줄들):>4}건 → "
                  + " · ".join(f"{k} {결과.count(k)}" for k in dict.fromkeys(결과) ) or "없음")

    if not 확인:
        기록쓰기(본것)
    print("\n" + " · ".join(f"{k} {v}" for k, v in 셈.items() if v))
    if 셈.get("받음") and not 확인:
        print("※ 원문 PDF 는 읽는 재료로만 씁니다 — 게시하거나 통째로 옮기지 마십시오.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
