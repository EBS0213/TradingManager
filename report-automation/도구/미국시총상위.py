#!/usr/bin/env python3
"""미국 시가총액 상위 N 종목 목록을 만든다. (2026-09-14 신설)

    "$PY3" 도구/미국시총상위.py --만들기            상위 100 을 새로 계산해 캐시에 담는다
    "$PY3" 도구/미국시총상위.py --만들기 --개수 50
    "$PY3" 도구/미국시총상위.py --보기              담아 둔 목록을 찍는다

왜 필요한가
    컨퍼런스콜 요약 대상이 워치리스트·보유 종목뿐이었다. 시총 상위 기업의 실적 발표는
    업종 전체의 방향을 정하므로, 우리 계좌에 없어도 읽어야 한다 (2026-09-14 사용자 지시).

어디서 받는가 — 두 길을 둔다. 한 길이 막혀도 목록이 비지 않게.
    ① 한국투자증권 오픈API (`src/kis.py`) — tomv(시가총액)를 종목마다 바로 준다. 빠르고 공식이다.
    ② SEC 주식수 × 종가 — SEC XBRL frames 한 번으로 전 상장사 주식수를 받고,
       종가는 FinanceDataReader 로 받아 곱한다. 키가 없어도 된다.

    후보군은 S&P 500 이다. 미국 시총 상위 100 은 사실상 이 안에 다 있다.
    지수에서 빠진 대형주(예: 상장 직후)는 `config.yaml` 의 `미국_추가후보` 로 보탤 수 있다.

담기는 곳: `캐시/미국시총상위.json`  — 목록·순위·시가총액·계산에 쓴 값과 날짜가 함께 들어간다.
"""
from __future__ import annotations

import json
import pathlib
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta

뿌리 = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(뿌리))
담는곳 = 뿌리 / "캐시" / "미국시총상위.json"
프레임 = ("https://data.sec.gov/api/xbrl/frames/dei/"
          "EntityCommonStockSharesOutstanding/shares/{}.json")
# 주식 종류가 둘 이상인 회사(알파벳·메타 따위)는 표지 주식수가 종류별로 나뉘어 적혀
# 위 프레임에서 통째로 빠진다. 희석주식수는 종류를 합친 값이라 그 구멍을 메운다.
희석프레임 = ("https://data.sec.gov/api/xbrl/frames/us-gaap/"
            "WeightedAverageNumberOfDilutedSharesOutstanding/shares/{}.json")
티커목록 = "https://www.sec.gov/files/company_tickers.json"


def _사용자표시() -> str:
    """SEC 는 연락처가 든 User-Agent 를 요구한다. 없으면 거절당한다."""
    본문 = (뿌리 / "config.yaml").read_text(encoding="utf-8", errors="ignore")
    m = re.search(r"sec_user_agent:\s*[\"']?([^\"'\n]+)", 본문)
    if not m:
        raise SystemExit("config.yaml 에 sec_user_agent 가 없습니다. SEC 는 연락처를 요구합니다.")
    return m.group(1).strip()


def 후보군() -> list[tuple[str, str]]:
    """(티커, 이름) 목록. S&P 500 + config.yaml 의 추가 후보."""
    import FinanceDataReader as fdr
    df = fdr.StockListing("S&P500")
    목록 = [(str(r.Symbol).strip().upper(), str(r.Name).strip())
            for r in df.itertuples() if str(r.Symbol).strip()]
    본문 = (뿌리 / "config.yaml").read_text(encoding="utf-8", errors="ignore")
    m = re.search(r"미국_추가후보:\s*\[([^\]]*)\]", 본문)
    if m:
        for t in m.group(1).split(","):
            t = t.strip().strip("\"'").upper()
            if t and t not in dict(목록):
                목록.append((t, t))
    # 티커에 점이 든 것(BRK.B 따위)은 자료원마다 표기가 달라 그대로 두고 뒤에서 걸러진다
    return 목록


# ---------------------------------------------------------------------------
# ① KIS
# ---------------------------------------------------------------------------
def _kis표기(t: str) -> list[str]:
    """한국투자는 주식 종류가 나뉜 종목을 **빗금**으로 씁니다 — BRK.B 가 아니라 `BRK/B`.
    2026-09-14 실물 확인: BRK/B 는 되고 BRK.B·BRKB·BRK-B 는 전부 「찾지 못했습니다」."""
    후보 = [t]
    if len(t) >= 3 and t[-1].isalpha():
        후보.append(t[:-1] + "/" + t[-1])
    return 후보


def 시총_kis(티커들: list[str]) -> dict[str, float]:
    from src import kis
    kis.설정()                                    # 키가 없으면 여기서 KisError
    값: dict[str, float] = {}
    for i, t in enumerate(티커들, 1):
        for 표기 in _kis표기(t):
            try:
                v = kis.해외현재가(표기).get("시가총액")
            except Exception:                      # noqa: BLE001
                continue
            if v:
                값[t] = float(v)
                break
        if i % 100 == 0:
            print(f"    KIS {i}/{len(티커들)}", flush=True)
    return 값


# ---------------------------------------------------------------------------
# ② SEC 주식수 × 종가
# ---------------------------------------------------------------------------
def 주식수_sec() -> dict[int, float]:
    """{CIK: 발행주식수}. 최근 네 분기 자료를 **합쳐서** 본다.

    한 분기만 보면 안 된다 — 회계연도가 달력과 어긋난 회사(엔비디아는 1월 결산)는
    표지 기준일이 그 분기 칸에 안 들어가 통째로 빠진다. 2026-09-14 첫 시험에서
    NVDA·GOOGL·META 가 상위 100 에서 사라진 것이 이 때문이었다.
    같은 회사가 여러 분기에 나오면 **기준일이 가장 최근인 것**을 쓴다."""
    import urllib.request
    머리 = {"User-Agent": _사용자표시()}
    오늘 = date.today()
    나온것: dict[int, tuple[str, float]] = {}          # CIK: (기준일, 주식수)
    받은분기 = []
    for 뒤로 in range(0, 5):
        d = 오늘 - timedelta(days=92 * 뒤로)
        분기 = f"CY{d.year}Q{(d.month - 1) // 3 + 1}I"
        try:
            r = urllib.request.urlopen(
                urllib.request.Request(프레임.format(분기), headers=머리), timeout=60)
            자료 = json.loads(r.read())
        except Exception:                          # noqa: BLE001
            continue
        행들 = 자료.get("data") or []
        if len(행들) < 500:
            continue
        받은분기.append(f"{분기}({len(행들)})")
        for 행 in 행들:
            c, v, 끝 = 행.get("cik"), 행.get("val"), str(행.get("end") or "")
            if not (c and v):
                continue
            c = int(c)
            앞 = 나온것.get(c)
            if 앞 is None or 끝 > 앞[0] or (끝 == 앞[0] and float(v) > 앞[1]):
                나온것[c] = (끝, float(v))
    if not 나온것:
        raise SystemExit("SEC 주식수 자료를 받지 못했습니다. 잠시 뒤 다시 해 보십시오.")
    print(f"    SEC {' + '.join(받은분기)} → 회사 {len(나온것)}곳의 주식수", flush=True)
    return {c: v for c, (_, v) in 나온것.items()}


def _받기(주소: str, 머리: dict) -> dict | None:
    import urllib.request
    try:
        r = urllib.request.urlopen(urllib.request.Request(주소, headers=머리), timeout=60)
        return json.loads(r.read())
    except Exception:                              # noqa: BLE001
        return None


def 희석주식수_sec() -> dict[int, float]:
    """{CIK: 희석주식수}. 위 프레임에서 빠진 회사를 메우는 용도다."""
    머리 = {"User-Agent": _사용자표시()}
    오늘 = date.today()
    나온것: dict[int, tuple[str, float]] = {}
    for 뒤로 in range(0, 5):
        d = 오늘 - timedelta(days=92 * 뒤로)
        자료 = _받기(희석프레임.format(f"CY{d.year}Q{(d.month - 1) // 3 + 1}"), 머리)
        for 행 in ((자료 or {}).get("data") or []):
            c, v, 끝 = 행.get("cik"), 행.get("val"), str(행.get("end") or "")
            if not (c and v):
                continue
            c = int(c)
            앞 = 나온것.get(c)
            if 앞 is None or 끝 > 앞[0]:
                나온것[c] = (끝, float(v))
    return {c: v for c, (_, v) in 나온것.items()}


def 티커지도() -> dict[str, int]:
    """{티커: CIK}. 점·붙임표를 뗀 형태로도 찾을 수 있게 둘 다 넣는다 (BRK.B = BRK-B = BRKB)."""
    자료 = _받기(티커목록, {"User-Agent": _사용자표시()}) or {}
    지도: dict[str, int] = {}
    for 행 in 자료.values():
        t, c = str(행.get("ticker", "")).upper(), 행.get("cik_str")
        if not (t and c):
            continue
        지도.setdefault(t, int(c))
        민짜 = re.sub(r"[^A-Z0-9]", "", t)
        지도.setdefault(민짜, int(c))
    return 지도


def 종가들(티커들: list[str], 일꾼: int = 8) -> dict[str, float]:
    import FinanceDataReader as fdr
    시작 = (date.today() - timedelta(days=14)).isoformat()

    def 하나(t: str):
        try:
            df = fdr.DataReader(t, 시작)
            if df is not None and not df.empty:
                return t, float(df["Close"].dropna().iloc[-1])
        except Exception:                          # noqa: BLE001
            pass
        return t, None

    값: dict[str, float] = {}
    with ThreadPoolExecutor(max_workers=일꾼) as 풀:
        for n, (t, v) in enumerate(풀.map(하나, 티커들), 1):
            if v:
                값[t] = v
            if n % 100 == 0:
                print(f"    종가 {n}/{len(티커들)}", flush=True)
    return 값


def 시총_sec_fdr(후보: list[tuple[str, str]]) -> tuple[dict[str, float], dict[str, int]]:
    주식수 = 주식수_sec()
    희석 = 희석주식수_sec()
    지도 = 티커지도()
    티커들 = [t for t, _ in 후보]
    종가 = 종가들(티커들)

    값: dict[str, float] = {}
    못찾음 = 0
    메운것 = 0
    for t in 티커들:
        if t not in 종가:
            continue
        cik = 지도.get(t) or 지도.get(re.sub(r"[^A-Z0-9]", "", t))
        if not cik:
            못찾음 += 1
            continue
        주 = 주식수.get(cik)
        if not 주:
            주 = 희석.get(cik)                      # 종류가 나뉜 회사는 희석주식수로 메운다
            if 주:
                메운것 += 1
        if 주:
            값[t] = 주 * 종가[t]
    if 메운것:
        print(f"    주식 종류가 나뉘어 희석주식수로 메운 회사 {메운것}곳", flush=True)
    빠진것 = [t for t in 티커들 if t not in 값]
    if 빠진것:
        print(f"    시가총액을 못 구한 후보 {len(빠진것)}곳: {' '.join(빠진것)}", flush=True)
        print("      (주식 종류가 A·B·C 로 나뉘어 주식수가 종류별로만 적히는 회사들입니다."
              " 한국투자증권 키를 넣으면 ① 경로가 이 값을 바로 줍니다.)", flush=True)
    씨아이케이 = {t: (지도.get(t) or 지도.get(re.sub(r"[^A-Z0-9]", "", t)) or 0) for t in 값}
    return 값, 씨아이케이


# ---------------------------------------------------------------------------
def 만들기(개수: int = 100) -> dict:
    후보 = 후보군()
    이름 = dict(후보)
    print(f"  후보 {len(후보)}곳에서 상위 {개수}곳을 고릅니다.", flush=True)

    출처 = "KIS"
    씨아이케이: dict[str, int] = {}
    try:
        값 = 시총_kis([t for t, _ in 후보])
        if len(값) < 개수:
            raise RuntimeError(f"KIS 로 받은 것이 {len(값)}곳뿐입니다")
        # KIS 는 주식 종류별로 시가총액을 줍니다. 「상위 100개 **기업**」이므로 SEC 의
        # 티커↔CIK 대조로 같은 회사를 묶습니다 (GOOGL·GOOG 가 둘 다 들어오지 않게).
        지도 = 티커지도()
        씨아이케이 = {t: (지도.get(t) or 지도.get(re.sub(r"[^A-Z0-9]", "", t)) or 0) for t in 값}
    except Exception as e:                         # noqa: BLE001
        print(f"  KIS 를 쓰지 못합니다({str(e)[:60]}). SEC 주식수 × 종가로 계산합니다.", flush=True)
        출처 = "SEC 주식수 × 종가"
        값, 씨아이케이 = 시총_sec_fdr(후보)

    # 알파벳처럼 한 회사가 티커 둘(GOOGL·GOOG)인 경우가 있다. 「상위 100개 **기업**」이므로
    # 같은 회사는 한 번만 센다. 남기는 쪽은 시가총액이 큰 티커다.
    대표: dict[int, tuple[str, float]] = {}
    홀로: list[tuple[str, float]] = []
    for t, v in 값.items():
        c = 씨아이케이.get(t, 0)
        if not c:
            홀로.append((t, v)); continue
        if c not in 대표 or v > 대표[c][1]:
            대표[c] = (t, v)
    합친것 = sorted(list(대표.values()) + 홀로, key=lambda kv: kv[1], reverse=True)
    묶인수 = len(값) - len(합친것)
    if 묶인수:
        print(f"    같은 회사의 다른 주식종류 {묶인수}건을 하나로 묶었습니다 (GOOGL·GOOG 따위)",
              flush=True)
    순위 = 합친것[:개수]

    종목 = [{"순위": i, "티커": t, "이름": 이름.get(t, t),
            "시가총액": round(v), "시가총액_억달러": round(v / 1e8, 1)}
           for i, (t, v) in enumerate(순위, 1)]

    # 시가총액을 못 구했지만 빼놓을 수 없는 회사 (config.yaml 의 미국_항상포함)
    본문 = (뿌리 / "config.yaml").read_text(encoding="utf-8", errors="ignore")
    m = re.search(r"미국_항상포함:\s*\[([^\]]*)\]", 본문)
    덧붙임 = []
    if m:
        이미 = {r["티커"] for r in 종목}
        for t in [x.strip().strip("\"'").upper() for x in m.group(1).split(",")]:
            if t and t not in 이미:
                덧붙임.append({"순위": None, "티커": t, "이름": 이름.get(t, t),
                             "시가총액": None, "시가총액_억달러": None,
                             "비고": "시가총액을 못 구해 순위 없이 넣었습니다(주식종류가 나뉜 회사)"})
        종목 += 덧붙임
        if 덧붙임:
            print(f"    순위 없이 덧붙인 회사 {len(덧붙임)}곳: "
                  f"{' '.join(r['티커'] for r in 덧붙임)}", flush=True)

    결과 = {
        "만든날": date.today().isoformat(),
        "출처": 출처,
        "후보수": len(후보),
        "시총못구함": sorted(t for t, _ in 후보 if t not in 값),
        "종목": 종목,
    }
    담는곳.parent.mkdir(parents=True, exist_ok=True)
    담는곳.write_text(json.dumps(결과, ensure_ascii=False, indent=2), encoding="utf-8")
    return 결과


def 보기() -> int:
    if not 담는곳.exists():
        print("아직 만든 적이 없습니다. --만들기 를 먼저 하십시오.")
        return 1
    d = json.loads(담는곳.read_text(encoding="utf-8"))
    print(f"{d['만든날']} · {d['출처']} · {len(d['종목'])}곳")
    for r in d["종목"]:
        if r.get("순위"):
            print(f"  {r['순위']:>3}. {r['티커']:<6} {r['시가총액_억달러']:>9,.1f}억달러  {r['이름']}")
        else:
            print(f"    · {r['티커']:<6} {'순위없음':>12}  {r['이름']}")
    return 0


if __name__ == "__main__":
    인자 = sys.argv[1:]
    개수 = 100
    if "--개수" in 인자:
        개수 = int(인자[인자.index("--개수") + 1])
    if "--만들기" in 인자:
        d = 만들기(개수)
        print(f"  담았습니다: {담는곳}  ({len(d['종목'])}곳 · {d['출처']})")
        for r in d["종목"][:10]:
            print(f"    {r['순위']:>3}. {r['티커']:<6} {r['시가총액_억달러']:>9,.1f}억달러  {r['이름']}")
    elif "--보기" in 인자:
        raise SystemExit(보기())
    else:
        print(__doc__)
