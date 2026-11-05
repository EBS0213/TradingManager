# -*- coding: utf-8 -*-
"""
주가 데이터 수집.

· 종목 목록과 업종은 3~7일에 한 번만 새로 받습니다.
· 일봉은 data/ohlcv.parquet 에 쌓아 두고, 다음 실행부터는 최근 며칠치만 채웁니다.
· 종목별로 요청하므로 첫 실행은 10~25분 걸립니다. 두 번째부터는 3~6분입니다.
"""
from __future__ import annotations
import os
import time
import datetime as dt
import concurrent.futures as cf
import pandas as pd

from . import config
from .sources import pick

CACHE = os.path.join(config.DATA_DIR, 'ohlcv.parquet')
META = os.path.join(config.DATA_DIR, 'tickers.parquet')
SECTOR = os.path.join(config.DATA_DIR, 'sectors.parquet')

_SRC = None


def source(s, verbose=True):
    global _SRC
    if _SRC is None:
        _SRC = pick(getattr(s, 'data_source', 'auto'), s.request_delay, verbose)
    return _SRC


# ─────────────────────────── 종목 목록 & 업종 ───────────────────────────
def load_tickers(s, refresh_days: int = 3, verbose=True) -> pd.DataFrame:
    if os.path.exists(META) and time.time() - os.path.getmtime(META) < refresh_days * 86400:
        df = pd.read_parquet(META)
        if len(df):
            return df
    if verbose:
        print('[데이터] 전 종목 목록을 받습니다...')
    df = source(s, verbose).list_stocks(s.markets, verbose)
    if len(df) == 0:
        raise SystemExit(
            '\n[오류] 종목 목록을 하나도 받지 못했습니다.\n'
            '       인터넷은 되는데 이 오류가 난다면 데이터 사이트 구조가 바뀐 것입니다.\n'
            '       "진단.command" 를 더블클릭해서 나온 내용을 알려주세요.\n')
    df.to_parquet(META, index=False)
    return df


def load_sectors(s, refresh_days: int = 7, verbose=True) -> pd.DataFrame:
    """
    업종 분류.
      · krx   — 한국거래소 KIND 상장법인목록 (통계청 표준산업분류 KSIC). 기본값·권장
      · naver — 네이버 금융 업종 (FnGuide 계열, 테마성)
      · both  — KRX 를 쓰되 빠진 종목만 네이버로 채움
    """
    if os.path.exists(SECTOR) and time.time() - os.path.getmtime(SECTOR) < refresh_days * 86400:
        cached = pd.read_parquet(SECTOR)
        if len(cached):
            return cached

    mode = getattr(s, 'sector_source', 'krx')
    from .sources import Naver, KrxIndustry
    krx = pd.DataFrame(columns=['code', 'sector', 'product'])
    nav = pd.DataFrame(columns=['code', 'sector'])

    if mode in ('krx', 'both'):
        if verbose:
            print('[데이터] KRX 표준산업분류 업종을 받습니다...')
        try:
            krx = KrxIndustry(s.request_delay * 2).sector_map(s.markets, verbose)
        except Exception as e:
            print(f'[안내] KRX 업종을 못 받았습니다({e}).')

    need_naver = mode == 'naver' or (mode == 'both') or (mode == 'krx' and len(krx) == 0)
    if need_naver:
        if verbose:
            print('[데이터] 네이버 업종을 받습니다...')
        try:
            nav = Naver(s.request_delay).sector_map(verbose)
        except Exception as e:
            print(f'[안내] 네이버 업종을 못 받았습니다({e}).')

    if len(krx):
        df = krx.copy()
        df['출처'] = 'KRX'
        if len(nav):                      # KRX에 없는 종목만 네이버로 보충
            miss = nav[~nav['code'].isin(set(df['code']))].copy()
            miss['product'] = ''
            miss['출처'] = '네이버'
            df = pd.concat([df, miss], ignore_index=True)
            if verbose and len(miss):
                print(f'   KRX에 없는 {len(miss):,}종목은 네이버 업종으로 보충했습니다.')
    elif len(nav):
        df = nav.copy()
        df['product'] = ''
        df['출처'] = '네이버'
    else:
        print('[안내] 업종 정보를 하나도 못 받았습니다. 업종 없이 진행합니다.')
        df = pd.DataFrame(columns=['code', 'sector', 'product', '출처'])

    if verbose and len(df):
        print(f'[데이터] 업종 {len(df):,}종목 / 분류 {df["sector"].nunique()}개')
    df.to_parquet(SECTOR, index=False)
    return df


# ─────────────────────────── 일봉 캐시 ───────────────────────────
def _prefilter(tickers: pd.DataFrame, s, verbose=True) -> list[str]:
    """일봉을 받기 전에 명백히 대상이 아닌 종목을 먼저 걸러 시간을 아낍니다."""
    df = tickers.copy()
    name = df['name'].fillna('')
    m = pd.Series(True, index=df.index)
    if s.exclude_spac:
        m &= ~name.str.contains('스팩|기업인수목적', regex=True)
    if s.exclude_etf_etn:
        m &= ~name.str.contains(
            #  '리츠' 는 앞에 '메' 가 없을 때만 (2026-09-01) — 메리츠가 걸렸습니다
            'ETN|KODEX|TIGER|KBSTAR|ARIRANG|HANARO|SOL |ACE |PLUS |RISE |TIMEFOLIO'
            r'|(?<!메)리츠',
            case=False, regex=True)
    m &= ~name.str.contains(r'우$|우B$|우C$|[0-9]우$', regex=True)
    if df['price'].notna().any():
        m &= (df['price'].fillna(0) >= s.min_price)
    out = df.loc[m, 'code'].tolist()
    if verbose:
        print(f'[데이터] 사전 제외 후 {len(out):,}종목의 주가를 받습니다.')
    return out


def update_ohlcv(s, days: int = 400, verbose: bool = True,
                 tickers: pd.DataFrame | None = None) -> pd.DataFrame:
    src = source(s, verbose)
    end = dt.date.today()
    codes = _prefilter(tickers, s, verbose) if tickers is not None else []

    have = pd.DataFrame()
    if os.path.exists(CACHE):
        try:
            have = pd.read_parquet(CACHE)
            have['date'] = pd.to_datetime(have['date'])
        except Exception:
            have = pd.DataFrame()

    # 캐시가 있으면 최근 20일만, 없으면 전체 기간을 받습니다.
    if len(have):
        last = have['date'].max().date()
        start = min(last - dt.timedelta(days=7), end - dt.timedelta(days=20))
        mode = f'최근 {(end - start).days}일치 갱신'
    else:
        start = end - dt.timedelta(days=int(days * 1.6))
        mode = '전체 기간 최초 수집'

    if verbose:
        print(f'[데이터] {mode} — {len(codes):,}종목 (동시 {s.max_workers}개)')
        if not len(have):
            print('          첫 실행이라 10~25분 걸립니다. 창을 닫지 마세요.')

    done, fail, chunks = 0, 0, []
    t0 = time.time()

    def one(code):
        try:
            return src.ohlcv(code, start, end)
        except Exception:
            return None

    with cf.ThreadPoolExecutor(max_workers=s.max_workers) as ex:
        for df in ex.map(one, codes):
            done += 1
            if df is None or len(df) == 0:
                fail += 1
            else:
                chunks.append(df)
            if verbose and done % 200 == 0:
                sec = time.time() - t0
                eta = sec / done * (len(codes) - done)
                print(f'   ... {done:,}/{len(codes):,} '
                      f'(실패 {fail}) 남은 시간 약 {eta / 60:.0f}분')

    if verbose:
        print(f'[데이터] 수집 완료 — 성공 {len(chunks):,} / 실패 {fail:,}')

    if chunks:
        new = pd.concat(chunks, ignore_index=True)
        new = new[['date', 'code', 'open', 'high', 'low', 'close', 'volume', 'value']]
        if len(have):
            key = set(zip(new['code'], new['date']))
            keep = ~pd.Series(list(zip(have['code'], have['date']))).isin(key)
            have = pd.concat([have[keep.values], new], ignore_index=True)
        else:
            have = new
    elif len(have) == 0:
        raise SystemExit(
            '\n[오류] 주가를 하나도 받지 못했습니다.\n'
            '       "진단.command" 를 더블클릭해서 나온 내용을 알려주세요.\n')
    else:
        print('[안내] 새로 받은 데이터가 없어 기존 캐시로 계산합니다.')

    # ⚠️ 2026-08-30 — 여기서 오래된 자료를 잘라 내고 있었습니다.
    #   백테스트용으로 tools/backfill_ohlcv.py 로 2020년치를 채워 넣어도,
    #   스크리너가 한 번 돌면 이 두 줄이 640일 이전을 통째로 지웠습니다.
    #   (4차 백테스트가 61개 시점 중 5개만 잡힌 원인이 이것이었습니다.)
    #
    #   화면·스크리닝은 400일이면 충분하지만, 배점 검증에는 길수록 좋습니다.
    #   그래서 **자르는 기준을 설정으로 뺐습니다.**
    #     keep_days = 0  → 자르지 않습니다 (기본값. 파일이 좀 커질 뿐입니다)
    #     keep_days = N  → N일 이전을 지웁니다 (예전처럼 쓰고 싶을 때)
    keep = int(getattr(s, 'keep_days', 0) or 0)
    if keep > 0:
        cutoff = pd.Timestamp(end - dt.timedelta(days=keep))
        have = have[have['date'] >= cutoff]
    have = have.sort_values(['code', 'date']).drop_duplicates(
        ['code', 'date'], keep='last').reset_index(drop=True)
    have.to_parquet(CACHE, index=False)
    if verbose:
        print(f'[데이터] 준비 완료 — {have["code"].nunique():,}종목 / '
              f'{have["date"].nunique()}거래일')
    return have


def apply_intraday(ohlcv: pd.DataFrame, s, verbose: bool = True) -> pd.DataFrame:
    """장중 잠정치가 비정상이면 전 거래일 기준으로 되돌립니다."""
    last = ohlcv['date'].max()
    if last.date() != dt.date.today():
        return ohlcv
    rows = ohlcv[ohlcv['date'] == last]
    if len(rows) < ohlcv['code'].nunique() * 0.5:
        if verbose:
            print('[데이터] 오늘 시세가 아직 덜 채워져 전 거래일 종가로 계산합니다.')
        return ohlcv[ohlcv['date'] < last]
    return ohlcv
