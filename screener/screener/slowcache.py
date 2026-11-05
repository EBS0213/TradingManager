# -*- coding: utf-8 -*-
"""
느리게 바뀌는 자료를 담아 둡니다 — 실적 · 수급 (2026-08-26)

왜 만들었나
  전에는 '조건을 6개 이상 채운 종목' 만 실적·수급을 확인했습니다.
  그래서 파마리서치(4/8) 같은 종목은 화면의 실적·수급 칸이 '-' 로 비었습니다.
  전 종목으로 넓히고 싶은데, 그러면 한 번 돌 때 네이버를 5,800번 두드립니다.
  두 시간마다 돌면 하루 7만 번 — 막히는 것이 당연합니다.

  그런데 **이 두 자료는 매번 받을 이유가 없습니다.**
    · 분기 실적 → 분기에 한 번 바뀝니다
    · 외국인·기관 20일 수급 → 하루에 한 번 바뀝니다 (장중에는 확정되지도 않습니다)

  그래서 받아 둔 값을 파일에 적어 두고, **오래된 것만** 다시 받습니다.
    첫 실행    5,800번 (한 번만)
    그다음부터 실적은 거의 0번, 수급은 하루 한 번씩만

담는 곳
  data/cache_실적.csv · data/cache_수급.csv
  지워도 됩니다 — 다음 실행 때 다시 받습니다(오래 걸릴 뿐입니다).
"""
from __future__ import annotations
import os
import datetime as dt
import pandas as pd

from . import config


def _path(name: str) -> str:
    return os.path.join(config.DATA_DIR, f'cache_{name}.csv')


def load(name: str) -> pd.DataFrame:
    p = _path(name)
    if not os.path.exists(p):
        return pd.DataFrame()
    try:
        df = pd.read_csv(p, dtype={'코드': str})
        if '받은날' not in df.columns:
            return pd.DataFrame()
        return df
    except Exception:
        # 파일이 깨졌으면 없는 셈 칩니다 — 다시 받으면 그만입니다
        return pd.DataFrame()


def save(name: str, df: pd.DataFrame) -> None:
    try:
        df.to_csv(_path(name), index=False, encoding='utf-8-sig')
    except Exception:
        pass          # 못 담아도 이번 실행은 그대로 굴러갑니다


def _age_days(v) -> float:
    try:
        d = dt.date.fromisoformat(str(v)[:10])
    except Exception:
        return 9999.0
    return (dt.date.today() - d).days


def split(codes, name: str, fresh_days: int, retry_days: float = 1.0):
    """
    받아 둔 것 중 아직 쓸 만한 것과, 다시 받아야 할 것을 갈라 줍니다.

      fresh_days  이만큼 지나면 다시 받습니다 (실적 90일 · 수급 1일)
      retry_days  **실패했던 종목**은 이만큼만 지나면 다시 시도합니다.
                  네이버에 아예 표가 없는 종목도 있어서, 실패를 90일 동안
                  붙들고 있으면 영영 빈칸입니다. 그렇다고 매번 다시 두드리면
                  없는 자료를 계속 묻는 꼴이라 하루는 쉬게 합니다.

    돌려주는 값: (쓸 만한 표, 다시 받을 코드 목록)
    """
    have = load(name)
    codes = [str(c) for c in codes]
    if not len(have):
        return pd.DataFrame(), codes

    have = have[have['코드'].astype(str).isin(codes)].copy()
    if not len(have):
        return pd.DataFrame(), codes

    have['_나이'] = have['받은날'].map(_age_days)
    ok_col = '실적출처' if '실적출처' in have.columns else '수급판정'
    실패 = have[ok_col].astype(str).isin(['없음', '-', 'nan', ''])
    쓸만 = (~실패 & (have['_나이'] < fresh_days)) | (실패 & (have['_나이'] < retry_days))

    good = have[쓸만].drop(columns=['_나이'])
    need = [c for c in codes if c not in set(good['코드'].astype(str))]
    return good, need


def _cat(*frames) -> pd.DataFrame:
    """비어 있지 않은 표만 이어 붙입니다."""
    keep = [f for f in frames if f is not None and len(f)]
    if not keep:
        return pd.DataFrame()
    if len(keep) == 1:
        return keep[0].copy()
    # 칸을 미리 맞춰 둡니다. 한쪽에만 있는 칸이 있으면 pandas 가 자료형을 정하지
    #  못해 경고를 냅니다 — 값이 틀리지는 않지만 터미널이 지저분해집니다.
    cols = list(dict.fromkeys([c for f in keep for c in f.columns]))
    keep = [f.reindex(columns=cols) for f in keep]
    keep = [f.dropna(axis=1, how='all') if f.isna().all().any() else f for f in keep]
    cols = list(dict.fromkeys([c for f in keep for c in f.columns]))
    keep = [f.reindex(columns=cols) for f in keep]
    return pd.concat(keep, ignore_index=True)


def merge_save(name: str, good: pd.DataFrame, fresh: pd.DataFrame) -> pd.DataFrame:
    """새로 받은 것을 담아 두고, 이번 실행에서 쓸 표를 돌려줍니다."""
    today = dt.date.today().isoformat()
    if len(fresh):
        fresh = fresh.copy()
        fresh['받은날'] = today
    old = load(name)
    # 빈 표를 섞으면 pandas 가 칸의 자료형을 잃습니다(경고도 냅니다) — 미리 걸러 냅니다
    new = _cat(old, fresh)
    if len(new):
        new['코드'] = new['코드'].astype(str)
        # 같은 종목이 여러 줄이면 마지막(가장 최근에 받은) 것만 남깁니다
        new = new.drop_duplicates('코드', keep='last')
        save(name, new)
    out = _cat(good, fresh)
    if len(out):
        out = out.drop_duplicates('코드', keep='last')
        if '받은날' in out.columns:
            out = out.drop(columns=['받은날'])
    return out
