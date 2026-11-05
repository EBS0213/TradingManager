"""
주가 · 시가총액 · 컨센서스 수집기
---------------------------------
- 일별 시세·시가총액·PER/PBR 은 **한국투자증권 오픈API**(`src/kis.py`) 를 먼저 쓴다.
  공식 API 라서 실패하면 오류코드를 돌려준다 — launchd 무인 실행에서 가장 위험한
  '조용한 실패' 가 없다. 미국 종목도 시가총액·PER/PBR 이 채워진다.
- KIS 키가 없거나 KIS 가 실패하면 **예전 경로로 그대로 내려간다**
  (FinanceDataReader + pykrx). 즉 키를 넣지 않으면 동작이 전과 똑같다.
- 증권가 평균 목표주가(컨센서스)는 KIS API 에 없다. 네이버 금융 스크래핑을 그대로 쓴다.

KIS 키 넣는 법:  ./키넣기.command   (또는 .env 에 KIS_APP_KEY / KIS_APP_SECRET)
필드 대조:       "$PY3" -m src.kis 점검 005930
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from typing import Any

import requests

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"}

억 = 1e8          # KIS 국내 시가총액(hts_avls)은 '억원' 단위로 온다. 저장은 원 단위로 맞춘다.


@dataclass
class PriceData:
    stock_code: str
    name: str | None = None
    dates: list[str] = field(default_factory=list)
    close: list[float] = field(default_factory=list)
    volume: list[float] = field(default_factory=list)
    last_close: float | None = None
    last_date: str | None = None
    high_52w: float | None = None
    low_52w: float | None = None
    ma: dict[str, float | None] = field(default_factory=dict)     # 50/120/200일선
    market_cap: float | None = None
    per: float | None = None
    pbr: float | None = None
    eps: float | None = None
    bps: float | None = None
    consensus: dict[str, Any] = field(default_factory=dict)
    출처: str | None = None                                        # "KIS" / "FinanceDataReader"
    notes: list[str] = field(default_factory=list)


def _moving_average(vals: list[float], window: int) -> float | None:
    if len(vals) < window:
        return None
    return sum(vals[-window:]) / window


def _국내종목인가(code: str) -> bool:
    code = code.strip()
    return len(code) == 6 and code.isdigit()


def _파생값(out: PriceData) -> None:
    """52주 고저·이동평균을 종가 배열에서 계산한다.

    KIS 현재가 응답에도 52주 고저가 있지만 그쪽은 장중 고저 기준이다. 데이터팩은
    이 값을 「종가 기준」이라고 적어 두었으므로, 뜻이 바뀌지 않게 여기서 계산한다."""
    if not out.close:
        return
    out.last_close, out.last_date = out.close[-1], out.dates[-1]
    cut = (date.today() - timedelta(days=365)).isoformat()
    w = [c for d, c in zip(out.dates, out.close) if d >= cut]
    if w:
        out.high_52w, out.low_52w = max(w), min(w)
    for win in (50, 120, 200):
        out.ma[f"{win}일선"] = _moving_average(out.close, win)


def _kis로_받기(out: PriceData, code: str, years: int) -> bool:
    """KIS 로 채웠으면 True. 실패하면 out 을 **전혀 건드리지 않고** False 를 돌려준다.

    키가 없으면 조용히 False (예전 경로로 내려간다). 키가 있는데 실패했으면
    notes 에 남긴다 — 그건 알아야 하는 고장이다."""
    try:
        from src import kis
    except Exception as e:                                    # noqa: BLE001
        out.notes.append(f"KIS 모듈을 불러오지 못했습니다({e}). 예전 경로로 갑니다.")
        return False

    try:
        kis.설정()
    except kis.KisError:
        return False                                          # 키 없음 — 조용히 예전 경로로

    try:
        받은 = kis.받기(code, 연수=years)
    except Exception as e:                                    # noqa: BLE001
        out.notes.append(f"KIS 시세 실패({e}). FinanceDataReader 로 받습니다.")
        return False

    if not 받은.종가:
        사유 = 받은.메모[0] if 받은.메모 else "일봉이 비었습니다"
        out.notes.append(f"KIS 일봉 없음({사유}). FinanceDataReader 로 받습니다.")
        return False

    out.dates, out.close, out.volume = 받은.날짜, 받은.종가, 받은.거래량
    _파생값(out)

    국내 = not 받은.해외
    if 받은.시가총액 is not None:
        # 국내는 억원, 해외는 상장통화(달러) 그대로. datapack 은 둘 다 기본단위를 기대한다.
        out.market_cap = 받은.시가총액 * 억 if 국내 else 받은.시가총액
    out.per, out.pbr, out.eps, out.bps = 받은.per, 받은.pbr, 받은.eps, 받은.bps
    out.출처 = "KIS"
    for 메 in 받은.메모:
        out.notes.append(f"KIS: {메}")
    return True


def _fdr로_받기(out: PriceData, code: str, years: int) -> None:
    """예전 경로 — FinanceDataReader. KIS 가 안 될 때만 온다."""
    start = (date.today() - timedelta(days=int(365.25 * years))).isoformat()
    try:
        import FinanceDataReader as fdr
        df = fdr.DataReader(code, start)
        if df is None or df.empty:
            raise RuntimeError("빈 데이터")
        df = df.dropna(subset=["Close"])
        out.dates = [d.strftime("%Y-%m-%d") for d in df.index]
        out.close = [float(v) for v in df["Close"]]
        out.volume = [float(v) for v in df.get("Volume", [0] * len(df))]
        _파생값(out)
        out.출처 = "FinanceDataReader"
    except Exception as e:                                    # noqa: BLE001
        out.notes.append(f"시세 수집 실패: {e}. `pip install finance-datareader` 확인 필요.")


def _pykrx로_보태기(out: PriceData, code: str) -> None:
    """시가총액·PER/PBR 이 아직 비었을 때만 pykrx 로 메운다 (국내 전용).

    2026-09-13 확인 — pykrx 는 KRX 가 로그인(KRX_ID/KRX_PW)을 요구하도록 바뀌면서
    **조용히 빈 값을 돌려준다**. 예외도 안 난다. 그래서 끝에 직접 확인해 메모를 남긴다.
    제대로 채우려면 KIS 키를 넣어야 한다 (./키넣기.command)."""
    try:
        from pykrx import stock as krx
        today = date.today()
        for back in range(0, 10):                             # 휴장일 대비 며칠 뒤로
            d = (today - timedelta(days=back)).strftime("%Y%m%d")
            cap = krx.get_market_cap_by_date(d, d, code)
            if cap is not None and not cap.empty:
                out.market_cap = out.market_cap or float(cap["시가총액"].iloc[-1])
                fund = krx.get_market_fundamental_by_date(d, d, code)
                if fund is not None and not fund.empty:
                    row = fund.iloc[-1]
                    out.per = out.per or (float(row.get("PER") or 0) or None)
                    out.pbr = out.pbr or (float(row.get("PBR") or 0) or None)
                    out.eps = out.eps or (float(row.get("EPS") or 0) or None)
                    out.bps = out.bps or (float(row.get("BPS") or 0) or None)
                break
    except Exception as e:                                    # noqa: BLE001
        out.notes.append(f"시가총액·밸류에이션 수집 건너뜀({e}). `pip install pykrx` 하면 채워집니다.")
    if out.market_cap is None and out.per is None:
        out.notes.append("시가총액·PER/PBR 을 받지 못했습니다. pykrx 는 KRX 로그인을 요구하도록 "
                         "바뀌어 조용히 빈 값을 돌려줍니다. ./키넣기.command 로 한국투자증권 "
                         "키를 넣으면 KIS 가 채웁니다.")


def fetch_price(stock_code: str, years: int = 3) -> PriceData:
    out = PriceData(stock_code=stock_code)
    국내 = _국내종목인가(stock_code)

    if not _kis로_받기(out, stock_code, years):
        _fdr로_받기(out, stock_code, years)

    if 국내 and (out.market_cap is None or out.per is None or out.pbr is None):
        _pykrx로_보태기(out, stock_code)
    elif not 국내 and out.market_cap is None:
        out.notes.append("해외 종목의 시가총액·PER/PBR 은 KIS 가 있어야 채워집니다 "
                         "(pykrx 는 국내 전용). ./키넣기.command 로 키를 넣으십시오.")

    out.consensus = fetch_consensus(stock_code, out)
    return out


def fetch_consensus(stock_code: str, price: PriceData | None = None) -> dict[str, Any]:
    """네이버 금융 종목 페이지에서 공개된 컨센서스(평균 목표주가·투자의견)를 읽는다.
    페이지 구조가 바뀌면 조용히 빈 값을 돌려준다 — 없어도 보고서는 쓸 수 있어야 한다."""
    result: dict[str, Any] = {"목표주가": None, "투자의견": None, "출처": "네이버 금융"}
    try:
        from bs4 import BeautifulSoup
        url = f"https://finance.naver.com/item/main.naver?code={stock_code}"
        html = requests.get(url, headers=UA, timeout=15).content.decode("euc-kr", "replace")
        soup = BeautifulSoup(html, "html.parser")

        if price is not None and price.name is None:
            t = soup.select_one(".wrap_company h2 a")
            if t:
                price.name = t.get_text(strip=True)

        node = soup.find(string=re.compile("목표주가"))
        if node:
            block = node.find_parent(["tr", "table", "div"])
            if block:
                txt = block.get_text(" ", strip=True)
                nums = re.findall(r"[\d,]{4,}", txt)
                if nums:
                    result["목표주가"] = float(nums[0].replace(",", ""))
                m = re.search(r"(매수|중립|매도|적극매수|BUY|HOLD|SELL)", txt, re.I)
                if m:
                    result["투자의견"] = m.group(1)
        if result["목표주가"] and price and price.last_close:
            result["현재가대비(%)"] = round(
                (result["목표주가"] / price.last_close - 1) * 100, 1)
    except Exception as e:                                    # noqa: BLE001
        result["오류"] = str(e)
    return result


def trend_template(price: PriceData) -> dict[str, Any]:
    """미너비니 트렌드 템플릿 중 가격만으로 판정 가능한 조건들.
    (RS 순위처럼 전체 시장 비교가 필요한 항목은 여기서 판정하지 않는다)"""
    c, ma = price.last_close, price.ma
    ma50, ma120, ma200 = ma.get("50일선"), ma.get("120일선"), ma.get("200일선")
    checks: dict[str, bool | None] = {
        "주가 > 200일선": None if (c is None or ma200 is None) else c > ma200,
        "주가 > 50일선": None if (c is None or ma50 is None) else c > ma50,
        "50일선 > 120일선": None if (ma50 is None or ma120 is None) else ma50 > ma120,
        "120일선 > 200일선": None if (ma120 is None or ma200 is None) else ma120 > ma200,
        "52주 저점 대비 +30% 이상": (None if (c is None or price.low_52w in (None, 0))
                              else c >= price.low_52w * 1.3),
        "52주 고점 대비 -25% 이내": (None if (c is None or price.high_52w in (None, 0))
                              else c >= price.high_52w * 0.75),
    }
    # 200일선 상승 추세 (최근 한 달 전보다 높은가)
    if len(price.close) > 220:
        prev200 = sum(price.close[-221:-21]) / 200
        checks["200일선 상승 추세"] = (ma200 is not None and ma200 > prev200)
    else:
        checks["200일선 상승 추세"] = None

    passed = sum(1 for v in checks.values() if v is True)
    failed = sum(1 for v in checks.values() if v is False)
    unknown = sum(1 for v in checks.values() if v is None)
    return {"조건": checks, "충족": passed, "미충족": failed, "미확인": unknown,
            "판정": "통과" if failed == 0 and unknown == 0 else "불통과"}


def volatility_stats(price: PriceData, days: int = 60) -> dict[str, Any]:
    """손절폭을 정하기 위한 실측 변동성. 인수인계 메모의 '변동성 실측' 절과 같은 계산."""
    if len(price.close) < days + 1:
        return {}
    closes = price.close[-days:]
    rets = [abs(closes[i] / closes[i - 1] - 1) * 100 for i in range(1, len(closes))]
    rets_sorted = sorted(rets)
    return {
        "일간변동 평균(%)": round(sum(rets) / len(rets), 2),
        "일간변동 중앙값(%)": round(rets_sorted[len(rets_sorted) // 2], 2),
        "일간변동 최대(%)": round(max(rets), 2),
        "권장 손절폭(%)": round(min(20.0, max(8.0, (sum(rets) / len(rets)) * 2.5)), 1),
        "설명": "권장 손절폭 = 최근 일간 변동 평균 × 2.5 (8~20% 사이로 제한). "
                "정상 변동에 손절이 걸리지 않게 하기 위한 하한선이다.",
    }
