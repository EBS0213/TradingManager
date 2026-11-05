# -*- coding: utf-8 -*-
"""
외국인 · 기관 수급.

미너비니 원문에는 '외국인/기관 순매수'라는 개념이 없습니다. 미국에는 한국처럼
투자자 유형별 일별 매매 공시가 없기 때문입니다. 대신 그는 거래량 패턴으로
기관의 매집(institutional accumulation)을 읽습니다 — 그 부분은 rules.py 의
UD비율·매집일 지표가 담당합니다.

이 모듈은 한국 시장에만 있는 추가 정보를 덧붙이는 '보너스'입니다.
기본값은 표시만 하고 탈락시키지 않습니다.

자료를 어디서 받나 (2026-09-18 에 바뀌었습니다)
  예전에는 finance.naver.com/item/frgn.naver 의 **표를 긁었습니다.**
  네이버가 종목 페이지를 stock.naver.com 으로 옮기면서 이 주소가 302 로
  넘어가게 됐고, 넘어간 곳에는 표가 없습니다. pandas 가 표를 못 찾아
  예외가 났고, 그 예외를 통째로 삼키고 있어서 **모든 종목의 수급판정이
  조용히 '-' 가 됐습니다** — 화면의 [수급] 칸에서 동반·외인·기관이
  통째로 사라진 것이 이것입니다. 종합점수의 수급 6점도 전부 절반(중립)으로
  고정돼 있었습니다.

  이제는 표를 긁지 않고 네이버가 그대로 내려주는 JSON 을 씁니다.
    https://m.stock.naver.com/api/stock/{코드}/trend?pageSize=20
    → [{"bizdate":"20260917","foreignerPureBuyQuant":"+68,349",
        "organPureBuyQuant":"+33,671","foreignerHoldRatio":"1.96%"}, ...]
  minervini-web 의 lib/naver.js 가 지수 수급에 쓰는 것과 같은 방식입니다.
  ("글자를 뒤져서 숫자를 고르면 엉뚱한 값이 잡힙니다")
"""
from __future__ import annotations
import time
import concurrent.futures as cf
import pandas as pd

URL = 'https://m.stock.naver.com/api/stock/{code}/trend'
DAYS = 20                     # 며칠 치를 누적할지 (화면 설명글도 '20거래일' 입니다)
HEADERS = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                         'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
           'Referer': 'https://m.stock.naver.com/'}

COLS = ['코드', '외국인20일', '기관20일', '외국인지분율', '수급판정']


def _num(v):
    """'+68,349' · '-2,170,687' · '0' · '1.96%' → 숫자. 못 읽으면 None."""
    if v is None:
        return None
    s = str(v).replace(',', '').replace('%', '').replace('+', '').strip()
    if not s or s in ('-', 'N/A', 'nan'):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _sum20(rows, key):
    """최근 DAYS 거래일의 순매수 합계. 한 줄도 못 읽으면 None."""
    vals = [_num(r.get(key)) for r in rows[:DAYS]]
    vals = [v for v in vals if v is not None]
    return int(sum(vals)) if vals else None


def fetch_one(code: str, delay: float = 0.15) -> dict:
    out = {'코드': code, '외국인20일': None, '기관20일': None,
           '외국인지분율': None, '수급판정': '-'}
    try:
        import requests
        r = requests.get(URL.format(code=code), params={'pageSize': DAYS},
                         headers=HEADERS, timeout=10)
        rows = r.json()
        # 없는 종목·상장폐지 종목은 목록이 아닌 오류 문서가 옵니다
        if not isinstance(rows, list) or not rows:
            return out

        out['외국인20일'] = _sum20(rows, 'foreignerPureBuyQuant')
        out['기관20일'] = _sum20(rows, 'organPureBuyQuant')
        ratio = _num(rows[0].get('foreignerHoldRatio'))
        out['외국인지분율'] = ratio / 100 if ratio is not None else None

        f, i = out['외국인20일'], out['기관20일']
        if f is None and i is None:
            out['수급판정'] = '-'
        else:
            f, i = (f or 0), (i or 0)
            if f > 0 and i > 0:
                out['수급판정'] = '쌍끌이'
            elif f > 0 or i > 0:
                out['수급판정'] = '외인' if f > 0 else '기관'
            else:
                out['수급판정'] = '이탈'
    except Exception:
        pass
    finally:
        time.sleep(delay)
    return out



def _targets(df, s):
    """수급·실적을 확인할 종목 목록.

    예전에는 8조건 통과 종목만 봤습니다. 그래서 7개·6개 통과 종목은
    화면에 수급·실적이 '-' 로 비어 있었습니다.
    이제 표에 그려지는 종목(기본 6개 이상 통과)과 관심 종목까지 함께 확인합니다.
    """
    lo = int(getattr(s, 'extra_min_conds', 6))
    pick = (df['통과개수'] >= lo) | (df['판정'] == '통과')
    if '관심' in df.columns:
        pick = pick | df['관심'].astype(str).str.upper().isin(['TRUE', '1', 'Y', 'O', '예'])
    return df.loc[pick, '코드'].tolist()

def apply(df: pd.DataFrame, s, verbose: bool = True) -> pd.DataFrame:
    for c in COLS[1:]:
        if c not in df.columns:
            df[c] = None
    if not getattr(s, 'use_supply', True):
        return df

    targets = _targets(df, s)
    if not targets:
        return df

    # 받아 둔 것은 그대로 씁니다 (2026-08-26).
    #  외국인·기관 20일 순매수는 **하루에 한 번** 바뀝니다. 장중에 다시 받아 봐야
    #  그날 치는 어차피 확정되지 않습니다. 그래서 하루를 넘긴 것만 새로 받습니다.
    #  전 종목(약 2,900개)으로 넓히면서 이게 없으면 두 시간마다 2,900번을
    #  두드리게 됩니다 — 하루 3만 번이면 막히는 것이 당연합니다.
    from .slowcache import split, merge_save
    good, need = split(targets, '수급', fresh_days=1, retry_days=1)
    if verbose:
        if len(good):
            print(f'[수급] 담아 둔 {len(good)}종목은 그대로 쓰고, {len(need)}종목만 새로 받습니다')
        else:
            print(f'[수급] {len(need)}종목의 외국인·기관 20일 수급을 확인합니다...')
            if len(need) > 1500:
                print('[수급]   처음이라 오래 걸립니다(수 분). 하루 한 번만 이렇습니다.')

    rows = []
    if need:
        with cf.ThreadPoolExecutor(max_workers=s.max_workers) as ex:
            for r in ex.map(lambda c: fetch_one(c, s.request_delay), need):
                rows.append(r)

    # 자료 출처가 통째로 바뀌면 시끄럽게 알립니다 (2026-09-18).
    #  네이버가 주소를 옮겼을 때 예외가 조용히 삼켜져서, 몇 주 동안 아무도
    #  모르게 [수급] 칸이 전부 '-' 였습니다. 무인 실행에서는 조용한 실패가
    #  가장 위험합니다. 서버의 야간 실행 스크립트가 '[오류]' 줄을 세어
    #  텔레그램으로 알립니다.
    if rows:
        got = sum(1 for r in rows if r['수급판정'] != '-')
        if got == 0 and len(rows) >= 20:
            print(f'[오류] 수급을 {len(rows)}종목 모두 받지 못했습니다 — '
                  f'네이버 주소({URL}) 가 또 바뀌었을 수 있습니다.')
        elif verbose:
            print(f'[수급] {len(rows)}종목 중 {got}종목을 받았습니다')

    fresh = pd.DataFrame(rows) if rows else pd.DataFrame(columns=COLS)
    sup = merge_save('수급', good, fresh)
    if not len(sup):
        sup = pd.DataFrame(columns=COLS)
    for c in COLS:
        if c not in sup.columns:
            sup[c] = None
    sup = sup[COLS]

    df = df.drop(columns=[c for c in COLS[1:] if c in df.columns]).merge(
        sup, on='코드', how='left')
    df[[c for c in COLS[1:] if c != '수급판정']] = \
        df[[c for c in COLS[1:] if c != '수급판정']]
    df['수급판정'] = df['수급판정'].fillna('-')

    if getattr(s, 'supply_as_filter', False):
        drop = (df['판정'] == '통과') & (df['수급판정'] == '이탈')
        df.loc[drop, '판정'] = '수급탈락'
        if verbose:
            print(f'[수급] {int(drop.sum())}종목이 수급 기준에서 탈락했습니다.')
    elif verbose:
        n = int((df['수급판정'] == '쌍끌이').sum())
        print(f'[수급] 외국인·기관 동반 순매수 {n}종목')
    return df
