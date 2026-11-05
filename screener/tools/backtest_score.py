#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
점수 검증 — 과거 시점마다 전 종목 점수를 매기고, 그 뒤 실제 수익률과 비교합니다.

    .venv/bin/python tools/backtest_score.py us
    .venv/bin/python tools/backtest_score.py kr

무엇을 재나
  · 21거래일(약 한 달)마다 스냅샷을 찍어, 그 시점 자료만으로 점수를 계산
  · 20일·60일 뒤 실제 수익률을 점수 구간(85/75/65)과 십분위로 비교
  · 항목별 순위상관(IC) — 어느 항목이 실제로 일하는지

정직성을 위한 제약 — 반드시 알고 볼 것
  · 실적·수급은 뺍니다. 과거 시점의 실적을 복원할 수 없어서, 넣으면
    미래를 미리 아는 반칙(look-ahead)이 됩니다. 가격 항목만 씁니다.
    (배점은 가격 항목끼리 비율을 지켜 100점으로 다시 폅니다)
  · 생존 편향: 자료에 지금 상장된 종목만 있습니다. 그 사이 상장폐지된
    종목이 빠져 있어 결과가 실제보다 좋게 나옵니다.
  · 기간이 짧습니다(미국 2년 · 한국 1.7년) — 대체로 상승장 한 가지 장세입니다.
  · 하락의 질 감점은 뺐습니다(스냅샷일 하루에 좌우되는 값이라 잡음이 큽니다).
"""
from __future__ import annotations
import os
import sys

import numpy as np
import pandas as pd

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)

STEP = 21                 # 스냅샷 간격 (거래일)
FWD = (20, 60)            # 며칠 뒤 수익률을 볼지
WARMUP = 270              # 계산에 필요한 최소 이력 (252일 + 여유)

# 가격 항목 배점 — rules.py 와 같은 숫자. 실적·수급을 뺀 만큼 100 으로 폅니다.
W = {
    'us': {'RS': 27, 'HI': 16, 'VCP': 14, 'STAY': 13, 'UD': 10},
    'kr': {'RS': 26, 'HI': 13, 'VCP': 12, 'STAY': 8, 'UD': 7},
}
MIN_PX = {'us': 5.0, 'kr': 1000.0}
MIN_VAL = {'us': 2_000_000.0, 'kr': 600_000_000.0}


def log(m):
    print(m, flush=True)


def load(market: str) -> pd.DataFrame:
    if market == 'us':
        from screener import us_data
        return us_data.load(years=2.0)
    path = os.path.join(BASE, 'data', 'ohlcv.parquet')
    df = pd.read_parquet(path)
    df['date'] = pd.to_datetime(df['date'])
    return df


def wide(df, col):
    return df.pivot_table(index='date', columns='code', values=col,
                          aggfunc='last').astype('float32')


def main() -> int:
    market = (sys.argv[1] if len(sys.argv) > 1 else 'us').lower()
    if market not in ('us', 'kr'):
        print('usage: backtest_score.py us|kr')
        return 2
    w = W[market]
    scale = 100.0 / sum(w.values())

    log(f'[{market.upper()}] 자료를 읽습니다')
    raw = load(market)
    # 미국은 15,900종목이라 그대로 펴면 메모리가 빠듯합니다(서버 2GB).
    #  전 기간 평균 거래대금이 문턱의 3분의 1도 안 되는 종목은 어떤 스냅샷에서도
    #  뽑힐 수 없으니 미리 뺍니다 — 결과에는 영향이 없고 기억만 아낍니다.
    keep = raw.groupby('code')['value'].mean() if 'value' in raw.columns else None
    if keep is not None:
        alive = set(keep[keep >= MIN_VAL[market] / 3].index)
        raw = raw[raw['code'].isin(alive)]
        log(f'   사전 유동성 필터 뒤 {len(alive):,}종목')
    close = wide(raw, 'close'); high = wide(raw, 'high')
    low = wide(raw, 'low'); vol = wide(raw, 'volume')
    val = wide(raw, 'value') if 'value' in raw.columns else close * vol
    T = len(close)
    log(f'   {close.shape[1]:,}종목 × {T}거래일 '
        f'({close.index[0]:%Y-%m-%d} ~ {close.index[-1]:%Y-%m-%d})')
    if T < WARMUP + max(FWD) + STEP:
        log('   이력이 짧아 스냅샷을 만들 수 없습니다'); return 1

    c = close.ffill()
    log('이동평균·52주 고저·RS 를 전 기간에 대해 계산합니다')
    ma50 = c.rolling(50).mean(); ma150 = c.rolling(150).mean()
    ma200 = c.rolling(200).mean()
    hi252 = high.rolling(252).max(); lo252 = low.rolling(252).min()
    rs_raw = (0.4 * c.pct_change(63) + 0.2 * c.pct_change(126)
              + 0.2 * c.pct_change(189) + 0.2 * c.pct_change(252))
    rs = rs_raw.rank(axis=1, pct=True) * 98 + 1

    conds = ((c > ma150) & (c > ma200)).astype('int8') \
        + (ma150 > ma200).astype('int8') \
        + (ma200 > ma200.shift(20)).astype('int8') \
        + ((ma50 > ma150) & (ma50 > ma200)).astype('int8') \
        + (c > ma50).astype('int8') \
        + (c >= lo252 * 1.30).astype('int8') \
        + (c >= hi252 * 0.75).astype('int8') \
        + (rs >= 70).astype('int8')

    # 추세 지속 — 7개 이상을 며칠째 이어 왔나 (연속 일수).
    #  열마다 '끊긴 지점' 기준으로 묶어 세는 표준 요령인데, DataFrame 통째로는
    #  groupby 가 안 되므로 numpy 로 직접 셉니다.
    ok7 = (conds >= 7).to_numpy()
    st = np.zeros_like(ok7, dtype='int32')
    for i in range(1, len(ok7)):
        st[i] = np.where(ok7[i], st[i - 1] + 1, 0)
    streak = pd.DataFrame(st, index=conds.index, columns=conds.columns)

    snaps = list(range(WARMUP, T - max(FWD), STEP))
    log(f'스냅샷 {len(snaps)}개 — {STEP}거래일 간격')

    rows = []
    for t in snaps:
        px = c.iloc[t]
        liq = val.iloc[max(0, t - 19):t + 1].mean()
        eligible = (px >= MIN_PX[market]) & (liq >= MIN_VAL[market]) \
            & c.iloc[:t + 1].notna().sum().ge(WARMUP)
        idx = eligible[eligible].index
        if len(idx) < 50:
            continue

        # VCP 수축비 — 최근 40일을 3등분
        seg = 13
        h40 = high.iloc[t - 39:t + 1][idx]; l40 = low.iloc[t - 39:t + 1][idx]
        def rng(a, b):
            h = h40.iloc[a:b].max(); l = l40.iloc[a:b].min()
            return ((h - l) / h.replace(0, np.nan))
        w0, w2 = rng(0, seg), rng(2 * seg, 40)
        ratio = (w2 / w0.replace(0, np.nan))
        vcp = (1.0 - ratio) / 0.5
        vcp = vcp.clip(0, 1).fillna(0)

        # 자금흐름 UD — 최근 50일
        cc = c.iloc[t - 50:t + 1][idx]; vv = vol.iloc[t - 50:t + 1][idx]
        chg = cc.diff().iloc[1:]; v50 = vv.iloc[1:]
        up = v50.where(chg > 0).sum(); dn = v50.where(chg < 0).sum()
        ud = (up / dn.replace(0, np.nan))
        ud_pts = pd.Series(np.where(ud < 1.0, -0.2,
                           np.minimum(1.0, (ud - 1.0) / 0.2)), index=idx)
        ud_pts = ud_pts.where(ud.notna(), 0.4)

        rs_pts = ((rs.iloc[t][idx] - 70) / 20).clip(0, 1)
        hi_pts = ((c.iloc[t][idx] / hi252.iloc[t][idx] - 1 + 0.25) / 0.25).clip(0, 1)
        stay_pts = 0.35 + 0.65 * (streak.iloc[t][idx] / 40).clip(0, 1)

        score = (w['RS'] * rs_pts + w['HI'] * hi_pts + w['VCP'] * vcp
                 + w['STAY'] * stay_pts + w['UD'] * ud_pts) * scale

        snap = pd.DataFrame({
            '점수': score, '통과': conds.iloc[t][idx],
            'RS': rs_pts, 'HI': hi_pts, 'VCP': vcp, 'STAY': stay_pts, 'UD': ud_pts,
        })
        for f in FWD:
            snap[f'fwd{f}'] = (c.iloc[t + f][idx] / px[idx] - 1) * 100
        snap['t'] = t
        rows.append(snap)

    allr = pd.concat(rows)
    allr = allr[allr['fwd60'].notna()]
    log(f'\n표본 {len(allr):,} (종목×스냅샷) — 생존 편향·단일 장세 주의\n')

    def table(d, title):
        log(f'── {title} ({len(d):,}표본)')
        cut = pd.cut(d['점수'], [-1, 65, 75, 85, 999],
                     labels=['65↓', '65-75', '75-85', '85↑'])
        g = d.groupby(cut, observed=False)
        out = pd.DataFrame({
            '표본': g.size(),
            '20일평균%': g['fwd20'].mean().round(2),
            '20일중앙%': g['fwd20'].median().round(2),
            '60일평균%': g['fwd60'].mean().round(2),
            '60일중앙%': g['fwd60'].median().round(2),
        })
        log(out.to_string())
        log('')

    table(allr, '전 종목')
    table(allr[allr['통과'] >= 7], '7조건 이상 (실전 후보군)')

    log('── 항목별 순위상관 (스냅샷 평균 · +면 높을수록 수익이 좋았다는 뜻)')
    for f in FWD:
        ics = {}
        # 통과개수도 함께 잽니다 — "8조건에 가중치를 줘야 하나" 라는 질문에
        #  답하기 위해서입니다. 점수 IC 와 비슷하거나 낮으면 이미 점수에 녹아
        #  있다는 뜻이고(가중치 불필요), 점수보다 뚜렷이 높으면 다시 논의합니다.
        for k in ('점수', '통과', 'RS', 'HI', 'VCP', 'STAY', 'UD'):
            ic = allr.groupby('t', group_keys=False)[[k, f'fwd{f}']].apply(
                lambda x: x.iloc[:, 0].corr(x.iloc[:, 1], method='spearman'))
            ics[k] = ic.mean()
        line = ' · '.join(f'{k} {v:+.3f}' for k, v in ics.items())
        log(f'   {f}일 뒤: {line}')
    log('\n읽는 법: 점수 IC 가 +0.05 를 넘고 구간 표에서 85↑ > 75-85 > 65↓ 순서면')
    log('점수가 변별력이 있는 것입니다. 항목 IC 가 0 근처면 그 항목은 일을 안 하는 것.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
