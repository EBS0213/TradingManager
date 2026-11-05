#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
배점 검증 백테스트 (2026-08-30)
====================================================================
무엇을 하나
  "거래량·거래대금 증가율을 채점에 넣어야 하나, 넣는다면 얼마나?" 를
  **논쟁이 아니라 자료로** 정하기 위한 스크립트입니다.

어떻게 하나
  1. data/ohlcv.parquet 을 과거 어느 날(T)까지만 잘라서
     **평소 쓰는 rules.screen() 을 그대로** 돌립니다.
     → 그 날 실제로 보였을 화면이 그대로 재현됩니다 (미래를 안 봅니다).
  2. 그 날 8조건을 통과한 종목들의 각 항목 값을 받아 둡니다.
  3. T+63거래일(약 3개월) 뒤 수익률을 붙입니다.
  4. 항목마다 '순위상관(IC)' 을 재서 **무엇이 실제로 이기는 종목을 골라내는지**
     봅니다. 그리고 배점안 세 개로 종합점수를 매겨 상위 20종목의 3개월
     수익률을 견줍니다.

  ⚠️ 정직하게 — 이 백테스트가 **답할 수 없는 것**이 있습니다.
     · EPS·매출 증가율은 **과거 값이 저장돼 있지 않습니다**
       (data/cache_실적.csv 는 오늘 값 한 벌뿐입니다).
       과거 날짜에 오늘의 실적을 쓰면 '미래를 미리 아는' 셈이라
       결과가 부풀려집니다. 그래서 **실적은 아예 뺐습니다.**
       → 거래량과 EPS 중 무엇이 위냐는 이 스크립트로 못 정합니다.
         그건 과거 분기 실적을 모으는 일이 먼저입니다.
     · 상장폐지된 종목이 tickers.parquet 에 없습니다(생존 편향).
       망한 종목이 빠져 있으니 **수익률은 실제보다 좋게 나옵니다.**
       배점안끼리 견주는 데는 영향이 작지만, 절대 수익률은 믿지 마세요.
     · 수급(외국인·기관)도 과거 값이 없어 뺐습니다.

  그래서 이 스크립트가 **답할 수 있는 것**만 봅니다 —
     거래량·거래대금이 값어치가 있나, 둘이 겹치나,
     가격 계열 항목들(RS·고점·VCP·지속·자금흐름) 사이에서 어디쯤인가.

쓰는 법
    cd ~/minervini
    .venv/bin/python tools/backtest_weights.py                # 24개월, 3개월 보유
    .venv/bin/python tools/backtest_weights.py --months 36 --hold 42
"""
from __future__ import annotations
import os
import sys
import argparse
import warnings
import numpy as np
import pandas as pd

warnings.filterwarnings('ignore')
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from screener import config, rules, data as sdata      # noqa: E402
try:
    from tools import vcp2                                # noqa: E402
except Exception:
    import vcp2                                           # noqa: E402


# ── 재는 항목 ────────────────────────────────────────────────────
#   screen() 이 내놓는 칸에서 그대로 가져옵니다.
#   '클수록 좋다' 가 되도록 방향을 맞춰 둡니다(고점대비는 음수라 그대로 씀).
FACTORS = {
    'RS':        ('RS',            +1, 'RS 순위'),
    '고점':      ('고점대비',       +1, '52주 고점에 얼마나 가까운가 (0에 가까울수록 좋음)'),
    'VCP':       ('수축비',        -1, '수축비 (작을수록 조여졌다)'),
    '지속':      ('상태일수',       +1, '지금 상태를 며칠째 유지하나'),
    '자금':      ('UD비율',        +1, '상승일 거래량 ÷ 하락일 거래량'),
    '거래량':    ('최근거래량_비율', +1, '최근 5일 거래량 ÷ 20일 평균'),
    '거래대금':  ('거래대금비',      +1, '최근 5일 거래대금 ÷ 20일 평균'),
    # ── 4차에서 새로 재는 것 (2026-08-30) ───────────────────────
    #  3차에서 '거래량' 이 두 국면 모두 음(-) 이었습니다. 부호를 뒤집으면
    #  두 국면 모두 + 입니다 — 미너비니가 말하는 **거래량 마름(dry-up)** 입니다.
    #  베이스 안에서 거래가 말라붙는 것이 좋은 신호라는 뜻이라, 따로 한 줄로 봅니다.
    '거래량마름': ('최근거래량_비율', -1, '최근 5일 거래량이 20일 평균보다 **적은가** ← 새로'),
    '당일거래량': ('당일거래량비',    -1, '오늘 거래량이 평소보다 적은가 ← 새로'),
    # 베이스가 얕은가 — SEPA 는 깊은 베이스를 싫어합니다.
    #  저점대비가 클수록 바닥에서 많이 올라온 것이라, 부호를 어느 쪽으로
    #  잡아야 하는지는 자료가 답할 문제입니다. 일단 + 로 재 봅니다.
    '저점':      ('저점대비',       +1, '52주 저점에서 얼마나 올라왔나 ← 새로'),
    # 이전 베이스의 고점을 얼마나 넘어섰나 — 베이스 차수 대용
    '직전고점':  ('직전고점대비',    +1, '직전 52주 고점 대비 위치 ← 새로'),
    # 피벗에 얼마나 가까운가 (타이밍 지표라 점수에서 뺐던 것 — 값어치만 확인)
    '피벗이격':  ('피벗대비이격',   -1, '피벗가에서 얼마나 떨어져 있나 ← 새로'),
    # ── 새 VCP (tools/vcp2.py) — 되돌림 단위로 다시 잰 것 ────────
    #  지금 '수축비' 는 최근 8주를 달력으로 3등분한 값입니다.
    #  아래는 가격 움직임으로 구간을 나눠(6% 되돌림 = 수축 하나) 잰 값입니다.
    #  둘의 예측력을 나란히 놓고 봅니다 — 새것이 못 이기면 안 바꿉니다.
    'VCP2감소':  ('깊이감소비',     -1, '마지막 수축 ÷ 첫 수축 (작을수록 조여듦) ← 새 VCP'),
    'VCP2막깊이': ('막수축깊이',    -1, '마지막 되돌림이 얼마나 얕은가 ← 새 VCP'),
    'VCP2마름':  ('막수축거래량',   -1, '마지막 수축에서 거래량이 말랐나 ← 새 VCP'),
    'VCP2단조':  ('깊이단조',       +1, '수축이 계속 얕아졌나 (1/0) ← 새 VCP'),
    'VCP2개수':  ('수축개수',       -1, '수축이 몇 번인가 (적을수록 깔끔) ← 새 VCP'),
    'VCP2베이스깊이': ('베이스깊이', -1, '베이스가 얕은가 ← 새 VCP'),
    'VCP2직전상승': ('직전상승',    +1, '베이스 전에 충분히 올랐나 ← 새 VCP'),
    # ── Jun 제안 (2026-08-30) — RS 눈금 대신 '통과개수' ─────────
    #  RS 는 상한이 없어 뻗은 종목이 계속 위로 옵니다(최악 낙폭 -57%).
    #  통과개수는 8 에서 천장이 있어 그 편향이 없습니다.
    #  ※ Jun 식 `10 - 1.5×(8-통과개수)` 는 목록 안에서
    #     `1.5×통과개수 - 2` 와 **완전히 같습니다**(하한 0 이 안 걸림).
    #     그래서 통과개수 하나만 재면 그 안의 예측력을 다 알 수 있습니다.
    '통과개수':  ('통과개수',       +1, '8조건 중 몇 개를 채웠나 ← Jun 제안'),
}


# ── 견줄 배점안 셋 ───────────────────────────────────────────────
#   실적(EPS·매출)은 과거 값이 없어 뺐으므로, 세 안 모두 **가격 계열만**
#   남기고 합이 100이 되게 다시 나눴습니다. 서로 견주는 것이 목적입니다.
SCHEMES = {
    # ── 5차 (2026-08-30) ────────────────────────────────────────
    #  4차에서 드러난 것:
    #    · VCP2베이스깊이 +0.168 (t 11.03, 92%) ← **새 최강 항목**
    #    · 고점대비 +0.119 · VCP2개수 +0.099 · 직전고점 +0.091
    #    · 통과개수 +0.029 (약하지만 두 국면 +)
    #    · 저점 -0.114 · VCP2직전상승 -0.170 → 둘 다 '이미 많이 갔나' 계열
    #  그런데 4차의 '조율+새VCP' 안에는 **베이스깊이와 개수가 빠져 있었습니다.**
    #  최강 항목 둘을 빼고 겨뤘으니 다시 잽니다.
    #
    #  ⚠️ 고점대비와 베이스깊이는 겹칠 수 있습니다(둘 다 고점에서의 하락폭 계열).
    #     아래 ②-2 절에서 상관을 재고, 높으면 한쪽만 씁니다.
    '현행': {'RS': 41, '고점': 20, 'VCP': 19, '지속': 13, '자금': 11},
    # 4차 승자 — 기준선
    '조율안v2': {'RS': 10, '고점': 24, 'VCP': 14, '지속': 8, '거래량마름': 8},
    # 4차에서 마름을 뺀 쪽이 근소 우위였습니다 — 그 안도 기준선으로
    '조율-마름': {'RS': 10, '고점': 28, 'VCP': 16, '지속': 10},
    # ★ 본안 — 베이스깊이를 제대로 넣습니다 (RS 10 유지)
    '베이스깊이안': {'RS': 10, '고점': 18, 'VCP2베이스깊이': 18, 'VCP2개수': 10,
                     'VCP2막깊이': 6, '지속': 8},
    # ★ 같은 구성에서 RS 를 통과개수로 (4차에서 낙폭 -23.5% 로 압승했던 방향)
    '통과+베이스': {'통과개수': 10, '고점': 18, 'VCP2베이스깊이': 18, 'VCP2개수': 10,
                    'VCP2막깊이': 6, '지속': 8},
    # 베이스깊이에 더 무게를 싣고 고점대비를 줄인 안 (둘이 겹칠 경우 대비)
    '베이스몰기': {'통과개수': 10, '고점': 10, 'VCP2베이스깊이': 26, 'VCP2개수': 10,
                   '직전고점': 6, '지속': 8},
    # 반대로 고점대비만 남기고 베이스깊이를 뺀 안 — 어느 쪽이 진짜인지 가릅니다
    '고점만남김': {'통과개수': 10, '고점': 32, 'VCP': 12, 'VCP2개수': 8, '지속': 8},
    # 옛 VCP(수축비) 대신 새 VCP 만으로 — 갈아끼울 값어치가 있나
    '새VCP전부': {'통과개수': 10, '고점': 16, 'VCP2베이스깊이': 18, 'VCP2개수': 10,
                  'VCP2막깊이': 6, 'VCP2단조': 4, '지속': 6},
}


def zscore(s: pd.Series) -> pd.Series:
    """그 날 통과 종목들 안에서의 상대 위치. 항목마다 단위가 달라 그대로는 못 더합니다."""
    v = pd.to_numeric(s, errors='coerce')
    m, sd = v.mean(), v.std(ddof=0)
    if not np.isfinite(sd) or sd == 0:
        return pd.Series(0.0, index=s.index)
    return ((v - m) / sd).clip(-3, 3).fillna(0.0)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--months', type=int, default=24, help='몇 달치를 볼까 (기본 24)')
    ap.add_argument('--hold', type=int, default=63, help='몇 거래일 뒤 수익률 (기본 63 ≈ 3개월)')
    ap.add_argument('--step', type=int, default=5, help='며칠마다 다시 매길까 (기본 21 ≈ 한 달)')
    ap.add_argument('--top', type=int, default=20, help='상위 몇 종목을 살까 (기본 20)')
    ap.add_argument('--pass-only', action='store_true', help='8조건 통과만 (기본은 6개 이상)')
    ap.add_argument('--market', default='KR', choices=['KR', 'US'],
                    help="어느 시장을 볼까 (기본 KR). US 는 us_ohlcv.parquet 을 씁니다")
    a = ap.parse_args()

    US = (a.market == 'US')
    print('자료를 읽습니다…', flush=True)
    if US:
        # ── 미국 ────────────────────────────────────────────────
        #  run_us.py 의 us_settings() 와 같은 설정을 씁니다. 8조건 자체는
        #  한국과 똑같고, '얼마 미만을 버릴지' 두 개만 다릅니다.
        #  실적·수급은 미국에 자료가 없어 애초에 꺼져 있습니다.
        import copy
        s = copy.deepcopy(config.load())
        s.min_price = float(os.environ.get('US_MIN_PRICE', '5'))
        s.min_trade_value = float(os.environ.get('US_MIN_VALUE', '2000000'))
        s.use_fundamentals = False
        s.use_supply = False
        s.exclude_spac = False
        s.exclude_etf_etn = False
        s.markets = ['US']
        ohlcv = pd.read_parquet(os.path.join(config.DATA_DIR, 'us_ohlcv.parquet'))
        tk = pd.read_parquet(os.path.join(config.DATA_DIR, 'us_tickers.parquet'))
        # 보통주와 ADR 만 (ETF·우선주·워런트는 미너비니 대상이 아닙니다)
        if 'type' in tk.columns:
            tk = tk[tk['type'].isin({'CS', 'ADRC'})]
        tickers = tk.copy()
        if 'price' not in tickers.columns:
            tickers['price'] = np.nan
        if 'name' not in tickers.columns:
            tickers['name'] = tickers['code']
        sectors = pd.DataFrame(columns=['code', 'sector', 'product', '출처'])
        ohlcv = ohlcv[ohlcv['code'].isin(set(tickers['code']))]
        print(f'  [미국] {ohlcv["code"].nunique():,}종목')
    else:
        s = config.load()
        ohlcv = sdata.load_ohlcv() if hasattr(sdata, 'load_ohlcv') else \
            pd.read_parquet(os.path.join(config.DATA_DIR, 'ohlcv.parquet'))
        tickers = pd.read_parquet(os.path.join(config.DATA_DIR, 'tickers.parquet'))
        sec_path = os.path.join(config.DATA_DIR, 'sectors.parquet')
        sectors = pd.read_parquet(sec_path) if os.path.exists(sec_path) else pd.DataFrame()

    ohlcv['date'] = pd.to_datetime(ohlcv['date'])
    days = np.array(sorted(ohlcv['date'].unique()))
    print(f'  일봉 {len(ohlcv):,}줄 · 거래일 {len(days)}일 '
          f'({pd.Timestamp(days[0]):%Y-%m-%d} ~ {pd.Timestamp(days[-1]):%Y-%m-%d})')

    # 되짚을 날들 — 맨 뒤에서 hold 만큼 떼고, step 간격으로 months 달치
    last_i = len(days) - 1 - a.hold
    first_i = max(250, last_i - a.months * 21)      # 250일은 200일선 계산에 필요
    points = list(range(first_i, last_i + 1, a.step))
    if not points:
        print('되짚을 날이 없습니다. --months 를 줄이거나 자료를 더 쌓으세요.'); return
    print(f'  되짚는 날 {len(points)}개 · 보유 {a.hold}거래일 · 상위 {a.top}종목\n')

    close_w = ohlcv.pivot_table(index='date', columns='code', values='close').ffill()

    # ── 시장 국면 ──────────────────────────────────────────────
    #   1차 결과에서 RS·자금흐름의 IC 가 음(-) 으로 나왔습니다.
    #   추세추종 지표가 음수로 나오는 건 보통 **하락장 구간만 봤을 때** 벌어집니다.
    #   그래서 시점마다 시장이 올랐는지 내렸는지 함께 재어, 국면을 나눠 봅니다.
    #   지수 자료가 따로 없으므로 **전 종목 중앙값 수익률**을 시장 대용으로 씁니다
    #   (평균은 몇몇 폭등주에 끌려다닙니다).
    def mkt_fwd(i):
        T, T2 = pd.Timestamp(days[i]), pd.Timestamp(days[i + a.hold])
        if T not in close_w.index or T2 not in close_w.index:
            return float('nan')
        return float((close_w.loc[T2] / close_w.loc[T] - 1).median())

    rows = []
    for n, i in enumerate(points, 1):
        T = pd.Timestamp(days[i])
        sub = ohlcv[ohlcv['date'] <= T]
        try:
            df = rules.screen(sub, tickers, sectors, s)
        except Exception as e:
            print(f'  [{n}/{len(points)}] {T:%Y-%m-%d} 건너뜀 — {e}')
            continue
        if df is None or df.empty:
            continue
        # 거래대금 비율은 screen() 이 안 만들어 주므로 여기서 만듭니다
        df['거래대금비'] = pd.to_numeric(df.get('거래대금'), errors='coerce') / \
            pd.to_numeric(df.get('거래대금20일'), errors='coerce').replace(0, np.nan)

        # ── 새 VCP 칸 붙이기 ────────────────────────────────────
        #  6개월치만 넘깁니다 — 전체를 넘기면 groupby 가 느립니다.
        try:
            recent = sub[sub['date'] > T - pd.Timedelta(days=300)]
            vf = vcp2.features(recent, codes=df['코드'].astype(str))
            if len(vf):
                for c in vcp2.COLS:
                    df[c] = df['코드'].astype(str).map(vf[c])
        except Exception as e:
            if n == 1:
                print(f'    (새 VCP 계산을 건너뜁니다 — {e})')

        need = df['통과개수'] >= (8 if a.pass_only else 6)
        d = df[need & df['부적합사유'].fillna('').eq('')].copy()
        if len(d) < 15:
            continue

        # 3개월 뒤 수익률
        T2 = pd.Timestamp(days[i + a.hold])
        if T not in close_w.index or T2 not in close_w.index:
            continue
        p0, p1 = close_w.loc[T], close_w.loc[T2]
        d['fwd'] = d['코드'].map(p1) / d['코드'].map(p0) - 1
        d = d[d['fwd'].notna()]
        if len(d) < 15:
            continue

        d['날짜'] = T
        d['시장'] = mkt_fwd(i)
        rows.append(d)
        print(f'  [{n}/{len(points)}] {T:%Y-%m-%d}  후보 {len(d):4d}종목 · '
              f'평균 {d["fwd"].mean()*100:+6.2f}% · 시장 {d["시장"].iloc[0]*100:+6.2f}%',
              flush=True)

    if not rows:
        print('\n쓸 만한 날이 없었습니다.'); return
    A = pd.concat(rows, ignore_index=True)
    nT = A['날짜'].nunique()
    ind = max(1, round(nT * a.step / a.hold))       # 겹치지 않는 구간이 몇 개인가
    up = A.groupby('날짜')['시장'].first()
    print(f'\n표본 {len(A):,}건 · {nT}개 시점')
    print(f'  시장 수익률: 오른 시점 {(up > 0).sum()}개 · 내린 시점 {(up <= 0).sum()}개 '
          f'(중앙값 {up.median()*100:+.2f}%)')
    print(f'  보유 {a.hold}일 · 간격 {a.step}일 → 겹치지 않는 구간은 약 {ind}개')
    if ind < 8:
        print('  ⚠️ 겹치지 않는 구간이 8개 미만입니다. t값과 승률은 부풀려집니다.')
        print('     자료를 더 쌓거나 --months 를 늘려야 결론을 낼 수 있습니다.')
    if (up > 0).sum() == 0 or (up <= 0).sum() == 0:
        print('  ⚠️ 한쪽 국면만 들어 있습니다. 추세추종 지표(RS·자금흐름)의 부호가')
        print('     그 국면 때문에 뒤집힐 수 있으니 아래 국면별 표를 꼭 함께 보세요.')
    print()

    # ── ① 항목별 예측력 (순위상관 IC) ─────────────────────────────
    print('═' * 68)
    print(' ① 항목별 예측력 — 그 항목만으로 줄 세웠을 때 3개월 뒤 수익률과 맞나')
    print('═' * 68)
    print(f'{"항목":<10}{"IC평균":>9}{"t값":>8}{"맞힌비율":>10}'
          f'{"상승장IC":>10}{"하락장IC":>10}{"상하위차":>10}')
    ics = {}
    for name, (col, sign, _) in FACTORS.items():
        if col not in A.columns:
            print(f'{name:<10}   (칸 없음: {col})'); continue
        per = []
        spread = []
        per_up, per_dn = [], []
        for T, g in A.groupby('날짜'):
            v = pd.to_numeric(g[col], errors='coerce') * sign
            ok = v.notna() & g['fwd'].notna()
            if ok.sum() < 15:
                continue
            _ic = v[ok].rank().corr(g['fwd'][ok].rank())
            per.append(_ic)
            (per_up if float(g['시장'].iloc[0]) > 0 else per_dn).append(_ic)
            q = v[ok].rank(pct=True)
            hi = g['fwd'][ok][q >= 0.8].mean()
            lo = g['fwd'][ok][q <= 0.2].mean()
            spread.append((hi, lo))
        if not per:
            continue
        per = np.array(per, dtype=float)
        per = per[np.isfinite(per)]
        ics[name] = per
        t = per.mean() / (per.std(ddof=1) / np.sqrt(len(per))) if len(per) > 1 and per.std(ddof=1) > 0 else float('nan')
        hi = np.nanmean([x[0] for x in spread]); lo = np.nanmean([x[1] for x in spread])
        fu = f'{np.nanmean(per_up):+.3f}' if per_up else '   —'
        fd = f'{np.nanmean(per_dn):+.3f}' if per_dn else '   —'
        print(f'{name:<10}{per.mean():>+9.3f}{t:>8.2f}{(per > 0).mean()*100:>9.0f}%'
              f'{fu:>10}{fd:>10}{(hi-lo)*100:>+9.1f}%p')
    print('\n  IC = 순위상관. 0.03 넘으면 쓸 만하고, 0.05 넘으면 좋은 축입니다.')
    print('  t값 2 이상이면 "우연이 아니다" 로 봅니다. 맞힌비율은 IC가 +였던 시점의 비율.')
    print('  ★ 상승장IC / 하락장IC — 시장이 오른 시점과 내린 시점을 갈라 다시 잰 값입니다.')
    print('    추세추종 지표(RS·자금)는 하락장에서 음(-) 이 나오는 것이 정상입니다.')
    print('    **두 국면 모두에서 + 인 항목만** 배점을 올릴 값어치가 있습니다.')

    # ── ①-2 8조건 하나하나의 예측력 ──────────────────────────────
    #  Jun 제안은 '조건 하나당 -1.5 균등' 입니다. 조건들이 정말 동등한지,
    #  그리고 서로 겹치지 않는지 여기서 확인합니다.
    CONDS8 = [c for c in ('c1','c2','c3','c4','c5','c6','c7','c8') if c in A.columns]
    if CONDS8:
        print('\n' + '═' * 68)
        print(' ①-2 8조건 하나하나는 얼마나 값어치가 있나 (Jun 제안 검증)')
        print('═' * 68)
        LAB = {'c1':'①현재가>150·200일선','c2':'②150일선>200일선','c3':'③200일선 상승중',
               'c4':'④50일선>150·200일선','c5':'⑤현재가>50일선','c6':'⑥저점대비+30%↑',
               'c7':'⑦고점대비-25%이내','c8':'⑧RS 70↑'}
        print(f'{"조건":<20}{"IC평균":>9}{"t값":>8}{"채운비율":>10}{"채운쪽-못채운쪽":>16}')
        for c in CONDS8:
            per, gaps = [], []
            for T, g in A.groupby('날짜'):
                v = pd.to_numeric(g[c], errors='coerce').astype(float)
                ok = v.notna() & g['fwd'].notna()
                if ok.sum() < 15 or v[ok].nunique() < 2:
                    continue
                per.append(v[ok].rank().corr(g['fwd'][ok].rank()))
                gaps.append(g['fwd'][ok][v[ok] > 0].mean() - g['fwd'][ok][v[ok] == 0].mean())
            if not per:
                print(f'{LAB.get(c,c):<20}   (거의 모두 같은 값 — 잴 수 없음)')
                continue
            pa = np.array(per, dtype=float); pa = pa[np.isfinite(pa)]
            t = pa.mean()/(pa.std(ddof=1)/np.sqrt(len(pa))) if len(pa) > 1 and pa.std(ddof=1) > 0 else float('nan')
            rate = pd.to_numeric(A[c], errors='coerce').astype(float).mean()
            print(f'{LAB.get(c,c):<20}{pa.mean():>+9.3f}{t:>8.2f}{rate*100:>9.0f}%'
                  f'{np.nanmean(gaps)*100:>+15.1f}%p')
        print('\n  → IC 가 조건마다 크게 다르면 **하나당 -1.5 균등**은 근거가 없습니다.')
        print('    조건 사이 상관도 함께 봅니다 (높으면 같은 사실을 여러 번 깎는 셈):')
        cm = A[CONDS8].apply(pd.to_numeric, errors='coerce').corr()
        hi = [(cm.index[i], cm.columns[j], cm.iat[i, j])
              for i in range(len(cm)) for j in range(i+1, len(cm)) if abs(cm.iat[i, j]) >= 0.5]
        if hi:
            for a1, b1, v1 in sorted(hi, key=lambda x: -abs(x[2]))[:8]:
                print(f'      {LAB.get(a1,a1)} ↔ {LAB.get(b1,b1)} : {v1:+.2f}')
        else:
            print('      0.5 이상 겹치는 짝이 없습니다 — 균등 감점이 무난합니다.')

    # ── ② 거래량과 거래대금이 겹치나 ─────────────────────────────
    if '최근거래량_비율' in A.columns and '거래대금비' in A.columns:
        c = A[['최근거래량_비율', '거래대금비']].apply(pd.to_numeric, errors='coerce')
        r = c.corr(method='spearman').iloc[0, 1]
        print('\n' + '═' * 68)
        print(' ② 거래량 증가와 거래대금 증가가 서로 다른 이야기인가')
        print('═' * 68)
        print(f'  두 값의 순위상관 = {r:+.3f}')
        if r > 0.9:
            print('  → 사실상 **같은 값**입니다. 둘 다에 배점을 주면 한 가지에 두 배를 주는 셈입니다.')
        elif r > 0.7:
            print('  → 많이 겹칩니다. 둘 다 넣더라도 한쪽 배점은 낮춰야 합니다.')
        else:
            print('  → 겹치지 않습니다. 둘 다 따로 값어치가 있을 수 있습니다.')

    # ── ②-2 주요 항목끼리 겹치나 ─────────────────────────────────
    #  겹치는 두 항목에 배점을 나눠 주면 한 가지에 두 배를 주는 셈입니다.
    KEY = ['고점대비', '베이스깊이', '수축개수', '직전고점대비', '수축비',
           '통과개수', '막수축깊이', 'RS']
    KEY = [c for c in KEY if c in A.columns]
    if len(KEY) >= 2:
        print('\n' + '═' * 68)
        print(' ②-2 주요 항목끼리 겹치나 (0.7 넘으면 한쪽만 쓰세요)')
        print('═' * 68)
        cm = A[KEY].apply(pd.to_numeric, errors='coerce').corr(method='spearman')
        pairs = [(cm.index[x], cm.columns[y], cm.iat[x, y])
                 for x in range(len(cm)) for y in range(x + 1, len(cm))]
        for a1, b1, v1 in sorted(pairs, key=lambda z: -abs(z[2]))[:10]:
            mark = '  ← 겹침' if abs(v1) >= 0.7 else ('  (조금 겹침)' if abs(v1) >= 0.5 else '')
            print(f'  {a1:<12} ↔ {b1:<12} {v1:+.3f}{mark}')

    # ── ③ 배점안끼리 견주기 ──────────────────────────────────────
    print('\n' + '═' * 68)
    print(f' ③ 배점안 견주기 — 매달 상위 {a.top}종목을 사서 {a.hold}거래일 들고 갔다면')
    print('═' * 68)
    print(f'{"배점안":<12}{"평균수익":>10}{"중앙값":>10}{"이긴달":>9}{"최악":>10}{"전체평균대비":>14}')
    base_all = A.groupby('날짜')['fwd'].mean()
    res = {}
    for nm, w in SCHEMES.items():
        picks = []
        for T, g in A.groupby('날짜'):
            sc = pd.Series(0.0, index=g.index)
            for f, wt in w.items():
                if wt == 0:
                    continue
                col, sign, _ = FACTORS[f]
                if col not in g.columns:
                    continue
                sc = sc + wt * zscore(g[col] * sign)
            top = g.loc[sc.nlargest(min(a.top, len(g))).index]
            picks.append(top['fwd'].mean())
        p = pd.Series(picks, index=base_all.index[:len(picks)])
        res[nm] = p
        edge = (p - base_all.reindex(p.index)).mean()
        print(f'{nm:<12}{p.mean()*100:>+9.2f}%{p.median()*100:>+9.2f}%'
              f'{(p > 0).mean()*100:>8.0f}%{p.min()*100:>+9.1f}%{edge*100:>+13.2f}%p')
    print(f'{"(통과 전체)":<12}{base_all.mean()*100:>+9.2f}%{base_all.median()*100:>+9.2f}%'
          f'{(base_all > 0).mean()*100:>8.0f}%{base_all.min()*100:>+9.1f}%{0:>13.2f}%p')

    # 안끼리 직접 대결
    print('\n  ── 달마다 어느 안이 이겼나 ──')
    names = list(res)
    for i in range(len(names)):
        for j in range(i + 1, len(names)):
            a1, b1 = res[names[i]], res[names[j]]
            k = a1.index.intersection(b1.index)
            win = (a1[k] > b1[k]).mean() * 100
            d = (a1[k] - b1[k]).mean() * 100
            print(f'    {names[i]} vs {names[j]}: {names[i]} 승률 {win:.0f}% · 평균 차 {d:+.2f}%p')

    print('\n' + '═' * 68)
    print(' 읽는 법')
    print('═' * 68)
    print('  · ①에서 거래량·거래대금의 IC 가 0.02 도 안 되면 → 배점을 줄 이유가 없습니다.')
    print('  · ②의 상관이 0.9 를 넘으면 → 둘 중 하나만 쓰세요.')
    print('  · ③에서 안들의 차이가 1%p 도 안 되고 승률이 50% 근처면')
    print('    → 어느 안을 써도 사실상 같습니다. 그때는 단순한 쪽(현행)이 낫습니다.')
    print('  · ⚠️ EPS·매출은 과거 값이 없어 빠져 있습니다. 거래량이 실적보다')
    print('       위냐 아래냐는 이 결과로 정할 수 없습니다.')
    print('  · ⚠️ 상장폐지 종목이 빠져 있어 수익률은 실제보다 좋게 나옵니다.')


if __name__ == '__main__':
    main()
