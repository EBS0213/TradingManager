"""
해외(미국) 기업 재무 수집기 — SEC EDGAR
---------------------------------------
DART 가 국내 공시 시스템이라면, 미국은 SEC EDGAR 다. 공식 API 이고 인증키가 필요 없다.
(예의상 회사·연락처를 User-Agent 에 적어야 한다. config.yaml 의 sec_user_agent)

DART 와 같은 함정이 하나 있고, 없는 함정이 하나 있다.

  없는 함정: 계정명이 회사마다 다른 문제.
            미국은 US-GAAP 표준 태그(Revenues, OperatingIncomeLoss …)를 쓴다.
  있는 함정: 누적 문제.
            10-Q 손익계산서는 3개월치와 누적치가 **둘 다** 들어 있어서 기간(일수)으로 골라내면 된다.
            반면 현금흐름표는 누적치만 있어서 앞 분기를 빼야 한다.
            그리고 4분기는 10-Q 가 없다 — 연간(10-K)에서 1~3분기를 빼서 만든다.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path

import requests

from .dart_fin import FinancialSeries

BASE = "https://data.sec.gov"
TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"

# 우리 지표 이름 → US-GAAP 태그 후보 (앞에서부터 시도)
CONCEPTS: dict[str, tuple[str, ...]] = {
    "revenue": ("RevenueFromContractWithCustomerExcludingAssessedTax",
                "Revenues", "RevenueFromContractWithCustomerIncludingAssessedTax",
                "SalesRevenueNet"),
    "cogs": ("CostOfRevenue", "CostOfGoodsAndServicesSold", "CostOfSales"),
    "gross_profit": ("GrossProfit",),
    "op_income": ("OperatingIncomeLoss",),
    "net_income": ("NetIncomeLoss", "ProfitLoss"),
    "rnd": ("ResearchAndDevelopmentExpense",),
    "sgna": ("SellingGeneralAndAdministrativeExpense",),
    "assets": ("Assets",),
    "current_assets": ("AssetsCurrent",),
    "liabilities": ("Liabilities",),
    "current_liabilities": ("LiabilitiesCurrent",),
    "equity": ("StockholdersEquity",
               "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"),
    "cash": ("CashAndCashEquivalentsAtCarryingValue",),
    "inventories": ("InventoryNet",),
    "receivables": ("AccountsReceivableNetCurrent",),
    "borrowings_lt": ("LongTermDebtNoncurrent", "LongTermDebt"),
    "cfo": ("NetCashProvidedByUsedInOperatingActivities",
            "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"),
    "cfi": ("NetCashProvidedByUsedInInvestingActivities",),
    "cff": ("NetCashProvidedByUsedInFinancingActivities",),
    "capex": ("PaymentsToAcquirePropertyPlantAndEquipment",),
    "dep": ("DepreciationDepletionAndAmortization", "DepreciationAndAmortization"),
}

# 시점 값(재무상태표)인 항목 — 기간 계산을 하면 안 된다
STOCK_KEYS = {"assets", "current_assets", "liabilities", "current_liabilities",
              "equity", "cash", "inventories", "receivables", "borrowings_lt"}
# 누적으로만 공시되는 항목 (현금흐름표) — 앞 분기를 빼야 한다
CUMULATIVE_ONLY = {"cfo", "cfi", "cff", "capex", "dep"}


class EdgarError(RuntimeError):
    pass


def _days(a: str, b: str) -> int:
    return (datetime.fromisoformat(b) - datetime.fromisoformat(a)).days


def _quarter_of(end: str) -> tuple[int, int]:
    d = datetime.fromisoformat(end)
    return d.year, (d.month - 1) // 3 + 1


class EdgarClient:
    def __init__(self, user_agent: str, cache_dir: str | Path = "캐시", pause: float = 0.2):
        if not user_agent or "@" not in user_agent:
            raise ValueError('config.yaml의 sec_user_agent에 본인 이름과 이메일을 설정하세요.')
        self.headers = {"User-Agent": user_agent, "Accept-Encoding": "gzip, deflate"}
        self.cache = Path(cache_dir)
        self.cache.mkdir(parents=True, exist_ok=True)
        self.pause = pause

    def _get(self, url: str, cache_name: str | None = None, max_age_days: float = 1.0):
        if cache_name:
            f = self.cache / f"{cache_name}.json"
            if f.exists() and (time.time() - f.stat().st_mtime) < max_age_days * 86400:
                return json.loads(f.read_text(encoding="utf-8"))
        r = requests.get(url, headers=self.headers, timeout=40)
        time.sleep(self.pause)
        if r.status_code == 404:
            return None
        r.raise_for_status()
        data = r.json()
        if cache_name:
            (self.cache / f"{cache_name}.json").write_text(
                json.dumps(data, ensure_ascii=False), encoding="utf-8")
        return data

    def cik(self, ticker: str) -> str:
        data = self._get(TICKERS_URL, "sec_tickers", max_age_days=30)
        if not data:
            raise EdgarError("SEC 티커 목록을 받지 못했습니다.")
        t = ticker.upper().strip()
        for row in data.values():
            if str(row.get("ticker", "")).upper() == t:
                return str(row["cik_str"]).zfill(10)
        raise EdgarError(f"티커 {ticker} 를 SEC 목록에서 찾지 못했습니다.")

    def profile(self, cik: str) -> dict:
        d = self._get(f"{BASE}/submissions/CIK{cik}.json", f"sec_sub_{cik}") or {}
        recent = (d.get("filings") or {}).get("recent") or {}
        filings = []
        for i in range(min(40, len(recent.get("form", [])))):
            filings.append({
                "form": recent["form"][i],
                "filed": recent["filingDate"][i],
                "period": (recent.get("reportDate") or [None] * 99)[i],
                "url": (f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/"
                        f"{recent['accessionNumber'][i].replace('-', '')}/"
                        f"{recent['primaryDocument'][i]}"),
                "desc": (recent.get("primaryDocDescription") or [""] * 99)[i],
                # 8-K 의 항목번호. 2.02 가 「실적 발표」다 — 컨퍼런스감시.py 가 이걸로 고른다.
                "items": (recent.get("items") or [""] * 99)[i],
                "accn": recent["accessionNumber"][i],
            })
        return {
            "name": d.get("name"), "tickers": d.get("tickers"),
            "exchanges": d.get("exchanges"), "sic": d.get("sic"),
            "sic_desc": d.get("sicDescription"), "fy_end": d.get("fiscalYearEnd"),
            "shares": (d.get("filings") and None),
            "filings": filings,
        }

    def concept(self, cik: str, tag: str) -> list[dict] | None:
        d = self._get(f"{BASE}/api/xbrl/companyconcept/CIK{cik}/us-gaap/{tag}.json",
                      f"sec_{cik}_{tag}")
        if not d:
            return None
        units = d.get("units") or {}
        for key in ("USD", "USD/shares"):
            if key in units:
                return units[key]
        return next(iter(units.values()), None)


def _quarterly_from_entries(entries: list[dict], kind: str) -> dict[tuple[int, int], float]:
    """(연도, 분기) → 그 분기만의 값"""
    out: dict[tuple[int, int], float] = {}

    if kind == "stock":
        for e in entries:
            if "start" in e and e.get("start"):      # 시점 값은 start 가 없다
                continue
            end = e.get("end")
            if not end:
                continue
            out[_quarter_of(end)] = float(e["val"])   # 나중 공시가 앞선 것을 덮어씀
        return out

    # 기간 값
    cum: dict[tuple[int, int], float] = {}            # 연초부터의 누적
    for e in entries:
        s, end = e.get("start"), e.get("end")
        if not s or not end:
            continue
        n = _days(s, end)
        y, q = _quarter_of(end)
        if 80 <= n <= 100:                            # 딱 한 분기짜리
            out.setdefault((y, q), float(e["val"]))
        elif 350 <= n <= 380:                         # 연간
            cum[(y, 4)] = float(e["val"])
        elif 170 <= n <= 195:                         # 반기 누적
            cum[(y, 2)] = float(e["val"])
        elif 260 <= n <= 285:                         # 3분기 누적
            cum[(y, 3)] = float(e["val"])
        elif n < 80:                                  # 1분기 누적 = 1분기
            cum[(y, 1)] = float(e["val"])

    # 누적밖에 없는 분기는 차감해서 만든다
    years = {y for y, _ in list(out) + list(cum)}
    for y in years:
        for q in (1, 2, 3, 4):
            if (y, q) in out:
                continue
            c = cum.get((y, q))
            if c is None:
                continue
            if q == 1:
                out[(y, q)] = c
                continue
            prev = cum.get((y, q - 1))
            if prev is None:                          # 앞 분기 누적이 없으면 개별값을 더해서 만든다
                parts = [out.get((y, k)) for k in range(1, q)]
                if any(p is None for p in parts):
                    continue
                prev = sum(parts)                     # type: ignore[arg-type]
            out[(y, q)] = c - prev
    return out


def build_series_us(client: EdgarClient, ticker: str, n_quarters: int = 12,
                    today: date | None = None) -> tuple[FinancialSeries, dict]:
    cik = client.cik(ticker)
    prof = client.profile(cik)

    fs = FinancialSeries(stock_code=ticker.upper(), corp_code=cik, fs_div="CFS")
    fs.unit_div, fs.unit_label, fs.currency = 1e6, "백만달러", "USD"

    today = today or date.today()
    y, q = today.year, (today.month - 1) // 3 + 1
    quarters: list[tuple[int, int]] = []
    for _ in range(n_quarters):
        quarters.append((y, q))
        q -= 1
        if q == 0:
            y, q = y - 1, 4
    quarters.reverse()
    fs.quarters = [f"{yy}Q{qq}" for yy, qq in quarters]

    for key, tags in CONCEPTS.items():
        entries = None
        for tag in tags:
            entries = client.concept(cik, tag)
            if entries:
                break
        if not entries:
            fs.data[key] = {lbl: None for lbl in fs.quarters}
            continue
        kind = "stock" if key in STOCK_KEYS else "flow"
        qmap = _quarterly_from_entries(entries, kind)
        fs.data[key] = {f"{yy}Q{qq}": qmap.get((yy, qq)) for yy, qq in quarters}
        if all(v is None for v in fs.data[key].values()):
            fs.missing.append(key)

    return fs, prof
