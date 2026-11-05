# -*- coding: utf-8 -*-
"""
데이터 공급원(백엔드).

2026년 들어 KRX가 로그인 없이는 데이터를 주지 않도록 바뀌었습니다.
그래서 기본 공급원을 '네이버 금융'으로 두고, pykrx 는 KRX 계정이 있을 때만 씁니다.

  · naver  : 로그인 불필요. 기본값.
  · pykrx  : 환경변수 KRX_ID / KRX_PW 가 있을 때만 동작.

두 백엔드 모두 아래 3가지를 제공합니다.
  list_stocks()        → DataFrame[code, name, market, price, volume, marcap]
  sector_map()         → DataFrame[code, sector]
  ohlcv(code, days)    → DataFrame[date, open, high, low, close, volume, value]
"""
from __future__ import annotations
import ast
import os
import re
import time
import datetime as dt
import pandas as pd

UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      'Referer': 'https://finance.naver.com/'}


def _req():
    try:
        import requests
        return requests
    except ImportError:
        raise SystemExit('[오류] requests 가 없습니다. pip3 install -r requirements.txt')


# ══════════════════════════ 네이버 금융 ══════════════════════════
class Naver:
    name = '네이버 금융'

    # 2026-09-19 에 바뀌었습니다 — finance.naver.com 의 시세 목록 페이지가
    #  stock.naver.com 으로 옮겨졌습니다. 옮겨간 곳은 자바스크립트로 그리는
    #  화면이라 HTML 에 표도, /item/main.naver?code= 링크도 없습니다.
    #  그래서 pd.read_html 이 표를 못 찾고 정규식이 한 건도 못 잡아
    #  **종목 목록이 통째로 0건**이 됐고, 한국 스크리너가 그 자리에서 죽었습니다.
    #  (같은 이사가 종목 페이지에서 먼저 일어난 것이 2026-09-18 supply.py 건입니다)
    #
    #  이제는 화면을 긁지 않고 그 화면이 쓰는 JSON 을 그대로 받습니다.
    #    목록  /api/stocks/marketValue/KOSPI?page=1&pageSize=100
    #          → {"stocks":[{"itemCode","stockName","closePrice",
    #                        "accumulatedTradingVolume","marketValue"(억원),
    #                        "stockEndType":"stock|etf|etn"}], "totalCount":…}
    #    업종  /api/stocks/industry?page=1&pageSize=100        → groups[].no·name
    #          /api/stocks/industry/{no}?page=1&pageSize=100   → stocks[].itemCode
    LIST_API = 'https://m.stock.naver.com/api/stocks/marketValue/{mkt}'
    GROUP_API = 'https://m.stock.naver.com/api/stocks/industry'
    GROUP_DETAIL_API = 'https://m.stock.naver.com/api/stocks/industry/{no}'
    PAGE_SIZE = 100                 # 이 주소는 100 을 넘기면 HTTP 400 입니다
    CHART = ('https://api.finance.naver.com/siseJson.naver?symbol={code}'
             '&requestType=1&startTime={s}&endTime={e}&timeframe=day')

    def __init__(self, delay: float = 0.15):
        self.delay = delay
        self.rq = _req()
        self.sess = self.rq.Session()
        self.sess.headers.update(UA)

    def _get(self, url, tries=3):
        last = None
        for i in range(tries):
            try:
                r = self.sess.get(url, timeout=12)
                if r.status_code == 200:
                    return r
                last = f'HTTP {r.status_code}'
            except Exception as e:
                last = str(e)
            time.sleep(0.6 * (i + 1))
        raise RuntimeError(f'요청 실패({last}): {url[:90]}')

    def _json(self, url, params=None, tries=3):
        """JSON 주소를 읽습니다. 못 읽으면 예외를 냅니다(조용히 넘기지 않습니다)."""
        last = None
        for i in range(tries):
            try:
                r = self.sess.get(url, params=params, timeout=12)
                if r.status_code == 200:
                    return r.json()
                last = f'HTTP {r.status_code}'
            except Exception as e:
                last = str(e)
            time.sleep(0.6 * (i + 1))
        raise RuntimeError(f'요청 실패({last}): {url[:90]}')

    @staticmethod
    def _n(v):
        """'260,000' · '15,200,324' → 숫자. 못 읽으면 None."""
        if v is None:
            return None
        s = str(v).replace(',', '').replace('+', '').strip()
        if not s or s in ('-', 'N/A'):
            return None
        try:
            return float(s)
        except ValueError:
            return None

    # ── 전 종목 목록 ────────────────────────────────────────────
    def list_stocks(self, markets=('KOSPI', 'KOSDAQ'), verbose=True) -> pd.DataFrame:
        rows, bad = [], []
        for mkt in markets:
            if mkt not in ('KOSPI', 'KOSDAQ'):
                continue
            seen, page = set(), 1
            try:
                while page <= 60:
                    j = self._json(self.LIST_API.format(mkt=mkt),
                                   {'page': page, 'pageSize': self.PAGE_SIZE})
                    got = j.get('stocks') or []
                    if not got:
                        break
                    for x in got:
                        c = str(x.get('itemCode') or '').strip()
                        if len(c) != 6 or c in seen:
                            continue
                        # ETF·ETN 은 여기서 이름이 아니라 종류로 걸러집니다.
                        #  예전에는 'KODEX|TIGER…' 같은 이름 규칙으로 걸렀는데,
                        #  브랜드가 늘 때마다 규칙을 좇아가야 했습니다.
                        if x.get('stockEndType') not in (None, 'stock'):
                            continue
                        seen.add(c)
                        rows.append({
                            'code': c,
                            'name': str(x.get('stockName') or '').strip(),
                            'market': mkt,
                            'price': self._n(x.get('closePrice')),
                            'volume': self._n(x.get('accumulatedTradingVolume')),
                            'marcap': self._n(x.get('marketValue')),
                        })
                    if len(got) < self.PAGE_SIZE:
                        break
                    page += 1
                    time.sleep(self.delay)
            except Exception as e:
                bad.append(f'{mkt}({e})')
            if verbose:
                print(f'   {mkt}: {len(seen):,}종목')
        if bad:
            print(f'[오류] 종목 목록을 받다가 막혔습니다 — {" · ".join(bad)}')
        df = pd.DataFrame(rows)
        if not len(df):
            print(f'[오류] 네이버 종목 목록이 0건입니다 — 주소({self.LIST_API}) 가 '
                  f'또 바뀌었을 수 있습니다.')
            return pd.DataFrame(columns=['code', 'name', 'market',
                                         'price', 'volume', 'marcap'])
        df = df.drop_duplicates('code').reset_index(drop=True)
        df['marcap'] = df['marcap'] * 100_000_000      # 네이버는 '억원' 단위
        return df

    # ── 업종 ───────────────────────────────────────────────────
    def sector_map(self, verbose=True) -> pd.DataFrame:
        try:
            top = self._json(self.GROUP_API, {'page': 1, 'pageSize': self.PAGE_SIZE})
        except Exception as e:
            print(f'[오류] 네이버 업종 목록을 못 받았습니다({e}).')
            return pd.DataFrame(columns=['code', 'sector'])
        groups = [(g.get('no'), str(g.get('name') or '').strip())
                  for g in (top.get('groups') or []) if g.get('no')]

        rows = []
        for no, sector in groups:
            page = 1
            try:
                while page <= 30:
                    d = self._json(self.GROUP_DETAIL_API.format(no=no),
                                   {'page': page, 'pageSize': self.PAGE_SIZE})
                    got = d.get('stocks') or []
                    if not got:
                        break
                    for x in got:
                        c = str(x.get('itemCode') or '').strip()
                        if len(c) == 6:
                            rows.append({'code': c, 'sector': sector})
                    if len(got) < self.PAGE_SIZE:
                        break
                    page += 1
                    time.sleep(self.delay)
            except Exception:
                continue
            time.sleep(self.delay)
        if verbose:
            print(f'   업종 {len(groups)}개 / 매핑 {len(rows):,}건')
        if not rows:
            print('[오류] 네이버 업종 매핑이 0건입니다 — 주소가 또 바뀌었을 수 있습니다.')
            return pd.DataFrame(columns=['code', 'sector'])
        return (pd.DataFrame(rows).drop_duplicates('code').reset_index(drop=True))

    # ── 일봉 ───────────────────────────────────────────────────
    def ohlcv(self, code: str, start: dt.date, end: dt.date) -> pd.DataFrame:
        url = self.CHART.format(code=code, s=start.strftime('%Y%m%d'),
                                e=end.strftime('%Y%m%d'))
        txt = self._get(url).text.strip()
        # 응답이 파이썬 리스트 리터럴 형태(작은따옴표)라 literal_eval 로 읽습니다.
        try:
            arr = ast.literal_eval(txt)
        except Exception:
            return pd.DataFrame()
        if not arr or len(arr) < 2:
            return pd.DataFrame()
        head, body = arr[0], arr[1:]
        df = pd.DataFrame(body, columns=head)
        ren = {'날짜': 'date', '시가': 'open', '고가': 'high', '저가': 'low',
               '종가': 'close', '거래량': 'volume'}
        df = df.rename(columns=ren)
        need = ['date', 'open', 'high', 'low', 'close', 'volume']
        if any(c not in df.columns for c in need):
            return pd.DataFrame()
        df = df[need].copy()
        df['date'] = pd.to_datetime(df['date'].astype(str), format='%Y%m%d', errors='coerce')
        for c in ('open', 'high', 'low', 'close', 'volume'):
            df[c] = pd.to_numeric(df[c], errors='coerce')
        df = df.dropna(subset=['date', 'close'])
        df['value'] = df['close'] * df['volume']       # 거래대금 근사치
        df['code'] = code
        time.sleep(self.delay)
        return df


# ══════════════════════════ pykrx (KRX 계정 필요) ══════════════════════════
class Pykrx:
    name = 'pykrx (KRX)'

    def __init__(self, delay: float = 0.25):
        from pykrx import stock
        self.stock = stock
        self.delay = delay

    @staticmethod
    def available() -> bool:
        if not (os.environ.get('KRX_ID') and os.environ.get('KRX_PW')):
            return False
        try:
            from pykrx import stock
            d = (dt.date.today() - dt.timedelta(days=3)).strftime('%Y%m%d')
            return len(stock.get_market_ticker_list(d, market='KOSPI')) > 0
        except Exception:
            return False

    def _day(self):
        d = dt.date.today()
        for _ in range(10):
            s = d.strftime('%Y%m%d')
            try:
                if len(self.stock.get_market_ohlcv(s, market='KOSPI')) > 0:
                    return s
            except Exception:
                pass
            d -= dt.timedelta(days=1)
        return dt.date.today().strftime('%Y%m%d')

    def list_stocks(self, markets=('KOSPI', 'KOSDAQ'), verbose=True) -> pd.DataFrame:
        day = self._day()
        rows = []
        for mkt in markets:
            for c in self.stock.get_market_ticker_list(day, market=mkt):
                rows.append({'code': c, 'name': self.stock.get_market_ticker_name(c),
                             'market': mkt, 'price': None, 'volume': None, 'marcap': None})
            if verbose:
                print(f'   {mkt}: {len(rows):,}종목(누적)')
        return pd.DataFrame(rows)

    def sector_map(self, verbose=True) -> pd.DataFrame:
        return pd.DataFrame(columns=['code', 'sector'])   # 업종은 네이버 쪽을 씁니다

    def ohlcv(self, code, start, end) -> pd.DataFrame:
        df = self.stock.get_market_ohlcv(start.strftime('%Y%m%d'),
                                         end.strftime('%Y%m%d'), code)
        if df is None or len(df) == 0:
            return pd.DataFrame()
        df = df.reset_index().rename(columns={
            '날짜': 'date', '시가': 'open', '고가': 'high', '저가': 'low',
            '종가': 'close', '거래량': 'volume', '거래대금': 'value'})
        df['code'] = code
        time.sleep(self.delay)
        return df[['date', 'open', 'high', 'low', 'close', 'volume', 'value', 'code']]


# ══════════════════════════ KRX 공식 업종분류 (KIND) ══════════════════════════
class KrxIndustry:
    """
    한국거래소 기업공시채널 KIND 의 '상장법인목록' 에서 업종을 가져옵니다.

    · 통계청 한국표준산업분류(KSIC) 기반의 **공식 업종**입니다.
    · 로그인이 필요 없습니다 (data.krx.co.kr 쪽은 2026년부터 로그인 필수).
    · 업종 외에 '주요제품' 도 같이 받아 대시보드 툴팁으로 씁니다.

    네이버 업종은 FnGuide 계열 분류라 테마성이 강하고 KRX와 이름이 다릅니다.
    벤치마크를 맞추려면 이쪽(KRX)을 쓰는 편이 맞습니다.
    """
    name = 'KRX KIND (표준산업분류)'
    URL = ('https://kind.krx.co.kr/corpgeneral/corpList.do'
           '?method=download&pageIndex=1&currentPageSize=5000&searchType=13'
           '&marketType={mkt}')
    MKT = {'KOSPI': 'stockMkt', 'KOSDAQ': 'kosdaqMkt'}

    def __init__(self, delay: float = 0.3):
        self.delay = delay
        self.rq = _req()

    def sector_map(self, markets=('KOSPI', 'KOSDAQ'), verbose=True) -> pd.DataFrame:
        frames = []
        for mkt in markets:
            code = self.MKT.get(mkt)
            if not code:
                continue
            try:
                r = self.rq.get(self.URL.format(mkt=code), headers=UA, timeout=25)
                r.encoding = r.apparent_encoding or 'euc-kr'
                tables = pd.read_html(r.text)
            except Exception as e:
                print(f'[업종] KRX {mkt} 목록을 못 받았습니다({e}).')
                continue
            if not tables:
                continue
            t = tables[0]
            if '종목코드' not in t.columns or '업종' not in t.columns:
                print(f'[업종] KRX {mkt} 표 형식이 예상과 다릅니다.')
                continue
            t = t[['종목코드', '회사명', '업종'] +
                  (['주요제품'] if '주요제품' in t.columns else [])].copy()
            t['code'] = t['종목코드'].apply(lambda v: str(int(v)).zfill(6))
            t = t.rename(columns={'업종': 'sector', '주요제품': 'product',
                                  '회사명': 'kname'})
            if 'product' not in t.columns:
                t['product'] = ''
            frames.append(t[['code', 'sector', 'product']])
            if verbose:
                print(f'   {mkt}: {len(t):,}종목 (KRX 표준산업분류)')
            time.sleep(self.delay)
        if not frames:
            return pd.DataFrame(columns=['code', 'sector', 'product'])
        df = pd.concat(frames, ignore_index=True).drop_duplicates('code')
        df['sector'] = df['sector'].fillna('-').astype(str).str.strip()
        df['product'] = df['product'].fillna('').astype(str).str.strip()
        return df.reset_index(drop=True)


def pick(prefer: str = 'auto', delay: float = 0.15, verbose: bool = True):
    """쓸 수 있는 공급원을 골라 돌려줍니다."""
    if prefer == 'pykrx':
        return Pykrx(delay)
    if prefer == 'naver':
        return Naver(delay)
    if Pykrx.available():
        if verbose:
            print('[공급원] KRX 계정이 확인되어 pykrx 를 사용합니다.')
        return Pykrx(delay)
    if verbose:
        print('[공급원] 네이버 금융을 사용합니다. (KRX는 2026년부터 로그인 필수)')
    return Naver(delay)
