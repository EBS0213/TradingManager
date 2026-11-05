# -*- coding: utf-8 -*-
"""인터넷 없이 로직만 검증하기 위한 가짜 시세 생성기."""
from __future__ import annotations
import numpy as np
import pandas as pd


def build(n_days: int = 400, seed: int = 7):
    """
    4가지 성격의 종목을 만들어 8조건 판정이 의도대로 되는지 확인합니다.
      · 완벽상승 : 8개 전부 통과해야 함
      · 약한상승 : 50일선 아래 → ⑤ 탈락
      · 하락    : 대부분 탈락
      · 바닥권   : ⑥(저점 +30%) 탈락
    """
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range(end=pd.Timestamp.today().normalize(), periods=n_days)
    t = np.arange(n_days)

    def series(kind):
        noise = rng.normal(0, 0.008, n_days).cumsum()
        if kind == '완벽상승':
            base = np.linspace(0, 1.1, n_days)
        elif kind == '약한상승':
            base = np.linspace(0, 0.9, n_days) - np.maximum(0, (t - n_days + 30)) * 0.012
        elif kind == '하락':
            base = np.linspace(0.9, 0, n_days)
        else:  # 바닥권
            base = np.concatenate([np.linspace(1.0, 0, n_days - 40),
                                   np.linspace(0, 0.08, 40)])
        return 10000 * np.exp(base + noise)

    kinds = ['완벽상승'] * 12 + ['약한상승'] * 12 + ['하락'] * 12 + ['바닥권'] * 12
    rows, meta = [], []
    for i, kind in enumerate(kinds):
        code = f'{900000 + i:06d}'
        close = series(kind)
        high = close * (1 + rng.uniform(0.001, 0.02, n_days))
        low = close * (1 - rng.uniform(0.001, 0.02, n_days))
        vol = rng.integers(200_000, 900_000, n_days)
        rows.append(pd.DataFrame({
            'date': dates, 'code': code,
            'open': close * (1 + rng.normal(0, 0.004, n_days)),
            'high': high, 'low': low, 'close': close,
            'volume': vol, 'value': close * vol}))
        meta.append({'code': code, 'name': f'{kind}{i % 12 + 1:02d}',
                     'market': 'KOSPI' if i % 2 else 'KOSDAQ',
                     'marcap': int(close[-1] * 10_000_000)})

    ohlcv = pd.concat(rows, ignore_index=True)
    tickers = pd.DataFrame(meta)
    sectors = pd.DataFrame({
        'code': tickers['code'],
        'sector': ['반도체', '2차전지', '바이오', '기계'] * (len(tickers) // 4)})
    return ohlcv, tickers, sectors
