# -*- coding: utf-8 -*-
"""
되돌림 기반 VCP (2026-08-30)
====================================================================
지금 쓰는 방식의 문제
  최근 8주를 **달력으로 3등분**해 변동폭이 줄었는지만 봅니다. 그래서
    ① 진짜 수축은 달력이 아니라 '되돌림 한 번' 단위입니다.
       첫 수축은 4주, 마지막은 3일이기도 합니다 — 13일씩 자르면 뭉개집니다.
    ② 베이스 길이가 8주로 고정입니다. 실제로는 5주~반년입니다.
    ③ **직전 상승을 요구하지 않습니다.** 오래 내린 뒤 옆으로 죽은 종목은
       변동폭이 당연히 줄어, 지금 코드에서 만점을 받습니다.
       미너비니의 VCP 는 **큰 상승 뒤의 소화 과정**입니다.
    ④ 거래량이 판정에 안 들어갑니다.

이 파일이 하는 일
  가격 움직임으로 구간을 나눕니다(지그재그). rev(기본 3%) 이상 되돌리면
  수축 하나로 셉니다. 그 수축들의 깊이·기간·거래량을 재서 칸으로 돌려줍니다.

  ⚠️ **판정하지 않습니다.** 숫자만 만들어 놓고, 이 값들이 실제로 예측력이
     있는지는 백테스트가 답합니다. 지금 수축비(IC +0.030) 를 못 넘으면
     갈아끼울 이유가 없습니다.

돌려주는 칸
  수축개수      되돌림을 몇 번 했나 (미너비니의 'T' 수, 보통 2~6)
  첫수축깊이    첫 되돌림의 깊이 (0.24 = 24%)
  막수축깊이    마지막 되돌림의 깊이
  깊이감소비    막수축깊이 ÷ 첫수축깊이 (작을수록 잘 조여듦, 0.5 이하가 교과서)
  깊이단조      뒤로 갈수록 계속 얕아졌나 (1/0)
  기간단조      뒤로 갈수록 계속 짧아졌나 (1/0)
  막수축거래량  마지막 수축 구간 평균거래량 ÷ 베이스 전체 평균 (낮을수록 마름)
  베이스깊이    베이스 고점에서 가장 깊이 내린 폭
  베이스길이    베이스 고점 이후 며칠 지났나
  직전상승      베이스가 시작되기 전 얼마나 올랐나 (미너비니는 30%↑ 를 봅니다)
"""
from __future__ import annotations
import numpy as np
import pandas as pd

COLS = ['수축개수', '첫수축깊이', '막수축깊이', '깊이감소비', '깊이단조',
        '기간단조', '막수축거래량', '베이스깊이', '베이스길이', '직전상승']


def _zigzag(h: np.ndarray, l: np.ndarray, rev: float):
    """
    고점·저점을 번갈아 찾습니다.

    rev 만큼 되돌리면 '방향이 바뀌었다' 고 보고 그 직전 끝점을 찍습니다.
    (h, l 은 같은 길이의 고가·저가 배열입니다.)

    돌려주는 값: [(자리, 값, 'H' 또는 'L'), …] — 시간 순
    """
    n = len(h)
    if n < 10:
        return []
    piv = []
    mx_i, mx = 0, h[0]
    mn_i, mn = 0, l[0]
    dirn = 0                      # 0 아직 모름 · +1 오르는 중 · -1 내리는 중
    for i in range(1, n):
        if h[i] > mx:
            mx, mx_i = h[i], i
        if l[i] < mn:
            mn, mn_i = l[i], i
        if dirn >= 0 and mx > 0 and l[i] <= mx * (1.0 - rev):
            piv.append((mx_i, mx, 'H'))
            dirn = -1
            mn, mn_i = l[i], i
        elif dirn <= 0 and mn > 0 and h[i] >= mn * (1.0 + rev):
            piv.append((mn_i, mn, 'L'))
            dirn = 1
            mx, mx_i = h[i], i
    return piv


def _one(h, l, v, rev: float) -> dict:
    out = {c: np.nan for c in COLS}
    n = len(h)
    if n < 40:
        return out

    piv = _zigzag(h, l, rev)
    if len(piv) < 2:
        return out

    # ── 베이스의 왼쪽 벽 = 구간 안에서 가장 높은 고점 ──────────────
    #  미너비니의 베이스는 '고점을 찍고 나서' 시작됩니다.
    hi_i = int(np.argmax(h))
    base_hi = float(h[hi_i])
    if base_hi <= 0 or hi_i >= n - 5:
        return out                       # 고점이 맨 끝이면 아직 베이스가 없습니다

    # ── 수축들 — 베이스 고점 이후의 (고점 → 저점) 쌍 ───────────────
    after = [p for p in piv if p[0] >= hi_i]
    # 베이스 고점 자체가 첫 H 가 되도록 앞에 붙입니다
    if not after or after[0][2] != 'H':
        after = [(hi_i, base_hi, 'H')] + after

    depths, spans = [], []
    for k in range(len(after) - 1):
        a, b = after[k], after[k + 1]
        if a[2] == 'H' and b[2] == 'L' and a[1] > 0:
            depths.append((a[1] - b[1]) / a[1])
            spans.append(b[0] - a[0])

    # 아직 진행 중인 마지막 되돌림 (고점은 찍었는데 저점은 안 찍힌 상태)
    if after and after[-1][2] == 'H':
        j = after[-1][0]
        if j < n - 1:
            lo = float(np.min(l[j:]))
            if after[-1][1] > 0:
                depths.append((after[-1][1] - lo) / after[-1][1])
                spans.append(n - 1 - j)

    # 너무 얕은 되돌림은 수축으로 세지 않습니다 — 잔파동입니다
    keep = [(x, y) for x, y in zip(depths, spans) if x >= rev * 0.8]
    if not keep:
        return out
    depths = [x for x, _ in keep]
    spans = [y for _, y in keep]

    d = np.array(depths, dtype=float)
    sp = np.array(spans, dtype=float)
    out['수축개수'] = float(len(d))
    out['첫수축깊이'] = float(d[0])
    out['막수축깊이'] = float(d[-1])
    out['깊이감소비'] = float(d[-1] / d[0]) if d[0] > 0 else np.nan
    out['깊이단조'] = float(bool(np.all(np.diff(d) < 0))) if len(d) > 1 else np.nan
    out['기간단조'] = float(bool(np.all(np.diff(sp) <= 0))) if len(sp) > 1 else np.nan

    # ── 거래량이 같이 말랐나 ──────────────────────────────────────
    #  변동폭만 줄고 거래량이 그대로면 조여든 것이 아니라
    #  그냥 매물이 소화되지 않은 것입니다.
    last_len = int(max(3, min(sp[-1] if len(sp) else 5, n - hi_i)))
    base_v = float(np.nanmean(v[hi_i:])) if n - hi_i >= 5 else np.nan
    last_v = float(np.nanmean(v[-last_len:]))
    out['막수축거래량'] = (last_v / base_v) if base_v and base_v > 0 else np.nan

    # ── 베이스 자체의 모양 ────────────────────────────────────────
    out['베이스깊이'] = float((base_hi - np.min(l[hi_i:])) / base_hi)
    out['베이스길이'] = float(n - 1 - hi_i)

    # ── 직전 상승 — 이게 없으면 VCP 가 아니라 그냥 죽은 종목입니다 ──
    if hi_i >= 20:
        prev_lo = float(np.min(l[:hi_i]))
        out['직전상승'] = (base_hi / prev_lo - 1.0) if prev_lo > 0 else np.nan
    return out


def features(ohlcv: pd.DataFrame, codes=None, lookback: int = 130,
             rev: float = 0.06) -> pd.DataFrame:
    """
    종목마다 위 칸들을 계산해 표로 돌려줍니다 (index = 코드).

      ohlcv    date · code · high · low · volume 이 있는 표 (T 까지 잘린 것)
      lookback 몇 거래일을 볼까 (기본 130 ≈ 6개월)
      rev      몇 % 되돌리면 수축 하나로 셀까 (기본 6%)
               ⚠️ 3% 로 두면 잔파동까지 세서 한 베이스에 수축이 30개 넘게 나옵니다.
                  미너비니가 세는 수축(T)은 보통 2~6개입니다. 6% 가 그 근처입니다.
    """
    df = ohlcv
    if codes is not None:
        df = df[df['code'].astype(str).isin(set(map(str, codes)))]
    if not len(df):
        return pd.DataFrame(columns=COLS)

    df = df.sort_values(['code', 'date'])
    rows, idx = [], []
    for code, g in df.groupby('code', sort=False):
        g = g.tail(lookback)
        if len(g) < 40:
            continue
        rows.append(_one(g['high'].to_numpy(dtype=float),
                         g['low'].to_numpy(dtype=float),
                         g['volume'].to_numpy(dtype=float), rev))
        idx.append(str(code))
    if not rows:
        return pd.DataFrame(columns=COLS)
    return pd.DataFrame(rows, index=idx)[COLS]
