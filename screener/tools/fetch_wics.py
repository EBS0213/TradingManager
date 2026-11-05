#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
WICS 업종분류를 받아 둡니다 (에프앤가이드 WiseIndex).

왜 필요한가
  지금 업종은 KRX 표준산업분류(또는 네이버)를 쓰는데, 이름이 제각각이라
  '어느 업종에 돈이 몰렸나' 를 보기에 결이 맞지 않습니다. WICS 는 증권가가
  실제로 쓰는 분류라 리포트·시황과 같은 언어로 읽힙니다.

  미너비니는 '주도 업종에서 주도주를 고르라' 고 합니다. 그 '업종' 의 단위가
  시장이 쓰는 단위와 같아야 비교가 됩니다.

받는 것
  중분류 28개를 하나씩 부릅니다. 한 번 부르면 그 중분류에 속한 종목이
  대분류 정보와 함께 옵니다. 종목은 중분류 하나에만 속하므로 겹치지 않습니다.

  결과 → data/wics.parquet   (code, wics중분류, wics대분류)

하루 한 번이면 충분합니다. 분류는 분기에 한 번쯤 바뀝니다.
"""
from __future__ import annotations
import datetime as dt
import json
import os
import sys
import time
import urllib.request

import pandas as pd

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, 'data', 'wics.parquet')
URL = 'https://www.wiseindex.com/Index/GetIndexComponets?ceil_yn=0&dt={dt}&sec_cd={cd}'
UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      'Referer': 'https://www.wiseindex.com/'}
SLEEP = 0.4

# 2026-08-18 전수 확인. 없는 코드(G2540 미디어 등)는 뺐습니다.
CODES = [
    'G1010',                                   # 에너지
    'G1510',                                   # 소재
    'G2010', 'G2020', 'G2030',                 # 산업재
    'G2510', 'G2520', 'G2530', 'G2550', 'G2560',   # 경기관련소비재
    'G3010', 'G3020', 'G3030',                 # 필수소비재
    'G3510', 'G3520',                          # 건강관리
    'G4010', 'G4020', 'G4030', 'G4040', 'G4050',   # 금융
    'G4510', 'G4520', 'G4530', 'G4535', 'G4540',   # IT
    'G5010', 'G5020',                          # 커뮤니케이션서비스
    'G5510',                                   # 유틸리티
]


def log(m):
    print(f'[{dt.datetime.now():%H:%M:%S}] {m}', flush=True)


def _get(url: str) -> dict:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode('utf-8', 'replace'))


def _clean(name: str) -> str:
    """'WICS 반도체와반도체장비' → '반도체와반도체장비'"""
    return str(name or '').replace('WICS', '').strip()


def fetch(day: str) -> pd.DataFrame:
    rows = []
    for cd in CODES:
        try:
            j = _get(URL.format(dt=day, cd=cd))
        except Exception as e:
            log(f'   · {cd} 실패({e})')
            time.sleep(SLEEP)
            continue
        lst = j.get('list') or []
        for x in lst:
            code = str(x.get('CMP_CD') or '').zfill(6)
            if len(code) != 6:
                continue
            rows.append({
                'code': code,
                'wics중분류': _clean(x.get('IDX_NM_KOR')),
                'wics대분류': _clean(x.get('SEC_NM_KOR')),
            })
        log(f'   {cd} {_clean((lst[0] or {}).get("IDX_NM_KOR")) if lst else "-":<16} {len(lst):>4}종목')
        time.sleep(SLEEP)
    return pd.DataFrame(rows).drop_duplicates('code')


def main() -> int:
    # 비영업일이면 빈 응답이 옵니다. 하루씩 뒤로 물러나며 최대 7번 봅니다.
    day = dt.date.today()
    for _ in range(7):
        d = day.strftime('%Y%m%d')
        log(f'{d} 기준으로 받아봅니다')
        df = fetch(d)
        if len(df) > 500:
            os.makedirs(os.path.dirname(OUT), exist_ok=True)
            df.to_parquet(OUT, index=False)
            log(f'저장 — {len(df):,}종목 / 중분류 {df["wics중분류"].nunique()}개 '
                f'/ 대분류 {df["wics대분류"].nunique()}개 → {OUT}')
            return 0
        log(f'   받은 것이 {len(df)}종목뿐입니다 — 휴장일로 보고 하루 물러납니다')
        day -= dt.timedelta(days=1)
    log('[오류] 이레를 돌려봤지만 분류를 받지 못했습니다')
    return 1


if __name__ == '__main__':
    sys.exit(main())
