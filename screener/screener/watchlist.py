# -*- coding: utf-8 -*-
"""
관심종목(Watchlist).

output/watchlist.csv 에 적어 둔 종목을 매 실행마다 따라가며,
지금 몇 개 조건을 통과 중인지 · 8조건을 새로 채웠는지 알려줍니다.

7개만 통과한 종목을 여기 넣어 두면, 마지막 한 개가 채워지는 순간을 놓치지 않습니다.

파일 형식 (첫 줄은 그대로 두세요):
    코드,종목명,메모,추가일
    005930,삼성전자,반도체 반등 기대,2026-08-06
"""
from __future__ import annotations
import os
import datetime as dt
import pandas as pd

from . import config

PATH = os.path.join(config.OUT_DIR, 'watchlist.csv')
COLS = ['코드', '종목명', '메모', '추가일']


def load() -> pd.DataFrame:
    if not os.path.exists(PATH):
        return pd.DataFrame(columns=COLS)
    try:
        w = pd.read_csv(PATH, dtype={'코드': str})
    except Exception as e:
        print(f'[관심종목] watchlist.csv 를 읽지 못했습니다({e}).')
        return pd.DataFrame(columns=COLS)
    for c in COLS:
        if c not in w.columns:
            w[c] = ''
    w['코드'] = w['코드'].astype(str).str.zfill(6)
    return w[COLS].dropna(subset=['코드']).drop_duplicates('코드').reset_index(drop=True)


def save(w: pd.DataFrame):
    w[COLS].to_csv(PATH, index=False, encoding='utf-8-sig')


def ensure_file():
    """파일이 없으면 설명이 담긴 빈 파일을 만들어 둡니다."""
    if os.path.exists(PATH):
        return
    pd.DataFrame([{'코드': '', '종목명': '', '메모': '', '추가일': ''}]).iloc[0:0][COLS] \
        .to_csv(PATH, index=False, encoding='utf-8-sig')


def attach(df: pd.DataFrame, verbose: bool = True) -> pd.DataFrame:
    """스크리닝 결과에 관심종목 표시를 붙입니다."""
    ensure_file()
    w = load()
    if '관심' not in df.columns:
        df['관심'] = False
        df['관심메모'] = ''
    if len(w) == 0:
        return df
    memo = dict(zip(w['코드'], w['메모'].fillna('')))
    df['관심'] = df['코드'].isin(set(w['코드']))
    df['관심메모'] = df['코드'].map(memo).fillna('')
    if verbose:
        hit = df[df['관심']]
        done = hit[hit['판정'] == '통과']
        print(f'[관심종목] {len(w)}개 등록 / 그중 {len(hit)}개 추적 중 '
              f'/ 지금 8조건 통과 {len(done)}개')
    return df


def report_lines(df: pd.DataFrame) -> list[str]:
    """summary.txt 에 넣을 관심종목 현황."""
    w = df[df['관심']] if '관심' in df.columns else df.iloc[0:0]
    if len(w) == 0:
        return []
    w = w.sort_values('통과개수', ascending=False)
    out = ['', f'▶ 관심종목 현황 ({len(w)}개)']
    for _, r in w.iterrows():
        star = '★ 8조건 통과!' if r['판정'] == '통과' else f'{int(r["통과개수"])}/8'
        out.append(f'   {star:<14} {r["종목명"]} ({r["코드"]}) RS {int(r["RS"])} '
                   f'· 피벗대비 {r["피벗대비이격"] * 100:+.1f}%'
                   + (f'  — {r["관심메모"]}' if r['관심메모'] else ''))
    return out


def add(codes: list[str], names: dict | None = None, memo: str = ''):
    """터미널에서 종목을 추가할 때 쓰는 도우미."""
    w = load()
    today = dt.date.today().isoformat()
    rows = [{'코드': str(c).zfill(6), '종목명': (names or {}).get(c, ''),
             '메모': memo, '추가일': today}
            for c in codes if str(c).zfill(6) not in set(w['코드'])]
    if rows:
        w = pd.concat([w, pd.DataFrame(rows)], ignore_index=True)
        save(w)
    return w
