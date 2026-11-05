"""
데모 데이터
-----------
인터넷 연결이나 DART 인증키 없이도 '수집 → 차트 → 데이터팩 → 보고서 → PDF' 전 과정이
제대로 도는지 확인하기 위한 가짜 데이터입니다. 실제 수치가 아닙니다.
"""

from __future__ import annotations

import math

from .dart_fin import ACCOUNTS, FinancialSeries
from .price import PriceData

억 = 1e8


def demo_series() -> FinancialSeries:
    qs = [f"{y}Q{q}" for y in (2023, 2024, 2025, 2026) for q in range(1, 5)][:12]
    fs = FinancialSeries(stock_code="000000", corp_code="00000000", fs_div="CFS")
    fs.quarters = qs

    base = {
        "revenue":     [480, 520, 610, 700, 540, 590, 700, 796, 620, 680, 780, 902],
        "op_income":   [58,  66,  84, 102,  72,  84, 108, 130,  88,  96, 120, 150],
        "net_income":  [46,  52,  67,  81,  57,  66,  86, 104,  70,  76,  95, 119],
        "cfo":         [40,  50,  58,  95,  48,  60,  70, 121,  52,  58,  74, 133],
        "assets":      [2600, 2680, 2790, 2900, 3010, 3120, 3260, 3400, 3550, 3690, 3860, 4050],
        "liabilities": [1180, 1200, 1240, 1270, 1310, 1340, 1390, 1420, 1470, 1510, 1560, 1610],
        "equity":      [1420, 1480, 1550, 1630, 1700, 1780, 1870, 1980, 2080, 2180, 2300, 2440],
        "inventories": [320, 340, 366, 380, 395, 410, 432, 450, 470, 495, 520, 548],
        "receivables": [410, 435, 470, 505, 520, 560, 610, 655, 690, 730, 790, 850],
        "contract_liab": [180, 190, 205, 220, 235, 250, 268, 285, 300, 320, 345, 370],
    }
    for acc in ACCOUNTS:
        vals = base.get(acc.key)
        fs.data[acc.key] = {q: (vals[i] * 억 if vals else None) for i, q in enumerate(qs)}
        if not vals:
            fs.missing.append(acc.label)
    return fs


def demo_price() -> PriceData:
    p = PriceData(stock_code="000000", name="데모전자")
    n = 750
    dates, closes = [], []
    import datetime as dt
    d = dt.date.today() - dt.timedelta(days=int(n * 1.45))
    v = 21000.0
    for i in range(n):
        while d.weekday() >= 5:
            d += dt.timedelta(days=1)
        drift = 1.0009
        wave = 1 + 0.035 * math.sin(i / 21) + 0.02 * math.sin(i / 6.3)
        v = v * drift
        closes.append(round(v * wave, -1))
        dates.append(d.isoformat())
        d += dt.timedelta(days=1)
    p.dates, p.close = dates, closes
    p.volume = [100000 + (i % 37) * 5000 for i in range(n)]
    p.last_close, p.last_date = closes[-1], dates[-1]
    yr = closes[-250:]
    p.high_52w, p.low_52w = max(yr), min(yr)
    for w in (50, 120, 200):
        p.ma[f"{w}일선"] = sum(closes[-w:]) / w
    p.market_cap = p.last_close * 16_448_909
    p.per, p.pbr, p.eps, p.bps = 14.2, 2.9, round(p.last_close / 14.2), round(p.last_close / 2.9)
    p.consensus = {"목표주가": round(p.last_close * 1.18, -2), "투자의견": "매수",
                   "출처": "데모(가짜 값)",
                   "현재가대비(%)": 18.0}
    p.notes.append("※ 데모 데이터입니다. 실제 시세가 아닙니다.")
    return p


def demo_peers():
    from .peers import Peer, PeerGroup
    pg = PeerGroup(target_code="000000", target_name="데모전자", sector="전기장비")
    pg.method = "데모(가짜 값)"
    pg.peers = [
        Peer(code="111111", name="가나전기", market_cap=8200 * 억, per=11.4, pbr=1.8),
        Peer(code="222222", name="다라파워", market_cap=15300 * 억, per=18.9, pbr=3.1),
        Peer(code="333333", name="마바에너지", market_cap=6400 * 억, per=9.7, pbr=1.2),
        Peer(code="444444", name="사아중공업", market_cap=21000 * 억, per=22.5, pbr=2.4),
    ]
    return pg


def demo_disclosures():
    import datetime as dt
    today = dt.date.today()
    names = ["반기보고서", "단일판매ㆍ공급계약체결", "주요사항보고서(유형자산취득결정)",
             "기업설명회(IR)개최", "임원ㆍ주요주주특정증권등소유상황보고서"]
    return [{"rcept_dt": (today - dt.timedelta(days=7 * i)).strftime("%Y%m%d"),
             "report_nm": nm, "flr_nm": "데모전자",
             "url": "https://dart.fss.or.kr/"} for i, nm in enumerate(names)]
