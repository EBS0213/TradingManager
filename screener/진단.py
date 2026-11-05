#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
데이터가 안 받아질 때 어디서 막히는지 하나씩 확인합니다.
결과를 그대로 복사해서 알려주시면 됩니다.
"""
from __future__ import annotations
import sys, os, datetime as dt, traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
OK, NG = '  ✓', '  ✗'


def head(t):
    print('\n' + '─' * 58); print(f'  {t}'); print('─' * 58)


def main():
    print('═' * 58)
    print('  미너비니 스크리너 — 데이터 연결 진단')
    print(f'  {dt.datetime.now():%Y-%m-%d %H:%M}')
    print('═' * 58)

    head('0. 실행 환경')
    print(f'  파이썬 {sys.version.split()[0]}')
    for mod in ('pandas', 'numpy', 'requests', 'lxml', 'pyarrow', 'pykrx'):
        try:
            m = __import__(mod)
            print(f'{OK} {mod} {getattr(m, "__version__", "")}')
        except ImportError:
            print(f'{NG} {mod} — 설치 안 됨')

    head('1. 인터넷 연결')
    try:
        import requests
        r = requests.get('https://finance.naver.com', timeout=10)
        print(f'{OK} 네이버 금융 접속 OK (HTTP {r.status_code})')
    except Exception as e:
        print(f'{NG} 인터넷 연결 실패: {e}')
        print('     → 와이파이/방화벽을 확인하세요. 여기서 막히면 나머지는 볼 필요 없습니다.')
        return

    head('2. 네이버 — 전 종목 목록')
    try:
        from screener.sources import Naver
        nv = Naver(0.1)
        df = nv.list_stocks(('KOSPI',), verbose=False)
        print(f'{OK} 코스피 {len(df):,}종목')
        if len(df):
            print(f'     예: {df.iloc[0]["code"]} {df.iloc[0]["name"]} '
                  f'현재가 {df.iloc[0]["price"]}')
        else:
            print('     → 0종목입니다. 네이버 페이지 구조가 바뀌었을 수 있습니다.')
    except Exception:
        print(f'{NG} 실패'); traceback.print_exc(limit=2)

    head('3. 네이버 — 일봉 (삼성전자)')
    try:
        from screener.sources import Naver
        end = dt.date.today(); start = end - dt.timedelta(days=60)
        d = Naver(0.1).ohlcv('005930', start, end)
        print(f'{OK} {len(d)}일치 수신')
        if len(d):
            r = d.iloc[-1]
            print(f'     최근: {r["date"]:%Y-%m-%d} 종가 {r["close"]:,.0f} '
                  f'거래량 {r["volume"]:,.0f}')
    except Exception:
        print(f'{NG} 실패'); traceback.print_exc(limit=2)

    head('4. KRX(KIND) — 표준산업분류 업종  ★기본 경로')
    try:
        from screener.sources import KrxIndustry
        km = KrxIndustry(0.2).sector_map(('KOSPI',), verbose=False)
        print(f'{OK} 코스피 {len(km):,}종목 / 업종 {km["sector"].nunique()}개')
        if len(km):
            r = km.iloc[0]
            print(f'     예: {r["code"]} → {r["sector"]} ({str(r["product"])[:28]})')
        else:
            print('     → 0종목. KIND 페이지 구조가 바뀌었을 수 있습니다.')
            print('       config.yaml 에서 sector_source: naver 로 바꾸면 우회됩니다.')
    except Exception:
        print(f'{NG} 실패'); traceback.print_exc(limit=2)

    head('5. 네이버 — 업종 분류 (대체 경로)')
    try:
        from screener.sources import Naver
        sm = Naver(0.1).sector_map(verbose=False)
        print(f'{OK} {len(sm):,}종목 업종 매핑')
        if len(sm):
            print(f'     예: {sm.iloc[0]["code"]} → {sm.iloc[0]["sector"]}')
    except Exception:
        print(f'{NG} 실패'); traceback.print_exc(limit=2)

    head('6. pykrx (KRX) — 참고용')
    if not (os.environ.get('KRX_ID') and os.environ.get('KRX_PW')):
        print('  · KRX_ID / KRX_PW 환경변수 없음 → pykrx 는 사용하지 않습니다.')
        print('    (2026년부터 KRX는 로그인해야 데이터를 줍니다. 정상입니다.)')
    else:
        try:
            from pykrx import stock
            d = (dt.date.today() - dt.timedelta(days=3)).strftime('%Y%m%d')
            n = len(stock.get_market_ticker_list(d, market='KOSPI'))
            print(f'{OK} pykrx 로 코스피 {n}종목' if n else f'{NG} pykrx 가 0종목 반환')
        except Exception:
            print(f'{NG} 실패'); traceback.print_exc(limit=2)

    head('7. 네이버 — 실적 (삼성전자)')
    try:
        from screener.fundamentals import fetch_one
        r = fetch_one('005930', 0.1)
        print(f'{OK} EPS증가율 {r["EPS증가율"]} / 매출증가율 {r["매출증가율"]} '
              f'/ 출처 {r["실적출처"]}')
        if r['실적출처'] == '없음':
            print('     → 실적만 실패해도 스크리닝은 정상 작동합니다.')
    except Exception:
        print(f'{NG} 실패'); traceback.print_exc(limit=2)

    print('\n' + '═' * 58)
    print('  진단 끝. 위 내용을 통째로 복사해서 알려주세요.')
    print('═' * 58 + '\n')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        traceback.print_exc()
