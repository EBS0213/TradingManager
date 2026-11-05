#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
지표 화면에 쓸 **미국(FRED) · 한국(한국은행 ECOS)** 거시지표를 받아
사이트로 밀어 넣습니다.

왜 서울에서 하나
  사이트는 미국 서버(Vercel)에서 도는데 거기서 FRED 를 부르면 응답이 오지
  않습니다 (25초를 기다려도 aborted). 버핏지수와 똑같은 상황이라 똑같이
  풉니다 — 서울 서버가 받아서 POST /api/macro 로 보냅니다.

필요한 환경변수
  SITE_URL        http://127.0.0.1:8766
  SCREENER_KEY    사이트와 약속한 열쇠
  FRED_API_KEY    https://fredaccount.stlouisfed.org/apikeys  (무료·즉시)
  ECOS_API_KEY    https://ecos.bok.or.kr/api/  (무료·즉시)  — 없으면 한국 칸은 건너뜁니다

하루 한 번이면 충분합니다. crontab 예:
  30 8 * * * cd ~/screener && ./tools/push_macro.py >> logs/macro.log 2>&1

점검만 하고 보내지 않으려면:  ./tools/push_macro.py --dry
"""
from __future__ import annotations
import datetime as dt
import json
import os
import sys
import urllib.parse
import urllib.request

UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'}
FRED_API = 'https://api.stlouisfed.org/fred/series/observations'
ECOS_API = 'https://ecos.bok.or.kr/api/StatisticSearch'


def log(m):
    print(f'[{dt.datetime.now():%H:%M:%S}] {m}', flush=True)


def get(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode('utf-8', 'replace')


# ══════════ 미국 — FRED ══════════
#  freq  D 하루 · M 한 달 · Q 분기        (바로 앞 값과 견주는 이름표를 정합니다)
#  pct   True 면 값 자체가 % 입니다 (등락을 %p 로 적습니다)
#  yoy   True 면 1년 전과도 견줍니다
#  scale 값을 나눌 수 : 1000 이면 '십억' 단위로 바꿉니다
# 항목: (FRED코드, 보여줄이름, 원래이름, 단위, 주기, %인가, 1년전과도견주나, 나눌수)
#   주기  D 하루 · W 주 · M 달 · Q 분기   → 바로 앞 값과 견주는 이름표를 정합니다
#   %인가 True 면 값 자체가 % 라 등락을 %p 로 적습니다 (퍼센트의 퍼센트를 안 냅니다)
#   나눌수 FRED 단위를 우리가 쓰는 단위로 맞춥니다 (백만달러 → 십억달러면 1000)
FRED = [
    ('us_gdp', '미국 GDP', 'US', [
        ('GDP', 'GDP', 'Gross Domestic Product', '십억달러', 'Q', False, True, 1),
        ('GDPC1', '실질GDP', 'Real Gross Domestic Product', '십억달러', 'Q', False, True, 1),
        ('A191RL1Q225SBEA', '실질GDP성장률', 'Real GDP, Percent Change', '%', 'Q', True, False, 1),
        ('GDI', 'GDI', 'Gross Domestic Income', '십억달러', 'Q', False, True, 1),
        ('GDPPOT', '잠재GDP', 'Real Potential GDP', '십억달러', 'Q', False, True, 1),
        ('PCEC', '개인소비지출', 'Personal Consumption Expenditures', '십억달러', 'Q', False, True, 1),
        ('GPDI', '민간총투자', 'Gross Private Domestic Investment', '십억달러', 'Q', False, True, 1),
        ('GCE', '정부지출', 'Government Consumption and Investment', '십억달러', 'Q', False, True, 1),
        ('NETEXP', '순수출', 'Net Exports of Goods and Services', '십억달러', 'Q', False, False, 1),
    ]),
    ('us_policy', '미국 기준금리', 'US', [
        ('DFEDTARU', '기준금리 상단', 'Federal Funds Target Range Upper Limit', '%', 'D', True, False, 1),
        ('DFEDTARL', '기준금리 하단', 'Federal Funds Target Range Lower Limit', '%', 'D', True, False, 1),
        ('EFFR', '실효 연방기금금리', 'Effective Federal Funds Rate', '%', 'D', True, False, 1),
        ('IORB', '지준 부리금리', 'Interest Rate on Reserve Balances', '%', 'D', True, False, 1),
        ('SOFR', 'SOFR', 'Secured Overnight Financing Rate', '%', 'D', True, False, 1),
    ]),
    ('us_rate', '미국 국채금리', 'US', [
        ('DGS1MO', '국채 1개월', '1-Month Treasury', '%', 'D', True, False, 1),
        ('DGS3MO', '국채 3개월', '3-Month Treasury', '%', 'D', True, False, 1),
        ('DGS6MO', '국채 6개월', '6-Month Treasury', '%', 'D', True, False, 1),
        ('DGS1', '국채 1년', '1-Year Treasury', '%', 'D', True, False, 1),
        ('DGS2', '국채 2년', '2-Year Treasury', '%', 'D', True, False, 1),
        ('DGS3', '국채 3년', '3-Year Treasury', '%', 'D', True, False, 1),
        ('DGS5', '국채 5년', '5-Year Treasury', '%', 'D', True, False, 1),
        ('DGS7', '국채 7년', '7-Year Treasury', '%', 'D', True, False, 1),
        ('DGS10', '국채 10년', '10-Year Treasury', '%', 'D', True, False, 1),
        ('DGS20', '국채 20년', '20-Year Treasury', '%', 'D', True, False, 1),
        ('DGS30', '국채 30년', '30-Year Treasury', '%', 'D', True, False, 1),
    ]),
    ('us_spread', '미국 금리 스프레드', 'US', [
        ('T10Y2Y', '10년－2년', '10Y minus 2Y', '%p', 'D', True, False, 1),
        ('T10Y3M', '10년－3개월', '10Y minus 3M', '%p', 'D', True, False, 1),
        ('DFII10', '실질금리 10년', '10Y TIPS (Real)', '%', 'D', True, False, 1),
        ('T5YIE', '기대인플레 5년', '5Y Breakeven Inflation', '%', 'D', True, False, 1),
        ('T10YIE', '기대인플레 10년', '10Y Breakeven Inflation', '%', 'D', True, False, 1),
        ('T5YIFR', '5년후 5년 기대인플레', '5Y Forward Inflation Rate', '%', 'D', True, False, 1),
        ('BAMLH0A0HYM2', '하이일드 스프레드', 'US High Yield Option-Adjusted Spread', '%p', 'D', True, False, 1),
        ('BAMLC0A0CM', '투자등급 스프레드', 'US Corporate Option-Adjusted Spread', '%p', 'D', True, False, 1),
    ]),
    ('us_money', '미국 통화', 'US', [
        ('BOGMBASE', '본원통화', 'Monetary Base', '십억달러', 'M', False, True, 1000),
        ('M1SL', 'M1', 'M1 Money Stock', '십억달러', 'M', False, True, 1),
        ('M2SL', 'M2', 'M2 Money Stock', '십억달러', 'M', False, True, 1),
        ('M1V', 'M1 유통속도', 'Velocity of M1', '', 'Q', False, True, 1),
        ('M2V', 'M2 유통속도', 'Velocity of M2', '', 'Q', False, True, 1),
        ('CURRCIR', '유통 중 현금', 'Currency in Circulation', '십억달러', 'M', False, True, 1000),
    ]),
    ('us_fed', '미국 연준계정', 'US', [
        ('WALCL', '연준 총자산', 'Total Assets (Fed Balance Sheet)', '십억달러', 'W', False, True, 1000),
        ('WRESBAL', '지급준비금', 'Reserve Balances with Federal Reserve Banks', '십억달러', 'W', False, True, 1000),
        ('RRPONTSYD', '익일 역레포', 'Overnight Reverse Repurchase Agreements', '십억달러', 'D', False, False, 1),
        ('WTREGEN', '재무부 일반계정(TGA)', 'Treasury General Account', '십억달러', 'W', False, False, 1000),
    ]),
    ('us_fedsec', '미국 연준보유채권', 'US', [
        ('TREAST', '연준 보유 국채', 'Securities Held Outright: Treasury', '십억달러', 'W', False, True, 1000),
        ('MBST', '연준 보유 MBS', 'Securities Held Outright: MBS', '십억달러', 'W', False, True, 1000),
    ]),
    ('us_cpi', '미국 물가', 'US', [
        ('CPIAUCSL', 'CPI(계절조정)', 'Consumer Price Index, SA', '', 'M', False, True, 1),
        ('CPIAUCNS', 'CPI(원계열)', 'Consumer Price Index, NSA', '', 'M', False, True, 1),
        ('CPILFESL', 'Core CPI', 'CPI Less Food and Energy', '', 'M', False, True, 1),
        ('PCEPI', 'PCE 물가', 'PCE Price Index', '', 'M', False, True, 1),
        ('PCEPILFE', 'Core PCE', 'PCE Excluding Food and Energy', '', 'M', False, True, 1),
        ('PPIACO', 'PPI(전품목)', 'Producer Price Index: All Commodities', '', 'M', False, True, 1),
        ('PPIFIS', 'PPI(최종수요)', 'PPI: Final Demand', '', 'M', False, True, 1),
    ]),
    ('us_cpi2', '미국 물가 세부', 'US', [
        ('CPIUFDSL', '식품', 'CPI: Food', '', 'M', False, True, 1),
        ('CPIENGSL', '에너지', 'CPI: Energy', '', 'M', False, True, 1),
        ('CUSR0000SETB01', '휘발유', 'CPI: Gasoline (All Types)', '', 'M', False, True, 1),
        ('CPIHOSSL', '주거', 'CPI: Housing', '', 'M', False, True, 1),
        ('CUSR0000SEHA', '임대료', 'CPI: Rent of Primary Residence', '', 'M', False, True, 1),
        ('CPIMEDSL', '의료', 'CPI: Medical Care', '', 'M', False, True, 1),
        ('CPITRNSL', '교통', 'CPI: Transportation', '', 'M', False, True, 1),
        ('CPIAPPSL', '의류', 'CPI: Apparel', '', 'M', False, True, 1),
    ]),
    ('us_job', '미국 고용', 'US', [
        ('UNRATE', '실업률', 'Unemployment Rate', '%', 'M', True, False, 1),
        ('U6RATE', '실업률 U-6', 'Total Unemployed Plus Marginally Attached (U-6)', '%', 'M', True, False, 1),
        ('PAYEMS', '비농업고용', 'All Employees, Total Nonfarm', '천명', 'M', False, True, 1),
        ('MANEMP', '제조업 고용', 'All Employees, Manufacturing', '천명', 'M', False, True, 1),
        ('ICSA', '신규 실업수당청구', 'Initial Claims', '건', 'W', False, False, 1),
        ('CCSA', '연속 실업수당청구', 'Continued Claims', '건', 'W', False, False, 1),
        ('CIVPART', '경제활동참가율', 'Labor Force Participation Rate', '%', 'M', True, False, 1),
        ('EMRATIO', '고용률', 'Employment-Population Ratio', '%', 'M', True, False, 1),
        ('CES0500000003', '시간당 임금', 'Average Hourly Earnings', '달러', 'M', False, True, 1),
        ('JTSJOL', '구인 건수', 'Job Openings: Total Nonfarm', '천건', 'M', False, True, 1),
    ]),
    ('us_consume', '미국 소비 · 소득', 'US', [
        ('RSAFS', '소매판매', 'Advance Retail Sales', '백만달러', 'M', False, True, 1),
        ('RSXFS', '소매판매(자동차 제외)', 'Retail Sales Ex Motor Vehicle', '백만달러', 'M', False, True, 1),
        ('PCE', '개인소비지출(월)', 'Personal Consumption Expenditures', '십억달러', 'M', False, True, 1),
        ('DSPIC96', '실질 가처분소득', 'Real Disposable Personal Income', '십억달러', 'M', False, True, 1),
        ('PSAVERT', '저축률', 'Personal Saving Rate', '%', 'M', True, False, 1),
        ('TOTALSA', '자동차 판매', 'Total Vehicle Sales', '백만대', 'M', False, True, 1),
        ('UMCSENT', '소비자심리지수', 'U. Michigan Consumer Sentiment', '', 'M', False, True, 1),
    ]),
    ('us_prod', '미국 생산 · 기업', 'US', [
        ('INDPRO', '산업생산지수', 'Industrial Production Index', '', 'M', False, True, 1),
        ('TCU', '설비가동률', 'Capacity Utilization', '%', 'M', True, False, 1),
        ('IPMAN', '제조업 생산', 'Industrial Production: Manufacturing', '', 'M', False, True, 1),
        ('DGORDER', '내구재 주문', 'Manufacturers New Orders: Durable Goods', '백만달러', 'M', False, True, 1),
        ('NEWORDER', '비국방 자본재 주문', 'New Orders: Nondefense Capital Goods ex Aircraft', '백만달러', 'M', False, True, 1),
        ('ISRATIO', '재고/판매 비율', 'Inventories to Sales Ratio', '', 'M', False, False, 1),
    ]),
    ('us_house', '미국 주택', 'US', [
        ('HOUST', '주택 착공', 'Housing Starts', '천호', 'M', False, True, 1),
        ('PERMIT', '건축 허가', 'Building Permits', '천호', 'M', False, True, 1),
        ('HSN1F', '신규주택 판매', 'New One Family Houses Sold', '천호', 'M', False, True, 1),
        ('EXHOSLUSM495S', '기존주택 판매', 'Existing Home Sales', '호', 'M', False, True, 1),
        ('MSPUS', '주택 중위가격', 'Median Sales Price of Houses Sold', '달러', 'Q', False, True, 1),
        ('CSUSHPINSA', '케이스실러 주택가격', 'S&P CoreLogic Case-Shiller Home Price Index', '', 'M', False, True, 1),
        ('MORTGAGE30US', '30년 모기지 금리', '30-Year Fixed Rate Mortgage Average', '%', 'W', True, False, 1),
    ]),
    ('us_fiscal', '미국 재정 · 부채', 'US', [
        ('GFDEBTN', '연방정부 부채', 'Federal Debt: Total Public Debt', '조달러', 'Q', False, True, 1000000),
        ('GFDEGDQ188S', '부채 ÷ GDP', 'Federal Debt as Percent of GDP', '%', 'Q', True, False, 1),
        ('MTSDS133FMS', '월간 재정수지', 'Federal Surplus or Deficit', '백만달러', 'M', False, False, 1),
    ]),
    ('us_trade', '미국 무역', 'US', [
        ('BOPGSTB', '무역수지', 'Trade Balance: Goods and Services', '백만달러', 'M', False, False, 1),
        ('EXPGS', '수출', 'Exports of Goods and Services', '십억달러', 'Q', False, True, 1),
        ('IMPGS', '수입', 'Imports of Goods and Services', '십억달러', 'Q', False, True, 1),
    ]),
    ('us_fx', '미국 환율', 'US', [
        ('DTWEXBGS', '달러인덱스(광의)', 'Nominal Broad U.S. Dollar Index', '', 'D', False, False, 1),
        ('DTWEXAFEGS', '달러인덱스(선진국)', 'Nominal Advanced Foreign Economies Dollar Index', '', 'D', False, False, 1),
        ('DEXUSEU', '유로/달러', 'U.S. Dollars to Euro', '달러', 'D', False, False, 1),
        ('DEXJPUS', '달러/엔', 'Yen to U.S. Dollar', '엔', 'D', False, False, 1),
        ('DEXCHUS', '달러/위안', 'Yuan to U.S. Dollar', '위안', 'D', False, False, 1),
        ('DEXKOUS', '달러/원', 'Won to U.S. Dollar', '원', 'D', False, False, 1),
        ('DEXUSUK', '파운드/달러', 'U.S. Dollars to Pound', '달러', 'D', False, False, 1),
        ('DEXCAUS', '달러/캐나다달러', 'Canadian Dollar to U.S. Dollar', '', 'D', False, False, 1),
    ]),
    ('us_market', '미국 시장 · 원자재', 'US', [
        ('SP500', 'S&P 500', 'S&P 500 Index', '', 'D', False, False, 1),
        ('NASDAQCOM', '나스닥 종합', 'NASDAQ Composite Index', '', 'D', False, False, 1),
        ('DJIA', '다우존스', 'Dow Jones Industrial Average', '', 'D', False, False, 1),
        ('VIXCLS', 'VIX', 'CBOE Volatility Index', '', 'D', False, False, 1),
        ('DCOILWTICO', 'WTI 유가', 'Crude Oil Prices: WTI', '달러', 'D', False, False, 1),
        ('DCOILBRENTEU', '브렌트 유가', 'Crude Oil Prices: Brent', '달러', 'D', False, False, 1),
    ]),
    ('us_stress', '미국 금융여건 · 선행', 'US', [
        ('ANFCI', '시카고 금융여건(조정)', 'Chicago Fed Adjusted National Financial Conditions Index', '', 'W', False, False, 1),
        ('STLFSI4', '세인트루이스 금융스트레스', 'St. Louis Fed Financial Stress Index', '', 'W', False, False, 1),
        ('USSLIND', '주별 선행지수', 'Leading Index for the United States', '%', 'M', True, False, 1),
        ('USREC', '경기침체 표시', 'NBER Recession Indicator (1=침체)', '', 'M', False, False, 1),
    ]),
]

STEP = {'D': 'DoD', 'W': 'WoW', 'M': 'MoM', 'Q': 'QoQ'}


def fred_series(sid: str, key: str, start: str) -> list[tuple[str, float]]:
    q = urllib.parse.urlencode({
        'series_id': sid, 'api_key': key, 'file_type': 'json',
        'observation_start': start, 'sort_order': 'asc',
    })
    j = json.loads(get(f'{FRED_API}?{q}'))
    out = []
    for o in j.get('observations') or []:
        try:
            out.append((o['date'], float(o['value'])))
        except (KeyError, ValueError, TypeError):
            continue          # '.' = 미발표
    return out


def _yoy_back(freq: str) -> int:
    """1년 전은 몇 칸 뒤인가"""
    return {'D': 252, 'W': 52, 'M': 12, 'Q': 4}.get(freq, 12)


def make_row(name, en, unit, freq, pct, yoy, scale, pts):
    if not pts:
        return None
    day, val = pts[-1]
    val = val / scale
    chg = []
    if len(pts) >= 2:
        prev = pts[-2][1] / scale
        d = val - prev
        chg.append({'k': STEP.get(freq, 'chg'), 'v': round(d, 4),
                    'p': None if pct or prev == 0 else round(d / prev * 100, 2)})
    back = _yoy_back(freq)
    if yoy and len(pts) > back:
        prev = pts[-1 - back][1] / scale
        d = val - prev
        chg.append({'k': 'YoY', 'v': round(d, 4),
                    'p': None if pct or prev == 0 else round(d / prev * 100, 2)})
    return {'name': name, 'en': en, 'value': round(val, 4), 'unit': unit, 'day': day, 'chg': chg}


def collect_fred(key: str) -> list[dict]:
    """130줄 남짓을 하나씩 받으면 4분이 넘습니다. 여섯 개씩 동시에 받습니다.
       FRED 는 분당 120건까지 받아 주므로 여유가 있습니다."""
    from concurrent.futures import ThreadPoolExecutor
    start = (dt.date.today() - dt.timedelta(days=1500)).isoformat()

    def one(item):
        sid, name, en, unit, freq, pct, yoy, scale = item
        try:
            pts = fred_series(sid, key, start)
            r = make_row(name, en, unit, freq, pct, yoy, scale, pts)
            if r:
                return r
            return ('빈 응답', sid)
        except Exception as e:
            return (str(e)[:70], sid)

    groups = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        for gkey, label, side, items in FRED:
            rows, bad = [], []
            for out in pool.map(one, items):
                if isinstance(out, tuple):
                    bad.append(f'{out[1]}({out[0]})')
                else:
                    rows.append(out)
            if rows:
                groups.append({'key': gkey, 'label': label, 'side': side,
                               'src': 'FRED', 'rows': rows})
            log(f' · {label} {len(rows)}/{len(items)}줄'
                + (f"  · 실패: {', '.join(bad)}" if bad else ''))
    return groups


# ══════════ 한국 — 한국은행 ECOS ══════════
#  (통계표코드, 주기, 항목코드, 보여줄 이름, 원래 이름, 단위, %인가, 1년전과도 견주나)
#  ⚠️ 항목코드는 한국은행이 이따금 바꿉니다. 안 나오는 줄이 있으면
#     https://ecos.bok.or.kr/api/#/DevGuide/StatisticalCodeSearch 에서 찾아 고치세요.
#     --dry 로 돌리면 어느 줄이 실패했는지 그대로 찍힙니다.
ECOS = [
    ('kr_rate', '한국 금리', [
        ('722Y001', 'M', '0101000', '한국은행 기준금리', 'Bank of Korea Base Rate', '%', True, False),
        ('817Y002', 'D', '010200000', '국고채 3년', 'KTB 3Y', '%', True, False),
        ('817Y002', 'D', '010210000', '국고채 10년', 'KTB 10Y', '%', True, False),
        ('817Y002', 'D', '010502000', '회사채 3년(AA-)', 'Corporate AA- 3Y', '%', True, False),
    ]),
    ('kr_cpi', '한국 물가 · 고용', [
        ('901Y009', 'M', '0', '소비자물가지수', 'Consumer Price Index', '', False, True),
        ('901Y027', 'M', 'I61BC', '실업률', 'Unemployment Rate', '%', True, False),
    ]),
    ('kr_money', '한국 통화 · 대외', [
        ('101Y004', 'M', 'BBHA00', 'M2(평잔)', 'M2 Average', '십억원', False, True),
        ('301Y017', 'M', 'SA000', '경상수지', 'Current Account', '백만달러', False, False),
        ('902Y001', 'M', 'ABEA01', '수출', 'Exports', '천달러', False, True),
    ]),
]


def ecos_series(key, stat, freq, item, n=40):
    """최근 n 개를 받아 (날짜, 값) 로 돌려줍니다."""
    url = f'{ECOS_API}/{key}/json/kr/1/{n}/{stat}/{freq}/'
    # 시작·끝 날짜는 넉넉히 잡습니다 (형식은 주기마다 다릅니다)
    today = dt.date.today()
    if freq == 'D':
        a, b = (today - dt.timedelta(days=200)).strftime('%Y%m%d'), today.strftime('%Y%m%d')
    elif freq == 'M':
        a, b = (today - dt.timedelta(days=1200)).strftime('%Y%m'), today.strftime('%Y%m')
    else:
        a, b = str(today.year - 4), str(today.year)
    url += f'{a}/{b}/{item}'
    j = json.loads(get(url))
    if 'StatisticSearch' not in j:
        raise RuntimeError(str(j)[:160])
    out = []
    for o in j['StatisticSearch'].get('row') or []:
        try:
            out.append((o['TIME'], float(o['DATA_VALUE'])))
        except (KeyError, ValueError, TypeError):
            continue
    out.sort()
    return out


def _pretty_day(t: str) -> str:
    if len(t) == 8:
        return f'{t[:4]}-{t[4:6]}-{t[6:]}'
    if len(t) == 6:
        return f'{t[:4]}-{t[4:]}'
    return t


def collect_ecos(key: str) -> list[dict]:
    groups = []
    for gkey, label, items in ECOS:
        rows = []
        for stat, freq, item, name, en, unit, pct, yoy in items:
            try:
                pts = ecos_series(key, stat, freq, item)
                r = make_row(name, en, unit, freq, pct, yoy, 1, pts)
                if r:
                    r['day'] = _pretty_day(r['day'])
                    rows.append(r)
                else:
                    log(f'   · {stat}/{item} 빈 응답')
            except Exception as e:
                log(f'   · {stat}/{item} 실패 — {e}')
        if rows:
            groups.append({'key': gkey, 'label': label, 'side': 'KR', 'src': '한국은행', 'rows': rows})
            log(f' · {label} {len(rows)}줄')
    return groups


def main() -> int:
    dry = '--dry' in sys.argv
    fred_key = os.environ.get('FRED_API_KEY', '').strip()
    ecos_key = os.environ.get('ECOS_API_KEY', '').strip()
    groups = []

    if fred_key:
        log('미국(FRED) 받는 중…')
        groups += collect_fred(fred_key)
    else:
        log('[건너뜀] FRED_API_KEY 가 없습니다')

    if ecos_key:
        log('한국(ECOS) 받는 중…')
        groups += collect_ecos(ecos_key)
    else:
        log('[건너뜀] ECOS_API_KEY 가 없습니다')

    total = sum(len(g['rows']) for g in groups)
    log(f'묶음 {len(groups)}개 · 줄 {total}개')
    if not groups:
        log('[오류] 보낼 것이 없습니다')
        return 1
    if dry:
        print(json.dumps(groups, ensure_ascii=False, indent=1)[:4000])
        return 0

    site = os.environ.get('SITE_URL', '').rstrip('/')
    skey = os.environ.get('SCREENER_KEY', '')
    if not site or not skey:
        log('[오류] SITE_URL / SCREENER_KEY 가 없습니다')
        return 1
    body = json.dumps({'groups': groups}, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(
        f'{site}/api/macro', data=body, method='POST',
        headers={'Content-Type': 'application/json; charset=utf-8', 'x-screener-key': skey})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            log(f'전송 완료 ({r.status}) — {r.read().decode("utf-8", "replace")[:200]}')
        return 0
    except Exception as e:
        log(f'[오류] 전송 실패 — {e}')
        return 1


if __name__ == '__main__':
    sys.exit(main())
