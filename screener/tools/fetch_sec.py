#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
미국 기업의 분기 실적(EPS·매출)을 SEC 에서 받아 둡니다.

왜 SEC 인가
  미국은 무료로 쓸 만한 실적 출처가 마땅치 않습니다. 그런데 상장사는
  분기마다 SEC 에 XBRL 로 신고하고, SEC 는 그것을 공개 API 로 내줍니다.
  키도, 돈도 필요 없습니다. 원천 자료라 가장 정확합니다.

어떻게 받나 — frames API
  종목을 하나씩 부르면 3천 번을 불러야 합니다. frames 는 반대로
  '이 분기, 이 항목' 을 넣으면 그 분기에 신고한 회사를 전부 한 번에 줍니다.

    /api/xbrl/frames/us-gaap/Revenues/USD/CY2026Q1.json

━━ 2026-08-19 고침 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
예전에는 '가장 최근 분기' 하나만 보고 끝냈습니다. 그래서 두 가지 문제가 있었습니다.

 1) 결산월이 다른 회사가 통째로 빠졌습니다.
    엔비디아(1월 결산)·애플(9월)·월마트(1월)·코스트코(8월) 같은 회사는
    자기 분기가 CY2026Q1 틀에 안 맞아 그 프레임에 아예 없습니다.
    → 최근 4개 분기를 모두 받아 두고, 회사마다 '자기가 가진 가장 최근 분기' 를 씁니다.

 2) 올해와 작년을 서로 다른 태그로 비교했습니다.
    올해는 RevenueFromContract..., 작년은 Revenues 로 잡히면 정의가 달라
    증가율이 엉뚱하게 나옵니다.
    → 이제 올해와 작년이 **같은 태그** 로 둘 다 있을 때만 증가율을 냅니다.

━━ 2026-09-14 더함 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
최근 4분기를 함께 담습니다. 어차피 frames 로 4분기(LOOKBACK)를 이미 받아 두고
있었는데 가장 최근 한 분기만 쓰고 버렸습니다 — SEC 를 더 부르지 않고도
분기별 흐름을 보여줄 수 있습니다. 칸은 막대(|)로 이어 붙인 한 칸씩입니다.
  실적분기목록 CY2026Q2|CY2026Q1|CY2025Q4|CY2025Q3   (최신이 앞)
  매출분기목록 / EPS분기목록 / 매출성장목록 / EPS성장목록
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

확인용:  python3 tools/fetch_sec.py --check AAPL NVDA MSFT WMT
        (저장하지 않고 그 종목의 숫자만 보여 줍니다)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

⚠️ 그래도 100% 는 아닙니다
  · 신규 상장·적자 전환·신고 지연 회사는 짝이 안 맞아 빠집니다
  · 은행·리츠는 '매출' 개념 자체가 달라 태그가 안 잡히기도 합니다
  못 구한 종목은 빈칸으로 둡니다. 억지로 채우지 않습니다.

SEC 는 요청에 연락처를 적으라고 요구합니다 (.env 의 SEC_UA, 없으면 기본값).
"""
from __future__ import annotations
import datetime as dt
import json
import os
import sys
import time
import urllib.request

import pandas as pd

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, 'data', 'us_fin.parquet')
TICKERS = 'https://www.sec.gov/files/company_tickers.json'
FRAMES = 'https://data.sec.gov/api/xbrl/frames/{tax}/{tag}/{unit}/CY{y}Q{q}.json'
SLEEP = 0.15                       # SEC 권고: 초당 10건 이하
LOOKBACK = 4                       # 최근 몇 개 분기까지 훑을지
QN = 4                             # 화면에 보여줄 분기 수 (LOOKBACK 을 넘지 않습니다)

# 분기별 목록으로 보내는 칸 — report.py·run_us.py 와 이름이 같아야 합니다.
SERIES_COLS = ['실적분기목록', '매출분기목록', 'EPS분기목록',
               '매출성장목록', 'EPS성장목록']


def _join(vals, nd: int = 9) -> str:
    """숫자 목록을 막대(|)로. 없는 자리는 빈칸 — '1234||1100' 처럼.

    %g 로 적습니다. 미국 매출은 원값이 커서(940억 달러) .2f 로 적으면
    한 종목에 수십 글자가 붙습니다.
    증가율처럼 자리가 필요 없는 값은 부르는 쪽에서 nd 를 줄여 씁니다.
    """
    out = []
    for v in vals:
        if v is None:
            out.append('')
        else:
            try:
                out.append(f'{float(v):.{nd}g}')
            except (TypeError, ValueError):
                out.append('')
    return '|'.join(out)

# 매출 — 회사마다 쓰는 이름이 다릅니다. 앞에 있는 것부터 씁니다.
SALES_TAGS = [
    'RevenueFromContractWithCustomerExcludingAssessedTax',
    'Revenues',
    'RevenueFromContractWithCustomerIncludingAssessedTax',
    'SalesRevenueNet',
]
# EPS — 회사마다 이름이 다릅니다. 2026-08-19 확인:
#   에어비앤비·비자·몬스터는 EarningsPerShare* 를 안 쓰고
#   IncomeLossFromContinuingOperationsPer*Share 로 신고합니다.
#   이걸 몰라서 1,400여 종목의 EPS 가 통째로 비어 있었습니다.
#
# '같은 뜻' 끼리 묶습니다. 희석과 기본은 분모가 달라 절대 섞으면 안 되지만,
# 같은 묶음 안에서는 이름이 달라도 같은 것을 재는 값이라 짝을 지어도 됩니다
# (중단사업이 없으면 두 이름의 값이 같습니다 — 애플·보잉에서 확인).
EPS_GROUPS = [
    ['EarningsPerShareDiluted',
     'IncomeLossFromContinuingOperationsPerDilutedShare',
     'EarningsPerShareBasicAndDiluted'],
    ['EarningsPerShareBasic',
     'IncomeLossFromContinuingOperationsPerBasicShare'],
]
EPS_TAGS = [t for g in EPS_GROUPS for t in g]

# 매출은 이름마다 포함 범위가 미묘하게 달라 묶지 않습니다 (각자 하나씩).
SALES_GROUPS = [[t] for t in SALES_TAGS]

# ── EPS 를 못 찾았을 때의 차선책: 순이익 ÷ 주식수 ──────────────
#  2026-08-19: 비자·버크셔처럼 주식이 클래스 A/B/C 로 나뉜 회사는
#  주당순이익을 '클래스별' 로 신고합니다. SEC 공개 API 는 그렇게 쪼개진 값을
#  내주지 않아서, 이런 회사에는 EPS 항목이 통째로 없습니다.
#  다행히 순이익과 가중평균 주식수는 쪼개지지 않으니 직접 나눠 씁니다.
#  회사가 발표한 EPS 와 소수점 아래에서 조금 다를 수 있지만,
#  우리가 쓰는 것은 '증가율' 이라 그 차이는 상쇄됩니다.
NI_TAGS = ['NetIncomeLoss', 'ProfitLoss']
SH_TAGS = ['WeightedAverageNumberOfDilutedSharesOutstanding',
           'WeightedAverageNumberOfSharesOutstandingBasic',
           'WeightedAverageNumberOfSharesOutstanding']


def log(m):
    print(f'[{dt.datetime.now():%H:%M:%S}] {m}', flush=True)


def _ua() -> dict:
    who = os.environ.get('SEC_UA', '')
    if not who or '@' not in who:
        raise ValueError('SEC_UA에 본인 이름과 이메일을 설정하세요.')
    return {'User-Agent': who, 'Accept-Encoding': 'gzip, deflate'}


def _get(url: str, timeout: int = 60) -> dict:
    req = urllib.request.Request(url, headers=_ua())
    with urllib.request.urlopen(req, timeout=timeout) as r:
        raw = r.read()
        if r.headers.get('Content-Encoding') == 'gzip':
            import gzip as gz
            raw = gz.decompress(raw)
        return json.loads(raw.decode('utf-8', 'replace'))


def cik_map() -> dict:
    """종목코드(티커) → CIK 번호"""
    j = _get(TICKERS)
    out = {}
    for v in (j.values() if isinstance(j, dict) else j):
        t = str(v.get('ticker') or '').upper()
        c = v.get('cik_str')
        if t and c is not None:
            out[t] = int(c)
    log(f'종목-CIK 대응표 {len(out):,}개')
    return out


def frame(tag: str, unit: str, y: int, q: int, quiet=False, tax='us-gaap') -> dict:
    """{cik: 값} . 없으면 빈 표."""
    try:
        j = _get(FRAMES.format(tax=tax, tag=tag, unit=unit, y=y, q=q))
    except Exception as e:
        if not quiet:
            log(f'   · {tag[:34]:<34} CY{y}Q{q}  실패({e})')
        time.sleep(SLEEP)
        return {}
    out = {}
    for x in j.get('data') or []:
        try:
            out[int(x['cik'])] = float(x['val'])
        except (KeyError, TypeError, ValueError):
            continue
    if not quiet:
        log(f'   {tag[:34]:<34} CY{y}Q{q}  {len(out):>6,}개')
    time.sleep(SLEEP)
    return out


def quarters(n: int) -> list:
    """오늘 기준 '이미 끝난' 분기부터 뒤로 n 개. 새 것이 앞."""
    t = dt.date.today()
    y, q = t.year, (t.month - 1) // 3 + 1
    q -= 1                                   # 진행 중인 분기는 뺍니다
    if q == 0:
        y, q = y - 1, 4
    out = []
    for _ in range(n):
        out.append((y, q))
        q -= 1
        if q == 0:
            y, q = y - 1, 4
    return out


def load_all(tags: list, unit: str, qs: list) -> dict:
    """{(tag, y, q): {cik: 값}} — 올해분과 작년 같은 분기를 함께 받아 둡니다."""
    need = set()
    for (y, q) in qs:
        for tag in tags:
            need.add((tag, y, q))
            need.add((tag, y - 1, q))
    box = {}
    for (tag, y, q) in sorted(need, key=lambda x: (x[0], -x[1], -x[2])):
        box[(tag, y, q)] = frame(tag, unit, y, q)
    return box


def pick(box: dict, groups: list, cik: int, qs: list):
    """
    회사마다 '자기가 가진 가장 최근 분기' 를 골라 (증가율, 당분기, 전년, 분기, 태그).

    groups 는 '같은 것을 재는 이름' 끼리 묶은 목록입니다.
    한 묶음 안에서는 올해와 작년의 이름이 달라도 짝을 지읍니다.
    묶음을 넘어서는 절대 섞지 않습니다 (희석 EPS 를 기본 EPS 로 나누면 안 되니까요).
    """
    for (y, q) in qs:
        for g in groups:
            cur = prev = None
            ctag = ''
            for tag in g:
                if cur is None:
                    v = box.get((tag, y, q), {}).get(cik)
                    if v is not None:
                        cur, ctag = v, tag
                if prev is None:
                    v = box.get((tag, y - 1, q), {}).get(cik)
                    if v is not None:
                        prev = v
            if cur is None or prev is None:
                continue
            rate = growth(cur, prev)
            if rate is None:
                continue
            return rate, cur, prev, f'CY{y}Q{q}', ctag
    return None, None, None, None, None


def pick_series(box: dict, groups: list, cik: int, qs: list):
    """최근 분기부터 QN 개 — (분기이름, 값, 증가율) 세 벌을 나란히 돌려줍니다.

    pick() 은 '짝이 맞는 가장 최근 한 분기' 에서 멈춥니다. 여기서는 멈추지 않고
    qs 에 있는 분기를 모두 훑습니다. 값만 있고 전년 짝이 없는 분기도 버리지
    않습니다 — 증가율 자리만 비워 두고 값은 보여 줍니다.

    묶음(groups)은 분기마다 앞에서부터 다시 고릅니다. 회사는 보통 같은 이름으로
    계속 신고하므로 실제로는 같은 묶음이 잡힙니다. 증가율은 **한 분기 안에서
    같은 묶음끼리만** 내므로, 묶음이 바뀌어도 증가율이 뒤섞이지는 않습니다.
    """
    labels, vals, rates = [], [], []
    for (y, q) in qs[:QN]:
        cur = rate = None
        for g in groups:
            c = p = None
            for tag in g:
                if c is None:
                    c = box.get((tag, y, q), {}).get(cik)
                if p is None:
                    p = box.get((tag, y - 1, q), {}).get(cik)
            if c is None:
                continue
            cur, rate = c, growth(c, p)
            break
        labels.append(f'CY{y}Q{q}')
        vals.append(cur)
        rates.append(rate)
    return labels, vals, rates


def pick_series_calc(ni: dict, sh: dict, cik: int, qs: list):
    """EPS 항목이 없는 회사용 — 순이익 ÷ 주식수 로 분기별 EPS 를 만듭니다."""
    def val(box, tags, y, q):
        for t in tags:
            v = box.get((t, y, q), {}).get(cik)
            if v:                       # 0 이나 None 이면 다음 이름으로
                return v
        return None

    labels, vals, rates = [], [], []
    for (y, q) in qs[:QN]:
        n1, s1 = val(ni, NI_TAGS, y, q), val(sh, SH_TAGS, y, q)
        n0, s0 = val(ni, NI_TAGS, y - 1, q), val(sh, SH_TAGS, y - 1, q)
        cur = None if (n1 is None or s1 is None) else n1 / s1
        prev = None if (n0 is None or s0 is None) else n0 / s0
        labels.append(f'CY{y}Q{q}')
        vals.append(cur)
        rates.append(growth(cur, prev) if cur is not None else None)
    return labels, vals, rates


def _trim(labels, sv, sg, ev, eg):
    """맨 뒤의 '아무 값도 없는 분기' 를 잘라냅니다.

    신규 상장이나 신고 지연으로 뒤쪽이 통째로 비면 화면에 빈 줄만 늘어납니다.
    앞쪽(최근)이 비는 것은 '아직 발표 전' 이라 뜻이 있으니 그대로 둡니다.
    """
    n = 0
    for k in range(len(labels)):
        if sv[k] is not None or ev[k] is not None or sg[k] is not None or eg[k] is not None:
            n = k + 1
    return labels[:n], sv[:n], sg[:n], ev[:n], eg[:n]


def series_cols(labels, sv, sg, ev, eg) -> dict:
    """분기별 목록 다섯 칸을 한꺼번에 만듭니다."""
    labels, sv, sg, ev, eg = _trim(labels, sv, sg, ev, eg)
    return {'실적분기목록': '|'.join(labels), '매출분기목록': _join(sv),
            'EPS분기목록': _join(ev), '매출성장목록': _join(sg, 4),
            'EPS성장목록': _join(eg, 4)}


EMPTY_SERIES = {c: '' for c in SERIES_COLS}


def pick_calc(ni: dict, sh: dict, cik: int, qs: list):
    """순이익 ÷ 주식수 로 EPS 를 직접 만들어 봅니다 (EPS 항목이 없는 회사용)."""
    def val(box, tags, y, q):
        for t in tags:
            v = box.get((t, y, q), {}).get(cik)
            if v:                       # 0 이나 None 이면 다음 이름으로
                return v
        return None

    for (y, q) in qs:
        n1 = val(ni, NI_TAGS, y, q);     s1 = val(sh, SH_TAGS, y, q)
        n0 = val(ni, NI_TAGS, y - 1, q); s0 = val(sh, SH_TAGS, y - 1, q)
        if None in (n1, s1, n0, s0):
            continue
        cur, prev = n1 / s1, n0 / s0
        rate = growth(cur, prev)
        if rate is None:
            continue
        return rate, cur, prev, f'CY{y}Q{q}', '순이익÷주식수'
    return None, None, None, None, None


def pick_ni(ni: dict, cik: int, qs: list):
    """주식수마저 없을 때 — 순이익 증가율을 대신 씁니다.

    비자·버크셔처럼 주식이 클래스 A/B/C 로 나뉜 회사는 주당순이익도, 주식수도
    클래스별로 신고합니다. SEC 공개 API 는 그렇게 쪼개진 값을 내주지 않습니다.
    순이익만은 하나로 나오니 그 증가율을 씁니다.
    자사주 매입 때문에 실제 EPS 증가율보다 조금 낮게 나오지만 방향과 크기는 거의 같습니다.
    화면에는 ※ 를 달아 '이건 EPS 가 아니라 순이익' 이라고 알립니다.

    값 자체(당분기·전년)는 넘기지 않습니다 — 주당 금액이 아니라서
    화면에 $ 로 찍히면 오해를 부릅니다. 증가율만 씁니다.
    """
    for (y, q) in qs:
        c = p = None
        for t in NI_TAGS:
            if c is None:
                c = ni.get((t, y, q), {}).get(cik)
            if p is None:
                p = ni.get((t, y - 1, q), {}).get(cik)
        rate = growth(c, p)
        if rate is None:
            continue
        return rate, None, None, f'CY{y}Q{q}', '순이익'
    return None, None, None, None, None


# ── IFRS (외국계 ADR) — 회사별 조회 ────────────────────────────
#  2026-08-20 1차 시도(frames API 로 ifrs-full 훑기)는 실패했습니다.
#  4분 동안 태그×통화×분기 전부 404 — frames 는 us-gaap 만 내줍니다.
#
#  2차: 회사별 조회(companyfacts)로 바꿉니다. 이 API 는 그 회사의 모든
#  체계(us-gaap · ifrs-full)와 모든 통화 자료를 한 번에 줍니다.
#  전 종목에 쓰면 수천 번 호출이라, **우리 스크리닝 대상 중 빈칸인 종목만** 조회합니다.
#  (대상 목록은 output/us_payload.json 에서 읽습니다 — 없으면 이 단계를 건너뜁니다)
IFRS_EPS_TAGS = ['DilutedEarningsLossPerShare', 'BasicEarningsLossPerShare',
                 'BasicAndDilutedEarningsLossPerShare']
IFRS_SALES_TAGS = ['Revenue', 'RevenueFromContractsWithCustomers',
                   'RevenueFromSaleOfGoods', 'RevenueFromRenderingOfServices']
IFRS_NI_TAGS = ['ProfitLoss', 'ProfitLossAttributableToOwnersOfParent']


def _facts_frames(j: dict, taxes: list, tags: list, per_share: bool) -> dict:
    """companyfacts JSON 에서 {(태그|단위, 'CYyQq'): 값} 을 뽑습니다.

    분기 값만 씁니다 — SEC 가 'frame' 이라는 꼬리표(CY2026Q2 등)를 달아 준
    항목이 그것입니다. 꼬리표 없는 항목은 누적(YTD)일 수 있어 버립니다.
    """
    out = {}
    for tax in taxes:
        for tag in tags:
            node = j.get('facts', {}).get(tax, {}).get(tag)
            if not node:
                continue
            for unit, arr in (node.get('units') or {}).items():
                is_ps = '/shares' in unit
                if per_share != is_ps:
                    continue
                for x in arr or []:
                    fr = str(x.get('frame') or '')
                    # 분기(CY2026Q2)와 연간(CY2025) 꼬리표를 받습니다.
                    #  외국계 ADR 상당수는 분기 보고를 안 하고 반기·연간으로만
                    #  신고합니다 — 그런 회사는 연간 값으로라도 증가율을 냅니다.
                    #  I 로 끝나는 것은 시점값(잔액)이라 버립니다.
                    ok_q = fr.startswith('CY') and 'Q' in fr and not fr.endswith('I')
                    ok_y = fr.startswith('CY') and len(fr) == 6 and fr[2:].isdigit()
                    if not (ok_q or ok_y):
                        continue
                    try:
                        out[(f'{tag}|{unit}', fr)] = float(x['val'])
                    except (KeyError, TypeError, ValueError):
                        continue
    return out


def _pick_facts(fx: dict, qs: list):
    """같은 태그·같은 단위로 올해/작년 분기가 둘 다 있는 가장 최근 짝."""
    keys = {k for (k, _) in fx}
    # ① 분기 우선
    for (y, q) in qs:
        cur_f, prv_f = f'CY{y}Q{q}', f'CY{y - 1}Q{q}'
        for k in sorted(keys):
            c, p2 = fx.get((k, cur_f)), fx.get((k, prv_f))
            if c is None or p2 is None:
                continue
            rate = growth(c, p2)
            if rate is None:
                continue
            unit = k.split('|', 1)[1]
            usd = unit.upper().startswith('USD')
            return rate, (c if usd else None), (p2 if usd else None), cur_f, f'회사별·{unit}'
    # ② 분기가 없으면 연간 — 반기·연간으로만 신고하는 외국계용
    y0 = qs[0][0]
    for y in (y0, y0 - 1):
        cur_f, prv_f = f'CY{y}', f'CY{y - 1}'
        for k in sorted(keys):
            c, p2 = fx.get((k, cur_f)), fx.get((k, prv_f))
            if c is None or p2 is None:
                continue
            rate = growth(c, p2)
            if rate is None:
                continue
            unit = k.split('|', 1)[1]
            usd = unit.upper().startswith('USD')
            return rate, (c if usd else None), (p2 if usd else None), f'FY{y}', f'연간·{unit}'
    return None, None, None, None, None


def _facts_series(fx: dict, qs: list):
    """companyfacts 에서 분기별 (분기이름, 값, 증가율).

    값은 달러로 신고한 것만 담습니다 — 위안·유로로 신고한 ADR 의 숫자를
    화면에 $ 로 찍으면 오해를 부릅니다. 증가율은 통화와 무관하니 그대로 씁니다.
    """
    keys = sorted({k for (k, _) in fx})
    labels, vals, rates = [], [], []
    for (y, q) in qs[:QN]:
        cur_f, prv_f = f'CY{y}Q{q}', f'CY{y - 1}Q{q}'
        v = r = None
        for k in keys:
            c = fx.get((k, cur_f))
            if c is None:
                continue
            r = growth(c, fx.get((k, prv_f)))
            if k.split('|', 1)[1].upper().startswith('USD'):
                v = c
            break
        labels.append(cur_f)
        vals.append(v)
        rates.append(r)
    return labels, vals, rates


def _universe_codes() -> set:
    """스크리닝 대상 종목(3,000여 개). 없으면 빈 집합 — 이 단계를 건너뜁니다."""
    path = os.path.join(BASE, 'output', 'us_payload.json')
    try:
        with open(path, encoding='utf-8') as f:
            rows = json.load(f).get('result') or []
        return {str(r.get('코드') or '').upper() for r in rows if not r.get('제외사유')}
    except Exception:
        return set()


LOSS_FLAT = 0.10          # 적자 규모가 ±10% 안이면 '적자지속' 으로 봅니다


def pick_loss(eps: dict, ni: dict, cik: int, qs: list):
    """올해도 작년도 적자일 때 — 증가율 대신 **방향**만 적습니다.

    왜 증가율을 안 쓰나
      작년 −50 → 올해 −30 이면 좋아진 것인데 −30/−50−1 = −40% 로 나옵니다.
      부호 때문에 '나빠졌다' 로 읽히죠. 반대도 마찬가지고요.
      비율을 만들 수 없는 자리에서는 만들지 않고 사실만 적습니다.

    임상단계 바이오텍이 여기 해당합니다. 미국에서 EPS 를 못 구하는 종목의
    77% 가 이 경우였습니다(2026-08-19 조사, 1,239종목 중 957종목).
    EBITDA 로 바꿔도 분모가 음수인 문제는 그대로라 넘을 수 없었습니다.

    EPS 를 먼저 보고, 없으면 순이익으로 판단합니다.
    """
    for (y, q) in qs:
        cur = prev = None
        for g in EPS_GROUPS:
            c = p = None
            for tag in g:
                if c is None:
                    c = eps.get((tag, y, q), {}).get(cik)
                if p is None:
                    p = eps.get((tag, y - 1, q), {}).get(cik)
            if c is not None and p is not None:
                cur, prev = c, p
                break
        if cur is None or prev is None:
            c = p = None
            for t in NI_TAGS:
                if c is None:
                    c = ni.get((t, y, q), {}).get(cik)
                if p is None:
                    p = ni.get((t, y - 1, q), {}).get(cik)
            cur, prev = c, p
        if cur is None or prev is None:
            continue
        if cur >= 0 or prev >= 0:          # 적자끼리일 때만 쓰는 잣대입니다
            continue
        d = (cur - prev) / abs(prev)       # + 면 덜 잃음(개선), − 면 더 잃음
        if d > LOSS_FLAT:
            return '적자축소', f'CY{y}Q{q}'
        if d < -LOSS_FLAT:
            return '적자확대', f'CY{y}Q{q}'
        return '적자지속', f'CY{y}Q{q}'
    return '', None


def growth(cur, prev):
    """증가율. 작년이 0 이하면 계산이 무의미하니 흑자전환(999)이나 빈칸으로."""
    if cur is None or prev is None:
        return None
    if prev == 0:
        return None
    if prev < 0:
        return 999.0 if cur > 0 else None
    return cur / prev - 1


# ────────────────────────────────────────────────────────────────
def check(names: list) -> int:
    """저장하지 않고 지정한 종목의 숫자만 보여 줍니다 — 눈으로 맞춰 보기용."""
    ciks = cik_map()
    qs = quarters(LOOKBACK)
    log(f'훑는 분기: {", ".join(f"CY{y}Q{q}" for y, q in qs)}')
    sales = load_all(SALES_TAGS, 'USD', qs)
    eps = load_all(EPS_TAGS, 'USD-per-shares', qs)
    ni = load_all(NI_TAGS, 'USD', qs)
    sh = load_all(SH_TAGS, 'shares', qs)
    print()
    print(f'{"종목":<8}{"분기":<10}{"매출(당분기)":>18}{"매출(전년)":>18}{"증가율":>9}'
          f'{"EPS":>9}{"EPS전년":>9}{"증가율":>9}  태그')
    print('─' * 118)
    for t in names:
        t = t.upper()
        cik = ciks.get(t)
        if cik is None:
            print(f'{t:<8}CIK 를 못 찾음')
            continue
        gs, sc, sp, sq, stag = pick(sales, SALES_GROUPS, cik, qs)
        ge, ec, ep, eq, esrc = pick(eps, EPS_GROUPS, cik, qs)
        if ge is None:
            ge, ec, ep, eq, esrc = pick_calc(ni, sh, cik, qs)
        if ge is None:
            ge, ec, ep, eq, esrc = pick_ni(ni, cik, qs)
        if ge is None or gs is None:
            try:
                j = _get(f'https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json', 90)
                if ge is None:
                    ge, ec, ep, eq, esrc = _pick_facts(
                        _facts_frames(j, ['us-gaap', 'ifrs-full'],
                                      EPS_TAGS + IFRS_EPS_TAGS, True), qs)
                if gs is None:
                    gs, sc, sp, sq, stag = _pick_facts(
                        _facts_frames(j, ['us-gaap', 'ifrs-full'],
                                      SALES_TAGS + IFRS_SALES_TAGS, False), qs)
            except Exception:
                pass
        if ge is None:
            est, lq = pick_loss(eps, ni, cik, qs)
            if est:
                esrc = est
                eq = eq or lq
        f = lambda v: '-' if v is None else f'{v:,.0f}'
        g = lambda v: '-' if v is None else ('흑전' if v == 999 else f'{v * 100:+.1f}%')
        e = lambda v: '-' if v is None else f'{v:,.2f}'
        print(f'{t:<8}{str(sq or eq or "-"):<10}{f(sc):>18}{f(sp):>18}{g(gs):>9}'
              f'{e(ec):>9}{e(ep):>9}{g(ge):>9}  {(esrc or "")[:26]}')
    return 0


def main() -> int:
    if '--check' in sys.argv:
        i = sys.argv.index('--check')
        names = sys.argv[i + 1:]
        return check(names or ['AAPL', 'NVDA', 'MSFT', 'WMT', 'COST', 'AVGO'])

    ciks = cik_map()
    qs = quarters(LOOKBACK)
    log(f'훑는 분기: {", ".join(f"CY{y}Q{q}" for y, q in qs)} (+ 각 작년 같은 분기)')

    log('매출')
    sales = load_all(SALES_TAGS, 'USD', qs)
    log('EPS')
    eps = load_all(EPS_TAGS, 'USD-per-shares', qs)
    log('EPS 차선책 (순이익 · 주식수)')
    ni = load_all(NI_TAGS, 'USD', qs)
    sh = load_all(SH_TAGS, 'shares', qs)


    rows = []
    for tick, cik in ciks.items():
        gs, sc, sp, sq, _ = pick(sales, SALES_GROUPS, cik, qs)
        ge, ec, ep, eq, esrc = pick(eps, EPS_GROUPS, cik, qs)
        if ge is None:
            ge, ec, ep, eq, esrc = pick_calc(ni, sh, cik, qs)
        if ge is None:
            ge, ec, ep, eq, esrc = pick_ni(ni, cik, qs)
        est = ''
        if ge is None:                      # 증가율을 못 낸 이유가 '적자' 인지 봅니다
            est, lq = pick_loss(eps, ni, cik, qs)
            if est and not eq:
                eq = lq
        if gs is None and ge is None and not est:
            continue

        # 최근 4분기 — 이미 받아 둔 frames 를 다시 훑을 뿐이라 SEC 를 더 부르지 않습니다
        labels, sv, sg = pick_series(sales, SALES_GROUPS, cik, qs)
        _, ev, eg = pick_series(eps, EPS_GROUPS, cik, qs)
        if not any(v is not None for v in ev):
            _, ev, eg = pick_series_calc(ni, sh, cik, qs)

        rows.append({'code': tick, 'EPS증가율': ge, '매출증가율': gs,
                     'EPS당분기': ec, 'EPS전년': ep,
                     '매출당분기': sc, '매출전년': sp,
                     '실적분기': sq or eq, 'EPS출처': esrc or '',
                     'EPS상태': est,
                     **series_cols(labels, sv, sg, ev, eg)})
    df = pd.DataFrame(rows)
    if not len(df):
        log('[오류] 만들어진 줄이 없습니다')
        return 1

    # ── 2차: 스크리닝 대상인데 아직 빈 종목만 회사별 조회 ──────────
    uni = _universe_codes()
    if uni:
        have = {}
        for k, row in enumerate(rows):
            have[row['code']] = k
        targets = []
        for code in sorted(uni):
            k = have.get(code)
            if k is None:
                if code in ciks:
                    targets.append(code)
            else:
                r0 = rows[k]
                if r0.get('EPS증가율') is None and not r0.get('EPS상태'):
                    targets.append(code)
        targets = targets[:800]                 # 안전 상한 (SEC 예절)
        log(f'회사별 조회 — 대상 중 빈칸 {len(targets):,}종목을 하나씩 물어봅니다')
        fixed = 0
        for i, code in enumerate(targets):
            cik = ciks[code]
            try:
                j = _get(f'https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json', 90)
            except Exception:
                time.sleep(SLEEP)
                continue
            ge, ec, ep, eq, esrc = _pick_facts(
                _facts_frames(j, ['us-gaap', 'ifrs-full'],
                              EPS_TAGS + IFRS_EPS_TAGS, True), qs)
            gs2, sc2, sp2, sq2, _ = _pick_facts(
                _facts_frames(j, ['us-gaap', 'ifrs-full'],
                              SALES_TAGS + IFRS_SALES_TAGS, False), qs)
            time.sleep(SLEEP)
            if ge is None and gs2 is None:
                continue
            fixed += 1
            labels, sv, sg = _facts_series(
                _facts_frames(j, ['us-gaap', 'ifrs-full'],
                              SALES_TAGS + IFRS_SALES_TAGS, False), qs)
            _, ev, eg = _facts_series(
                _facts_frames(j, ['us-gaap', 'ifrs-full'],
                              EPS_TAGS + IFRS_EPS_TAGS, True), qs)
            row = {'code': code, 'EPS증가율': ge, '매출증가율': gs2,
                   'EPS당분기': ec, 'EPS전년': ep,
                   '매출당분기': sc2, '매출전년': sp2,
                   '실적분기': eq or sq2, 'EPS출처': esrc or '', 'EPS상태': '',
                   **series_cols(labels, sv, sg, ev, eg)}
            k = have.get(code)
            if k is None:
                rows.append(row)
            else:                               # 있던 줄은 빈 칸만 채웁니다
                for kk, vv in row.items():
                    if rows[k].get(kk) in (None, '') and vv not in (None, ''):
                        rows[k][kk] = vv
            if (i + 1) % 100 == 0:
                log(f'   {i + 1}/{len(targets)} … 채움 {fixed}')
        log(f'   회사별 조회로 {fixed:,}종목 채움')
        df = pd.DataFrame(rows)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    df.to_parquet(OUT, index=False)
    mix = df['실적분기'].value_counts().head(6)
    log(f'저장 — {len(df):,}종목 (매출 {int(df["매출증가율"].notna().sum()):,} · '
        f'EPS {int(df["EPS증가율"].notna().sum()):,}) → {OUT}')
    log('   분기 분포: ' + ' / '.join(f'{k} {v:,}' for k, v in mix.items()))
    if 'EPS출처' in df.columns:
        for nm, why in (('순이익÷주식수', 'EPS 항목이 없어 순이익÷주식수 로 계산'),
                        ('순이익', '주식수도 없어 순이익 증가율로 대신 (※ 표시)')):
            n = int((df['EPS출처'] == nm).sum())
            if n:
                log(f'   그중 {n:,}종목은 {why}')
    if 'EPS출처' in df.columns:
        n_ifrs = int(df['EPS출처'].astype(str).str.startswith('IFRS').sum())
        if n_ifrs:
            log(f'   그중 {n_ifrs:,}종목은 IFRS(외국계 ADR) 경로로 구제')
    if 'EPS상태' in df.columns:
        vc = df['EPS상태'].value_counts()
        got = ' / '.join(f'{k} {v:,}' for k, v in vc.items() if k)
        if got:
            log(f'   적자라 증가율을 못 내는 종목: {got}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
