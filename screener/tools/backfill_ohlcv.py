#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
과거 일봉을 채워 넣습니다 — 백테스트용 (2026-08-30)
====================================================================
왜 필요한가
  data/ohlcv.parquet 에 426거래일(2024-11-27~)밖에 없습니다.
  평소 화면을 그리는 데는 넉넉하지만, **배점을 검증하기엔 턱없이 짧습니다.**

    426일 - 250일(200일선 계산에 필요) - 63일(3개월 보유분) = 113일
    → 되짚을 수 있는 시작일이 7개월치뿐입니다.
      간격을 아무리 좁혀도 같은 구간을 여러 번 다시 보는 것이라
      표본이 늘지 않습니다. 그 7개월이 하락장이었다면
      RS·자금흐름 같은 추세추종 지표는 전부 음(-) 으로 나옵니다.

왜 지금까지 안 했나
  data.update_ohlcv(days=400) 이 '오늘 - 640일' 부터 받게 되어 있었습니다.
  그냥 그렇게 정해 놓았을 뿐, 막는 것은 없었습니다.

비용이 거의 없습니다
  이 소스는 **종목당 요청 한 번에 기간 전체**를 돌려줍니다.
  1.7년을 받든 8년을 받든 **요청 횟수가 같습니다.** 응답이 커질 뿐입니다.
  → 처음 수집과 비슷한 10~30분이면 끝납니다.

무엇을 하나
  1. 지금 있는 ohlcv.parquet 을 그대로 백업합니다 (되돌릴 수 있게).
  2. 지금 자료의 **가장 이른 날 앞쪽**만 새로 받습니다 (겹치는 구간은 안 받습니다).
  3. 이어 붙이고, 같은 (종목·날짜) 가 겹치면 **원래 있던 것**을 남깁니다.
  4. 저장합니다. 화면·스크리닝 동작은 그대로입니다 — 자료가 길어질 뿐입니다.

  ⚠️ 채울 수 없는 것 — **상장폐지된 종목**입니다.
     tickers.parquet 은 '지금 상장된 종목' 목록이라, 그 사이 사라진 회사는
     애초에 목록에 없습니다(생존 편향). 과거를 길게 채울수록 이 편향은
     오히려 커집니다. 백테스트 수익률의 **절대값**은 계속 믿지 마세요.
     배점안끼리 견주는 데는 영향이 작습니다.

쓰는 법
    cd ~/minervini
    .venv/bin/python tools/backfill_ohlcv.py                  # 2018-01-01 부터
    .venv/bin/python tools/backfill_ohlcv.py --from 2015-01-01
    .venv/bin/python tools/backfill_ohlcv.py --dry            # 계획만 보고 안 받기
"""
from __future__ import annotations
import os
import sys
import time
import argparse
import datetime as dt
import concurrent.futures as cf
import warnings
import pandas as pd

warnings.filterwarnings('ignore')
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from screener import config, data as sdata      # noqa: E402

CACHE = os.path.join(config.DATA_DIR, 'ohlcv.parquet')
COLS = ['date', 'open', 'high', 'low', 'close', 'volume', 'value', 'code']


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--from', dest='frm', default='2018-01-01',
                    help='언제부터 채울까 (기본 2018-01-01)')
    ap.add_argument('--dry', action='store_true', help='계획만 보고 받지는 않기')
    ap.add_argument('--workers', type=int, default=0, help='동시 접속 수 (0이면 설정값)')
    a = ap.parse_args()

    if not os.path.exists(CACHE):
        print(f'[오류] {CACHE} 가 없습니다. 먼저 run.py 를 한 번 돌리세요.')
        return

    s = config.load()
    have = pd.read_parquet(CACHE)
    have['date'] = pd.to_datetime(have['date'])
    codes = sorted(have['code'].astype(str).unique())
    first = have['date'].min().date()
    last = have['date'].max().date()

    start = dt.date.fromisoformat(a.frm)
    end = first - dt.timedelta(days=1)          # 겹치는 구간은 다시 안 받습니다

    print('═' * 62)
    print(' 과거 일봉 채우기')
    print('═' * 62)
    print(f'  지금 있는 것 : {len(have):,}줄 · {len(codes):,}종목 · {first} ~ {last}')
    print(f'  받을 구간    : {start} ~ {end}')
    if end <= start:
        print('  → 이미 그 앞까지 다 있습니다. 할 일이 없습니다.')
        return
    print(f'  요청 횟수    : {len(codes):,}번 (종목당 한 번 — 기간이 길어도 늘지 않습니다)')
    print(f'  예상 시간    : 10~30분')
    if a.dry:
        print('\n  --dry 라서 여기서 멈춥니다.')
        return

    # 1) 백업 — 되돌릴 수 있게
    bak = CACHE.replace('.parquet', f'_backup_{dt.date.today():%Y%m%d}.parquet')
    if not os.path.exists(bak):
        have.to_parquet(bak, index=False)
        print(f'\n  백업해 두었습니다 → {os.path.basename(bak)}')
        print('  잘못되면 이 파일을 ohlcv.parquet 으로 되돌리면 됩니다.')

    # 2) 앞쪽 받기
    src = sdata.source(s, verbose=True)
    workers = a.workers or s.max_workers
    print(f'\n  받는 중 (동시 {workers}개)…')
    done = fail = 0
    chunks = []
    t0 = time.time()

    def one(code):
        try:
            return src.ohlcv(code, start, end)
        except Exception:
            return None

    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        for df in ex.map(one, codes):
            done += 1
            if df is None or len(df) == 0:
                fail += 1
            else:
                chunks.append(df)
            if done % 200 == 0:
                sec = time.time() - t0
                남 = (len(codes) - done) * sec / max(done, 1)
                print(f'    {done:,}/{len(codes):,}  ({sec/60:.1f}분 지남 · '
                      f'{남/60:.1f}분 남음 · 못받음 {fail})', flush=True)

    if not chunks:
        print('\n  [오류] 한 종목도 못 받았습니다. 자료 출처가 막혔을 수 있습니다.')
        print('         원본은 그대로 있습니다 — 아무것도 바뀌지 않았습니다.')
        return

    old = pd.concat(chunks, ignore_index=True)
    old['date'] = pd.to_datetime(old['date'])
    for c in COLS:
        if c not in old.columns:
            old[c] = pd.NA
    old = old[COLS]
    old['code'] = old['code'].astype(str)

    print(f'\n  새로 받은 것 : {len(old):,}줄 · {old["code"].nunique():,}종목')

    # 3) 이어 붙이기 — 겹치면 **원래 있던 것**을 남깁니다
    #    (지금 쓰고 있는 자료를 새로 받은 것으로 덮어쓰지 않기 위해서입니다)
    merged = pd.concat([old, have[COLS] if all(c in have.columns for c in COLS) else have],
                       ignore_index=True)
    merged['code'] = merged['code'].astype(str)
    before = len(merged)
    merged = merged.drop_duplicates(['code', 'date'], keep='last')
    merged = merged.sort_values(['code', 'date']).reset_index(drop=True)

    # 4) 저장 — 저장 전에 스스로 검사합니다
    나쁨 = []
    if len(merged) < len(have):
        나쁨.append('합친 것이 원래보다 줄었습니다')
    if merged['date'].max().date() < last:
        나쁨.append('마지막 날짜가 뒤로 밀렸습니다')
    if merged['code'].nunique() < have['code'].nunique():
        나쁨.append('종목 수가 줄었습니다')
    if 나쁨:
        print('\n  [멈춤] 이상해서 저장하지 않았습니다:')
        for x in 나쁨:
            print(f'          · {x}')
        print('          원본은 그대로입니다.')
        return

    merged.to_parquet(CACHE, index=False)
    days = merged['date'].nunique()
    print('═' * 62)
    print(f'  끝났습니다.  {len(merged):,}줄 · {merged["code"].nunique():,}종목')
    print(f'  거래일 {days}일 ({merged["date"].min():%Y-%m-%d} ~ {merged["date"].max():%Y-%m-%d})')
    print(f'  (겹쳐서 버린 줄 {before - len(merged):,} · 못 받은 종목 {fail})')
    print('═' * 62)
    print('  이제 백테스트를 다시 돌리면 됩니다:')
    print('    .venv/bin/python tools/backtest_weights.py --months 60')


if __name__ == '__main__':
    main()
