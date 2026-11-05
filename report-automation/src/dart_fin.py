"""
DART(전자공시) 재무제표 수집기
--------------------------------
하는 일: 종목코드 하나를 받아서 최근 12분기 재무 시계열을 만든다.

인수인계 메모에 적힌 '두 함정'을 여기서 처리한다.
  함정 1) 회사마다 계정 이름이 다르다 (매출액 / 수익(매출액) / 영업수익)
          -> IFRS 표준 account_id 를 1순위로 쓰고, 이름은 2순위 보조로만 쓴다.
  함정 2) 분기보고서의 금액은 '누적'이다 (3분기보고서 매출 = 1~9월 합계)
          -> 손익/현금흐름 같은 '기간 값'은 앞 분기를 빼서 그 분기만의 값을 만든다.
             자산/부채/자본 같은 '시점 값'은 그대로 둔다.
"""

from __future__ import annotations

import io
import json
import re
import time
import zipfile
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

import requests

BASE = "https://opendart.fss.or.kr/api"

# 보고서 코드: 1분기 / 반기 / 3분기 / 사업보고서
REPRT_CODE = {1: "11013", 2: "11012", 3: "11014", 4: "11011"}

DART_STATUS_MSG = {
    "000": "정상",
    "010": "등록되지 않은 키입니다",
    "011": "사용할 수 없는 키입니다 (오픈API에 등록되었으나 일시적으로 사용 중지된 키)",
    "012": "접근할 수 없는 IP입니다",
    "013": "조회된 데이터가 없습니다",
    "014": "파일이 존재하지 않습니다",
    "020": "요청 제한을 초과했습니다 (하루 20,000건)",
    "021": "조회 가능한 회사 개수가 초과했습니다",
    "100": "필드의 부적절한 값입니다",
    "101": "부적절한 접근입니다",
    "800": "시스템 점검 중입니다",
    "900": "정의되지 않은 오류입니다",
    "901": "사용자 계정의 개인정보 보유기간이 만료되었습니다",
}


class DartError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# 계정 매핑표
#   ids  : IFRS 표준 계정 ID (1순위). 회사가 달라도 잘 안 변한다.
#   names: 계정 이름 정규식 (2순위). ID 가 비표준(dart_ 접두어 없는 사내코드)일 때 대비.
#   kind : flow = 기간 값(누적 차감 필요) / stock = 시점 값(그대로)
# ---------------------------------------------------------------------------
@dataclass
class Account:
    key: str
    label: str
    sj: tuple[str, ...]          # 재무제표 구분 BS(재무상태표) IS/CIS(손익) CF(현금흐름)
    kind: str                    # "flow" | "stock"
    ids: tuple[str, ...] = ()
    names: tuple[str, ...] = ()


ACCOUNTS: list[Account] = [
    # --- 손익계산서 (기간 값) ---
    Account("revenue", "매출액", ("IS", "CIS"), "flow",
            ids=("ifrs-full_Revenue", "ifrs_Revenue",
                 "ifrs-full_RevenueFromContractsWithCustomers"),
            names=(r"^매출액$", r"^수익\(매출액\)$", r"^영업수익$", r"^매출$")),
    Account("cogs", "매출원가", ("IS", "CIS"), "flow",
            ids=("ifrs-full_CostOfSales",),
            names=(r"^매출원가$", r"^영업비용$")),
    Account("gross_profit", "매출총이익", ("IS", "CIS"), "flow",
            ids=("ifrs-full_GrossProfit",),
            names=(r"^매출총이익",)),
    Account("sgna", "판매비와관리비", ("IS", "CIS"), "flow",
            ids=("dart_TotalSellingGeneralAdministrativeExpenses",
                 "ifrs-full_SellingGeneralAndAdministrativeExpense"),
            names=(r"^판매비와?관리비",)),
    Account("op_income", "영업이익", ("IS", "CIS"), "flow",
            ids=("dart_OperatingIncomeLoss",
                 "ifrs-full_ProfitLossFromOperatingActivities"),
            names=(r"^영업이익", r"^영업손실")),
    Account("net_income", "당기순이익", ("IS", "CIS"), "flow",
            ids=("ifrs-full_ProfitLoss",),
            names=(r"^당기순이익", r"^당기순손실", r"^분기순이익", r"^반기순이익")),
    Account("net_income_ctrl", "지배주주순이익", ("IS", "CIS"), "flow",
            ids=("ifrs-full_ProfitLossAttributableToOwnersOfParent",),
            names=(r"지배기업.*소유주",)),
    # --- 재무상태표 (시점 값) ---
    Account("assets", "자산총계", ("BS",), "stock",
            ids=("ifrs-full_Assets",), names=(r"^자산총계$",)),
    Account("current_assets", "유동자산", ("BS",), "stock",
            ids=("ifrs-full_CurrentAssets",), names=(r"^유동자산$",)),
    Account("liabilities", "부채총계", ("BS",), "stock",
            ids=("ifrs-full_Liabilities",), names=(r"^부채총계$",)),
    Account("current_liabilities", "유동부채", ("BS",), "stock",
            ids=("ifrs-full_CurrentLiabilities",), names=(r"^유동부채$",)),
    Account("equity", "자본총계", ("BS",), "stock",
            ids=("ifrs-full_Equity",), names=(r"^자본총계$",)),
    Account("equity_ctrl", "지배주주지분", ("BS",), "stock",
            ids=("ifrs-full_EquityAttributableToOwnersOfParent",),
            names=(r"지배기업.*소유주.*지분",)),
    Account("cash", "현금및현금성자산", ("BS",), "stock",
            ids=("ifrs-full_CashAndCashEquivalents",),
            names=(r"^현금및현금성자산",)),
    Account("inventories", "재고자산", ("BS",), "stock",
            ids=("ifrs-full_Inventories",), names=(r"^재고자산$",)),
    Account("receivables", "매출채권", ("BS",), "stock",
            ids=("ifrs-full_TradeAndOtherCurrentReceivables",
                 "dart_ShortTermTradeReceivable"),
            names=(r"^매출채권", r"매출채권.*기타채권")),
    Account("contract_liab", "계약부채", ("BS",), "stock",
            ids=("ifrs-full_ContractLiabilities",
                 "ifrs-full_CurrentContractLiabilities"),
            names=(r"^계약부채",)),
    Account("borrowings_st", "단기차입금", ("BS",), "stock",
            ids=("ifrs-full_ShorttermBorrowings", "dart_ShortTermBorrowings"),
            names=(r"^단기차입금",)),
    Account("borrowings_lt", "장기차입금", ("BS",), "stock",
            ids=("ifrs-full_LongtermBorrowings", "dart_LongTermBorrowings"),
            names=(r"^장기차입금",)),
    # --- 현금흐름표 (기간 값) ---
    Account("cfo", "영업활동현금흐름", ("CF",), "flow",
            ids=("ifrs-full_CashFlowsFromUsedInOperatingActivities",),
            names=(r"영업활동.*현금흐름",)),
    Account("cfi", "투자활동현금흐름", ("CF",), "flow",
            ids=("ifrs-full_CashFlowsFromUsedInInvestingActivities",),
            names=(r"투자활동.*현금흐름",)),
    Account("cff", "재무활동현금흐름", ("CF",), "flow",
            ids=("ifrs-full_CashFlowsFromUsedInFinancingActivities",),
            names=(r"재무활동.*현금흐름",)),
    Account("dep", "감가상각비", ("CF",), "flow",
            ids=("ifrs-full_DepreciationExpense",
                 "ifrs-full_DepreciationAndAmortisationExpense"),
            names=(r"^감가상각비", r"감가상각비와?\s*무형자산상각비")),
    Account("capex", "유형자산의취득", ("CF",), "flow",
            ids=("ifrs-full_PurchaseOfPropertyPlantAndEquipmentClassifiedAsInvestingActivities",),
            names=(r"유형자산의?\s*취득",)),
]

ACCOUNT_BY_KEY = {a.key: a for a in ACCOUNTS}


# ---------------------------------------------------------------------------
# 숫자 파싱
# ---------------------------------------------------------------------------
def to_number(raw: Any) -> float | None:
    """DART 금액 문자열을 숫자로. '(20,000)' 은 음수, '-' 나 빈칸은 None."""
    if raw is None:
        return None
    s = str(raw).strip()
    if s in ("", "-", "－", "N/A"):
        return None
    neg = s.startswith("(") and s.endswith(")")
    s = s.strip("()").replace(",", "").replace(" ", "")
    if s.startswith("△") or s.startswith("▲"):     # 일부 회사가 쓰는 음수 표기
        neg, s = True, s[1:]
    try:
        v = float(s)
    except ValueError:
        return None
    return -v if neg else v


def quarters_back(n: int, today: date | None = None) -> list[tuple[int, int]]:
    """오늘 기준으로 과거 n개 분기를 (연도, 분기) 리스트로. 오래된 것부터."""
    today = today or date.today()
    y, q = today.year, (today.month - 1) // 3 + 1
    out = []
    for _ in range(n):
        out.append((y, q))
        q -= 1
        if q == 0:
            y, q = y - 1, 4
    return list(reversed(out))


# ---------------------------------------------------------------------------
# API 클라이언트
# ---------------------------------------------------------------------------
class DartClient:
    def __init__(self, api_key: str, cache_dir: str | Path = "캐시", pause: float = 0.35):
        if not api_key or api_key.startswith("여기에"):
            raise DartError(
                "DART 인증키가 비어 있습니다. config.yaml 의 dart_api_key 를 채워주세요.\n"
                "발급: https://opendart.fss.or.kr → 인증키 신청 (무료, 하루 20,000건)"
            )
        self.key = api_key
        self.cache = Path(cache_dir)
        self.cache.mkdir(parents=True, exist_ok=True)
        self.pause = pause
        self._corp_map: dict[str, str] | None = None

    # -- 저수준 ------------------------------------------------------------
    def _get(self, path: str, **params) -> dict:
        params["crtfc_key"] = self.key
        r = requests.get(f"{BASE}/{path}", params=params, timeout=30)
        r.raise_for_status()
        time.sleep(self.pause)
        data = r.json()
        status = data.get("status", "000")
        if status not in ("000", "013"):
            raise DartError(f"DART 오류 {status}: {DART_STATUS_MSG.get(status, data.get('message'))}")
        return data

    def _cached(self, name: str, fetch):
        f = self.cache / f"{name}.json"
        if f.exists():
            return json.loads(f.read_text(encoding="utf-8"))
        data = fetch()
        f.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        return data

    # -- 고유번호 ----------------------------------------------------------
    def corp_code(self, stock_code: str) -> str:
        """종목코드(6자리) -> DART 고유번호(8자리)"""
        stock_code = str(stock_code).zfill(6)
        if self._corp_map is None:
            self._corp_map = self._load_corp_map()
        if stock_code not in self._corp_map:
            raise DartError(f"종목코드 {stock_code} 를 DART 고유번호 목록에서 찾지 못했습니다.")
        return self._corp_map[stock_code]

    def _load_corp_map(self) -> dict[str, str]:
        f = self.cache / "corp_map.json"
        # 30일 지나면 새로 받는다 (신규 상장 반영)
        if f.exists() and (time.time() - f.stat().st_mtime) < 30 * 86400:
            return json.loads(f.read_text(encoding="utf-8"))
        r = requests.get(f"{BASE}/corpCode.xml", params={"crtfc_key": self.key}, timeout=60)
        r.raise_for_status()
        if r.content[:2] != b"PK":       # zip 이 아니면 에러 XML 이다
            raise DartError(f"고유번호 파일을 받지 못했습니다: {r.text[:200]}")
        with zipfile.ZipFile(io.BytesIO(r.content)) as z:
            xml = z.read(z.namelist()[0]).decode("utf-8")
        # 반드시 <list> 레코드 단위로 끊어서 짝을 맞춘다.
        # 상장하지 않은 회사는 <stock_code> 가 비어 있는데, 레코드 경계를 무시하고
        # 정규식을 돌리면 그 회사의 고유번호가 '다음 회사의 종목코드'와 잘못 짝지어진다.
        mapping = {}
        for rec in re.findall(r"<list>(.*?)</list>", xml, re.S):
            c = re.search(r"<corp_code>\s*(\d+)\s*</corp_code>", rec)
            s = re.search(r"<stock_code>\s*(\d{6})\s*</stock_code>", rec)
            if c and s:
                mapping[s.group(1)] = c.group(1)
        f.write_text(json.dumps(mapping, ensure_ascii=False), encoding="utf-8")
        return mapping

    # -- 재무제표 ----------------------------------------------------------
    def fnltt_all(self, corp_code: str, year: int, quarter: int, fs_div: str) -> list[dict]:
        """단일회사 전체 재무제표 (한 보고서치). fs_div: CFS=연결 / OFS=별도"""
        name = f"fin_{corp_code}_{year}_{quarter}_{fs_div}"
        data = self._cached(name, lambda: self._get(
            "fnlttSinglAcntAll.json",
            corp_code=corp_code, bsns_year=str(year),
            reprt_code=REPRT_CODE[quarter], fs_div=fs_div,
        ))
        return data.get("list", []) or []

    def shares(self, corp_code: str, year: int, quarter: int) -> dict:
        """주식의 총수 현황 (발행주식수, 자기주식)"""
        name = f"shares_{corp_code}_{year}_{quarter}"
        data = self._cached(name, lambda: self._get(
            "stockTotqySttus.json",
            corp_code=corp_code, bsns_year=str(year), reprt_code=REPRT_CODE[quarter],
        ))
        rows = data.get("list", []) or []
        total = treasury = None
        for row in rows:
            if "보통주" in (row.get("se") or "") or (row.get("se") or "").strip() == "합계":
                t = to_number(row.get("istc_totqy"))            # 발행한 주식의 총수
                d = to_number(row.get("tesstk_co"))             # 자기주식수
                if t and (total is None or t > total):
                    total, treasury = t, d
        return {"발행주식수": total, "자기주식수": treasury,
                "유통주식수": (total - treasury) if (total and treasury) else total}

    def disclosures(self, corp_code: str, bgn: str, end: str, page_count: int = 100) -> list[dict]:
        """공시 목록"""
        data = self._get("list.json", corp_code=corp_code, bgn_de=bgn, end_de=end,
                         page_count=page_count, sort="date", sort_mth="desc")
        rows = data.get("list", []) or []
        for r in rows:
            r["url"] = f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={r.get('rcept_no')}"
        return rows


# ---------------------------------------------------------------------------
# 계정 골라내기
# ---------------------------------------------------------------------------
def _pick(rows: list[dict], acc: Account) -> dict | None:
    cand = [r for r in rows if (r.get("sj_div") or "").upper() in acc.sj]
    # 1순위: 표준 account_id
    for wanted in acc.ids:
        for r in cand:
            aid = (r.get("account_id") or "").strip()
            if aid == wanted:
                return r
    # 2순위: 계정 이름 정규식
    for pat in acc.names:
        rx = re.compile(pat)
        for r in cand:
            nm = re.sub(r"\s+", "", (r.get("account_nm") or ""))
            if rx.search(nm):
                return r
    return None


def _cumulative_value(row: dict, quarter: int) -> float | None:
    """그 보고서에 적힌 '누적' 금액을 꺼낸다.
    분기보고서는 thstrm_add_amount 가 누적, thstrm_amount 는 해당 3개월인 경우가 많다.
    다만 회사에 따라 add 가 비어 있으므로 그때는 amount 를 누적으로 본다.
    4분기(사업보고서)는 언제나 연간 누적이다."""
    add = to_number(row.get("thstrm_add_amount"))
    amt = to_number(row.get("thstrm_amount"))
    if quarter == 4:
        return amt if amt is not None else add
    return add if add is not None else amt


# ---------------------------------------------------------------------------
# 12분기 시계열 만들기
# ---------------------------------------------------------------------------
@dataclass
class FinancialSeries:
    stock_code: str
    corp_code: str
    fs_div: str                      # 실제로 쓴 것 (CFS 연결 / OFS 별도)
    quarters: list[str] = field(default_factory=list)      # ["2023Q3", ...]
    data: dict[str, dict[str, float | None]] = field(default_factory=dict)
    unit: str = "원"
    missing: list[str] = field(default_factory=list)
    # 표시 단위 — 국내는 억원(1e8), 미국은 백만달러(1e6)
    unit_div: float = 1e8
    unit_label: str = "억원"
    currency: str = "KRW"

    def series(self, key: str) -> list[float | None]:
        d = self.data.get(key, {})
        return [d.get(q) for q in self.quarters]


def build_series(client: DartClient, stock_code: str, n_quarters: int = 12,
                 fs_div: str = "CFS", today: date | None = None) -> FinancialSeries:
    corp = client.corp_code(stock_code)

    # 필요한 분기 + 누적 차감을 위해 각 연도의 앞 분기까지 확보
    want = quarters_back(n_quarters, today)
    need: set[tuple[int, int]] = set()
    for y, q in want:
        for qq in range(1, q + 1):       # 같은 해 1분기부터 q분기까지 전부 필요
            need.add((y, qq))

    raw: dict[tuple[int, int], list[dict]] = {}
    used_div = fs_div
    for y, q in sorted(need):
        rows = client.fnltt_all(corp, y, q, fs_div)
        if not rows and fs_div == "CFS":
            rows = client.fnltt_all(corp, y, q, "OFS")   # 연결 없으면 별도
            if rows:
                used_div = "OFS"
        raw[(y, q)] = rows

    out = FinancialSeries(stock_code=stock_code, corp_code=corp, fs_div=used_div)
    out.quarters = [f"{y}Q{q}" for y, q in want]

    for acc in ACCOUNTS:
        vals: dict[str, float | None] = {}
        # 각 보고서의 누적값 (또는 시점값) 먼저 확보
        cum: dict[tuple[int, int], float | None] = {}
        for (y, q), rows in raw.items():
            row = _pick(rows, acc) if rows else None
            if row is None:
                cum[(y, q)] = None
                continue
            cum[(y, q)] = (_cumulative_value(row, q) if acc.kind == "flow"
                           else to_number(row.get("thstrm_amount")))
        for y, q in want:
            label = f"{y}Q{q}"
            if acc.kind == "stock":
                vals[label] = cum.get((y, q))
            else:
                cur = cum.get((y, q))
                prev = cum.get((y, q - 1)) if q > 1 else 0.0
                vals[label] = None if cur is None or prev is None else cur - prev
        out.data[acc.key] = vals
        if all(v is None for v in vals.values()):
            out.missing.append(acc.label)
    return out


# ---------------------------------------------------------------------------
# 지표 계산 (인수인계 메모의 '계산해 둔 지표'와 같은 항목들)
# ---------------------------------------------------------------------------
def derive_metrics(fs: FinancialSeries) -> dict[str, list[float | None]]:
    qs = fs.quarters
    g = lambda k: fs.series(k)  # noqa: E731
    rev, op, ni = g("revenue"), g("op_income"), g("net_income")
    assets, liab, eq, cfo = g("assets"), g("liabilities"), g("equity"), g("cfo")

    def div(a, b, mult=1.0):
        return [None if (x is None or y in (None, 0)) else x / y * mult for x, y in zip(a, b)]

    def yoy(vals):
        out = []
        for i, v in enumerate(vals):
            p = vals[i - 4] if i >= 4 else None
            out.append(None if (v is None or p in (None, 0)) else (v / abs(p) - 1) * 100)
        return out

    def ttm(vals):
        out = []
        for i in range(len(vals)):
            w = vals[max(0, i - 3): i + 1]
            out.append(None if (len(w) < 4 or any(v is None for v in w)) else sum(w))
        return out

    op_margin = div(op, rev, 100)
    metrics = {
        "매출액YoY(%)": yoy(rev),
        "영업이익YoY(%)": yoy(op),
        "영업이익률(%)": op_margin,
        "순이익률(%)": div(ni, rev, 100),
        "부채비율(%)": div(liab, eq, 100),
        "ROE(TTM,%)": [None if (n is None or e in (None, 0)) else n / e * 100
                       for n, e in zip(ttm(ni), eq)],
        "현금전환(CFO/영업이익)": div(cfo, op),          # 이익의 질
        "매출TTM": ttm(rev),
        "영업이익TTM": ttm(op),
        "순이익TTM": ttm(ni),
    }
    # 이익가속: 영업이익률이 직전 분기보다 개선됐는지 (+YoY 증가폭 확대)
    accel = []
    for i, m in enumerate(op_margin):
        p = op_margin[i - 1] if i >= 1 else None
        accel.append(None if (m is None or p is None) else m - p)
    metrics["영업이익률 변화(%p)"] = accel
    metrics["_분기"] = qs
    return metrics
