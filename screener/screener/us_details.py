# -*- coding: utf-8 -*-
"""
종목 상세 — 시가총액 · SIC 업종코드 · 상장일.

왜 따로 받아야 하나
  일봉은 '날짜 하나 = 전 종목' 이라 500번이면 끝났습니다.
  그런데 시가총액과 업종은 **종목 하나씩** 물어봐야 합니다.
  발행주식수와 업종코드는 날짜별 시세에 안 들어 있기 때문입니다.

  다행히 이 둘은 한 번에 옵니다. 한 종목을 부르면
  market_cap 과 sic_code 가 같이 오므로 호출이 두 배가 되지 않습니다.

얼마나 걸리나
  분당 5회 제한이라 한 종목에 12초입니다.
  · 거래가 활발한 2,000종목만 받으면 약 7시간 (하룻밤이면 끝납니다)
  · 한 번 받아 두면 30일 동안 다시 묻지 않습니다
  · 시가총액은 주가가 움직이면 바뀌지만, 그건 매일 받는 종가에
    '받아둔 발행주식수' 를 곱해서 다시 계산합니다 — 그래서 매일 안 받아도 됩니다

  중간에 끊겨도 됩니다. 받은 것까지 저장해 두고 다음에 이어서 받습니다.
"""
from __future__ import annotations
import os
import time
import datetime as dt
import pandas as pd

from . import config
from .us_data import log, ROOT
import json
import subprocess
import shutil
SLEEP = 1.0
from .us_sectors import sector_of_sic, sector_of, big_of

DETAILS = os.path.join(config.DATA_DIR, 'us_details.parquet')
TTL_DAYS = 30

COLS = ['code', 'sic', 'sector', 'shares', 'marcap_at', 'marcap_ref',
        'list_date', 'got']


def load() -> pd.DataFrame:
    if os.path.exists(DETAILS):
        try:
            df = pd.read_parquet(DETAILS)
            for c in COLS:
                if c not in df.columns:
                    df[c] = None
            return df[COLS]
        except Exception:
            pass
    return pd.DataFrame(columns=COLS)


def _fetch_one(code: str) -> dict | None:
    result=subprocess.run([shutil.which('node') or 'node', 'scripts/equity-details.mjs',code],cwd=ROOT/'web',capture_output=True,text=True,timeout=30,check=True)
    r=json.loads(result.stdout)
    # 발행주식수는 두 가지가 옵니다.
    #  weighted_shares_outstanding = 전체 클래스 합계 (이쪽이 시가총액에 맞습니다)
    #  share_class_shares_outstanding = 이 주식 종류만
    shares = r.get('sharesOutstanding')
    sic = None
    return {
        'code': code,
        'sic': str(sic) if sic else None,
        'sector': sector_of(sic, code),      # 티커 손질표를 먼저 봅니다 (ADR)
        'shares': float(shares) if shares else None,
        'marcap_at': float(r['market_cap']) if r.get('market_cap') else None,
        'marcap_ref': None,          # 아래에서 '그때 주가' 를 넣습니다
        'list_date': r.get('list_date'),
        'got': dt.date.today().isoformat(),
    }


def update(codes, price_now: dict | None = None, limit: int | None = None,
           verbose: bool = True) -> pd.DataFrame:
    """
    codes 중 아직 안 받았거나 30일 지난 것만 받습니다.

    price_now 를 주면(종목→현재가) 받은 시점의 주가를 함께 적어 둡니다.
    나중에 시가총액을 다시 계산할 때 씁니다.
    """
    have = load()
    known = {}
    if len(have):
        for r in have.to_dict('records'):
            known[r['code']] = r

    fresh_until = (dt.date.today() - dt.timedelta(days=TTL_DAYS)).isoformat()
    todo = [c for c in codes
            if c not in known or str(known[c].get('got') or '') < fresh_until]
    if limit:
        todo = todo[:limit]

    if not todo:
        if verbose:
            log(f'상세 자료는 최신입니다 ({len(known):,}종목 보유)')
        return have

    hours = len(todo) * SLEEP / 3600
    if verbose:
        log(f'상세 자료 {len(todo):,}종목을 받습니다 — 약 {hours:.1f}시간')
        log('   (중간에 끊겨도 됩니다. 다시 실행하면 이어서 받습니다)')

    t0 = time.time()
    for i, code in enumerate(todo, 1):
        try:
            d = _fetch_one(code)
        except Exception as e:
            log(f'   · {code} 실패({e})')
            d = None
        if d:
            if price_now and price_now.get(code):
                d['marcap_ref'] = float(price_now[code])
            known[code] = d
        else:
            # 못 받은 종목도 기록해 둡니다 — 30일 동안 다시 묻지 않게
            known[code] = {'code': code, 'sic': None, 'sector': '기타',
                           'shares': None, 'marcap_at': None, 'marcap_ref': None,
                           'list_date': None, 'got': dt.date.today().isoformat()}

        if i % 25 == 0 or i == len(todo):
            pd.DataFrame(list(known.values()))[COLS].to_parquet(DETAILS, index=False)
            if verbose:
                sec = time.time() - t0
                eta = sec / i * (len(todo) - i) / 60
                ok = sum(1 for v in known.values() if v.get('shares'))
                log(f'   ... {i:,}/{len(todo):,} (남은 시간 약 {eta:.0f}분) '
                    f'· 시총 확보 {ok:,}종목')
        time.sleep(SLEEP)

    out = pd.DataFrame(list(known.values()))[COLS]
    out.to_parquet(DETAILS, index=False)
    if verbose:
        log(f'상세 자료 {len(out):,}종목 저장')
    return out


def with_marcap(det: pd.DataFrame, price_now: dict) -> pd.DataFrame:
    """
    오늘 주가로 시가총액을 다시 계산합니다.

    받아 둔 시가총액(marcap_at)은 '받은 날' 기준이라 시간이 지나면 어긋납니다.
    발행주식수는 잘 안 바뀌므로 오늘 종가 × 발행주식수 로 다시 셈합니다.
    발행주식수를 못 받은 종목은 받아 둔 값을 그대로 씁니다.
    """
    d = det.copy()
    px = pd.Series(price_now, dtype='float64')
    d['현재가'] = d['code'].map(px)
    calc = d['shares'] * d['현재가']
    d['marcap'] = calc.where(calc.notna() & (calc > 0), d['marcap_at'])

    # ── 업종을 여기서 **다시** 매깁니다 (2026-08-30) ──────────────
    #  왜 받을 때만 하지 않고 읽을 때도 하나:
    #    이 파일은 종목 상세를 30일 동안 담아 둡니다. 티커 손질표(ADR·오분류)를
    #    새로 고쳐도, 이미 담긴 종목은 30일이 지나야 다시 받습니다.
    #    읽을 때 한 번 더 매기면 **다시 받지 않아도 오늘 바로** 반영됩니다.
    #    (셈이 가벼워서 값이 거의 안 듭니다 — 표에서 찾아보는 것뿐입니다)
    d['sector'] = [sector_of(sic, code) for sic, code in zip(d['sic'], d['code'])]
    d['대분류'] = d['sector'].map(big_of)
    return d[['code', 'sector', '대분류', 'sic', 'marcap', 'shares', 'list_date']]
