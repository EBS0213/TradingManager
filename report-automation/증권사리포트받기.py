#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""네이버에 없는 증권사의 리포트를 그 증권사 홈페이지에서 받습니다 (2026-10-04)

  python3 증권사리포트받기.py                  워치리스트 종목 + 산업·전략
  python3 증권사리포트받기.py 005930 096530    종목코드를 직접 (기업분석만)
  python3 증권사리포트받기.py --목록 제작목록.txt   그 목록(코드,종목명)의 기업분석만
  python3 증권사리포트받기.py --산업만           산업·전략만
  python3 증권사리포트받기.py --확인             받을 것만 세어 보고 내려받지 않음

왜 만들었나
  2026-10-05 부터 와이즈리포트를 못 씁니다. 와이즈는 NH·KB 같은 **네이버에 리포트를
  안 내는 증권사**까지 받아 주었는데, `네이버리포트받기.py` 만으로는 그쪽이 빕니다.
  이 파일이 그 빈자리 중 **무인으로 받을 수 있는 곳**을 채웁니다.

어느 증권사를 받는가 — 2026-10-04 에 한 곳씩 확인했습니다
  ○ KB증권     rc.kbsec.com 목록 JSON + rdata.kbsec.com PDF.  로그인 없음, robots.txt 없음
  ○ BNK투자증권 bnkfn.co.kr 목록 HTML + /uploads/ PDF.        로그인 없음, robots.txt 없음
  ✗ NH투자증권  목록은 공개지만 PDF 는 「계좌보유고객 로그인」 뒤에 있습니다. 로그인은
               AhnLab ASTx2 보안모듈을 거쳐 아이디·비밀번호만으로 자동화가 안 됩니다.
               robots.txt 도 전부 막아 둡니다.
  ✗ LS증권     리서치 전체가 로그인 뒤(기업분석은 계좌고객만). ASTx2 + 키보드보안.
  ✗ 한국투자증권 IPinside 보안프로그램이 있어야 로그인됩니다(`한투리포트받기.py` 참고).
  ✗ 신영증권   PDF 주소가 열려 있긴 하지만, 사이트는 내려받기 전에 휴대폰 인증을 받게
               해 두었고 robots.txt 도 막아 둡니다. 그 인증을 건너뛰는 일이라 받지 않습니다.
  - 신한투자증권 네이버에 PDF 까지 올라옵니다(2026-10-04 에 607건 중 빠진 것 1건).
               신한 자체 서버(bbs2)는 robots.txt 로 막혀 있어 따로 긁지 않습니다.

  ※ 막힌 곳의 PDF 가 꼭 필요하면 사람이 브라우저로 로그인해 받아 입력 폴더에 넣으십시오.
    그 뒤는 제작이 그대로 읽습니다. `증권사계정.py` 의 계정은 그때 쓰라고 남겨 둡니다.

어디에 넣는가 — `네이버리포트받기.py` 와 같은 세 폴더, 같은 이름 꼴입니다
  기업분석 → 입력_리포트PDF/<종목명>/   산업 → 입력_산업리포트PDF/   그 밖 → 입력_전략리포트PDF/

★ 원문 PDF 는 **읽는 재료로만** 씁니다. 게시하거나 통째로 옮기지 않습니다.
"""
from __future__ import annotations
import datetime as dt
import html
import json
import os
import pathlib
import re
import sys
import time
import unicodedata as u
from urllib.parse import quote

import requests

ROOT = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))
import 네이버리포트받기 as 네이버   # 안전한이름 · 대상종목 · 목록파일읽기를 같이 씁니다

기록 = ROOT / "캐시" / "증권사리포트.json"
개월 = 6
종목당 = int(os.environ.get("BROKER_PER_STOCK", "3"))
산업최대 = int(os.environ.get("BROKER_INDUSTRY", "20"))   # 증권사·갈래마다
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128 Safari/537.36")
쉼 = 0.6     # 요청 사이 (초). 두 곳 모두 한도는 못 봤지만 천천히 갑니다.

S = requests.Session()
S.headers.update({"User-Agent": UA})


def nfc(x) -> str:
    return u.normalize("NFC", str(x or ""))


def 이름맞춤(x: str) -> str:
    """종목명 비교용 — 공백·괄호·대소문자를 걷어냅니다."""
    return re.sub(r"[\s()（）·.]", "", nfc(x)).upper()


# ── KB증권 ─────────────────────────────────────────────────────
KB목록 = "https://rc.kbsec.com/ajax/categoryReportList.json"
KB폴더 = {
    "기업산업": "37,38,186",
    "전략": "22,23,9,10,175,189",        # 주식전략·시황·채권/크레딧·파생
    "매크로": "8,11,12,172",              # 자산배분·매크로
}


def kb_목록(폴더: str, 시작: dt.date, 끝: dt.date, 최대쪽=40):
    """그 폴더의 기간 안 리포트. totalCount 가 늘 0 이라 빈 쪽이 나올 때까지 넘깁니다."""
    모음 = []
    for 쪽 in range(1, 최대쪽 + 1):
        몸 = {"pageNo": 쪽, "pageSize": 100,
             "registdateFrom": 시작.strftime("%Y%m%d"), "registdateTo": 끝.strftime("%Y%m%d"),
             "templateid": "", "lowTempId": "", "folderid": KB폴더[폴더], "callGbn": "RCLIST"}
        r = S.post(KB목록, json=몸, timeout=30,
                   headers={"Referer": "https://rc.kbsec.com/main.able"})
        r.raise_for_status()
        줄들 = (r.json().get("response") or {}).get("reportList") or []
        if not 줄들:
            break
        for x in 줄들:
            제목 = nfc(x.get("docTitle"))
            m = re.search(r"\((\d{6})\)", 제목)
            코드 = str(x.get("stkCd") or "")
            #  산업 리포트도 괄호에 업종 코드를 답니다 — 「증권 (401510)」 의 stkCd 는 016360.
            #  **괄호 코드와 stkCd 가 같을 때만** 기업 리포트로 봅니다.
            기업 = bool(m and m.group(1) == 코드)
            날 = str(x.get("publicDate") or "").replace(".", "-")
            if re.fullmatch(r"\d{8}", 날):
                날 = f"{날[:4]}-{날[4:6]}-{날[6:]}"
            부제 = nfc(x.get("docTitleSub"))
            모음.append({
                "증권사": "KB증권", "번호": f"KB:{x.get('documentid')}", "날": 날,
                "코드": 코드 if 기업 else "", "종목명": re.sub(r"\s*\(\d{6}\)\s*$", "", 제목) if 기업 else "",
                "제목": 부제 or 제목, "갈래": "C" if 기업 else ("I" if 폴더 == "기업산업" else "P"),
                "pdf": f"https://rdata.kbsec.com/pdf_data/{x.get('documentid')}.pdf",
            })
        time.sleep(쉼)
    return 모음


# ── BNK투자증권 ────────────────────────────────────────────────
BNK = "https://www.bnkfn.co.kr"
BNK판 = {   # 갈래: (쪽 이름, bbsId, 앞머리)
    "기업": ("analysingCompany", "analysingCompany", "C"),
    "산업": ("analysingIssue", "analysingIssue", "I"),
    "퀀트": ("economyAnalyse", "economyAnalyse", "P"),
    "시장": ("marketOverview2", "Overview2", "P"),     # 전략·채권·크레딧 (bbsId 가 쪽 이름과 다릅니다)
}
BNK줄 = re.compile(
    r"<tr>\s*<td>(\d+)</td>\s*<td class=\"TL\">\s*<a[^>]*viewAction\(this,\s*'(\d+)',\s*'([^']*)',\s*'([^']*)'\)[^>]*>([^<]*)</a>"
    r".*?<td>([^<]*)</td>.*?<td>(\d{4}\.\d{2}\.\d{2})</td>",
    re.S,
)


def bnk_목록(갈래: str, 끝날: dt.date, 최대쪽=60):
    """한 쪽에 10건. 끝날보다 오래된 줄이 나오면 멈춥니다."""
    쪽이름, 판, 앞머리 = BNK판[갈래]
    모음 = []
    for 쪽 in range(1, 최대쪽 + 1):
        r = S.get(f"{BNK}/research/{쪽이름}.jspx",
                  params={"bbsId": 판, "cmd": "list", "curPage": 쪽}, timeout=30)
        r.raise_for_status()
        줄들 = BNK줄.findall(r.text)
        if not 줄들:
            break
        오래됨 = False
        for _, 번호, 경로, 파일, 제목, _, 날 in 줄들:
            날 = 날.replace(".", "-")
            if dt.date.fromisoformat(날) < 끝날:
                오래됨 = True
                continue
            제목 = nfc(html.unescape(제목)).strip()
            m = re.match(r"\[([^/\]]+)/([^\]]+)\]\s*(.*)", 제목)    # [종목명/투자의견] 제목
            기업 = 갈래 == "기업" and m
            모음.append({
                "증권사": "BNK투자증권", "번호": f"BNK:{번호}", "날": 날, "코드": "",
                "종목명": m.group(1).strip() if 기업 else "",
                "제목": (m.group(3) if 기업 else 제목) or 제목, "갈래": 앞머리,
                "pdf": f"{BNK}{경로}/{quote(nfc(파일))}",
            })
        if 오래됨:
            break
        time.sleep(쉼)
    return 모음


# ── 받기 ───────────────────────────────────────────────────────
def 기록읽기() -> dict:
    try:
        return json.loads(기록.read_text(encoding="utf-8"))
    except Exception:
        return {}


def 기록쓰기(d: dict):
    기록.parent.mkdir(parents=True, exist_ok=True)
    기록.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")


def 내려받기(x: dict, 폴더: pathlib.Path, 본것: dict, 확인만=False) -> str:
    번호 = x["번호"]
    if 번호 in 본것:
        return "이미"
    조각 = [x["갈래"], x["날"], 네이버.안전한이름(x["증권사"], 16)]
    if x.get("코드"):
        조각.append(x["코드"])
    조각.append(네이버.안전한이름(x["제목"], 40))
    갈곳 = 폴더 / ("_".join(조각) + f"_{번호.split(':', 1)[1]}.pdf")
    if 갈곳.exists():
        본것[번호] = {"file": str(갈곳.relative_to(ROOT)), "at": "기존"}
        return "이미"
    if 확인만:
        return "받을것"
    try:
        r = S.get(x["pdf"], timeout=60, allow_redirects=True)
        몸 = r.content
    except Exception as e:
        print(f"     [오류] PDF 를 못 받았습니다 {번호}({e})")
        return "실패"
    if r.status_code != 200 or not 몸.startswith(b"%PDF"):
        print(f"     [오류] PDF 가 아닙니다 {번호}(HTTP {r.status_code})")
        return "실패"
    폴더.mkdir(parents=True, exist_ok=True)
    갈곳.write_bytes(몸)
    본것[번호] = {"file": str(갈곳.relative_to(ROOT)),
                "at": dt.datetime.now().isoformat(timespec="seconds"), "bytes": len(몸)}
    time.sleep(쉼)
    return "받음"


def 셈더하기(셈: dict, 결과: list):
    for r in 결과:
        셈[r] = 셈.get(r, 0) + 1


def 요약(결과: list) -> str:
    return " · ".join(f"{k} {결과.count(k)}" for k in dict.fromkeys(결과)) or "없음"


def main(argv) -> int:
    확인 = "--확인" in argv
    산업만 = "--산업만" in argv
    목록파일 = None
    if "--목록" in argv:
        i = argv.index("--목록")
        목록파일 = argv[i + 1] if i + 1 < len(argv) else ""
        argv = argv[:i] + argv[i + 2:]
    인자 = [a for a in argv if not a.startswith("--")]
    오늘 = dt.date.today()
    끝날 = 오늘 - dt.timedelta(days=int(30.5 * 개월))
    본것 = 기록읽기()
    셈: dict = {}
    망한곳 = []

    if not 산업만:
        종목 = 네이버.목록파일읽기(목록파일) if 목록파일 is not None else 네이버.대상종목(인자)
        종목 = {c: n for c, n in 종목.items() if re.fullmatch(r"\d{6}", c)}   # 국내만
        print(f"── 기업분석(KB·BNK) — 대상 {len(종목)}종목 · 최근 {개월}개월 · 증권사마다 종목당 최대 {종목당}건")
        줄들 = []
        if 종목:
            try:
                줄들 += [x for x in kb_목록("기업산업", 끝날, 오늘) if x["갈래"] == "C"]
            except Exception as e:
                망한곳.append("KB"); print(f"  [오류] KB 목록을 못 받았습니다({e})")
            try:
                줄들 += bnk_목록("기업", 끝날)
            except Exception as e:
                망한곳.append("BNK"); print(f"  [오류] BNK 목록을 못 받았습니다({e})")
        이름표 = {이름맞춤(n): c for c, n in 종목.items()}
        for x in 줄들:          # BNK 는 코드가 없어 종목명으로 맞춥니다
            if not x["코드"]:
                x["코드"] = 이름표.get(이름맞춤(x["종목명"]), "")
        for 코드, 이름 in 종목.items():
            결과 = []
            for 곳 in ("KB증권", "BNK투자증권"):
                것들 = sorted((x for x in 줄들 if x["코드"] == 코드 and x["증권사"] == 곳),
                            key=lambda v: v["날"], reverse=True)[:종목당]
                폴더 = ROOT / "입력_리포트PDF" / 네이버.안전한이름(이름, 40)
                결과 += [내려받기(x, 폴더, 본것, 확인) for x in 것들]
            셈더하기(셈, 결과)
            if 결과:
                print(f"   · {코드} {이름[:16]:<18} {요약(결과)}")

    if (not 인자 and 목록파일 is None) or 산업만:
        #  산업·전략은 매일 새 것만 받으면 되므로 두 주만 봅니다.
        최근 = 오늘 - dt.timedelta(days=14)
        print(f"\n── 산업·전략(KB·BNK) — 최근 14일 · 갈래마다 최대 {산업최대}건")
        묶음 = []
        for 이름, 함수 in (("KB 산업", lambda: [x for x in kb_목록("기업산업", 최근, 오늘) if x["갈래"] == "I"]),
                         ("KB 전략", lambda: kb_목록("전략", 최근, 오늘)),
                         ("KB 매크로", lambda: kb_목록("매크로", 최근, 오늘)),
                         ("BNK 산업", lambda: bnk_목록("산업", 최근, 3)),
                         ("BNK 시장", lambda: bnk_목록("시장", 최근, 3)),
                         ("BNK 퀀트", lambda: bnk_목록("퀀트", 최근, 3))):
            try:
                묶음.append((이름, 함수()[:산업최대]))
            except Exception as e:
                망한곳.append(이름); print(f"  [오류] {이름} 목록을 못 받았습니다({e})")
        for 이름, 줄들 in 묶음:
            결과 = []
            for x in 줄들:
                폴더 = ROOT / ("입력_산업리포트PDF" if x["갈래"] == "I" else "입력_전략리포트PDF")
                결과.append(내려받기(x, 폴더, 본것, 확인))
            셈더하기(셈, 결과)
            print(f"   · {이름:<8} {len(줄들):>3}건 → {요약(결과)}")

    if not 확인:
        기록쓰기(본것)
    print("\n" + (" · ".join(f"{k} {v}" for k, v in 셈.items() if v) or "받을 것이 없습니다"))
    if 망한곳:
        print(f"[오류] 목록을 못 받은 곳: {', '.join(망한곳)} — 사이트 구조가 바뀌었을 수 있습니다")
    if 셈.get("받음") and not 확인:
        print("※ 원문 PDF 는 읽는 재료로만 씁니다 — 게시하거나 통째로 옮기지 마십시오.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
