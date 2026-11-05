#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
미국 시장 미너비니 스크리너 — 실행 파일

    python3 run_us.py              평소 실행 (어제 종가 채우고 → 판정 → 사이트로)
    python3 run_us.py --backfill   2년치 주가를 처음부터 쌓습니다 (약 110분, 한 번만)
    python3 run_us.py --details    시가총액·업종을 받습니다 (하룻밤, 30일에 한 번)
    python3 run_us.py --no-fetch   인터넷 호출 없이 저장된 것만으로 계산
    python3 run_us.py --no-push    사이트로 보내지 않고 화면에만 출력

한국판(run.py)과 다른 점은 세 가지뿐입니다.
  · 주가를 '날짜별 전 종목' 으로 받습니다 (종목마다 받지 않습니다)
  · 외국인·기관 수급이 없습니다 — 미국에는 그런 공시 자체가 없습니다
  · 분기 실적이 없습니다 — 무료로 가져올 만한 출처가 없습니다

8개 조건 · RS · VCP · 매집(UD비율) 판정은 한국판 코드(rules.py)를 그대로 씁니다.
그 코드는 '날짜 · 종목 · 시가고가저가종가 · 거래량' 표만 받으면 되지,
그게 한국인지 미국인지는 모르기 때문입니다.
"""
from __future__ import annotations
import sys
import os
import json
import gzip
import copy
import time
import datetime as dt
import urllib.request
import urllib.error
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from screener import config, rules, report, watchlist          # noqa: E402
from screener import us_data, us_details                       # noqa: E402


def log(msg: str):
    print(f'[{dt.datetime.now():%H:%M:%S}] {msg}', flush=True)


# ─────────────────────── 미국용 기준값 ───────────────────────
def us_settings():
    """
    한국 설정을 복사해서 미국에 맞는 값만 바꿉니다.

    바뀌는 것은 '얼마 미만을 버릴지' 두 개뿐입니다.
    8조건 자체(150·200일선, 52주 고저, RS 70)는 미너비니 원문 그대로,
    한국과 똑같이 갑니다.
    """
    s = copy.deepcopy(config.load())
    s.min_price = float(os.environ.get('US_MIN_PRICE', '5'))          # $5 미만 제외
    s.min_trade_value = float(os.environ.get('US_MIN_VALUE', '2000000'))
    #                                     ↑ 20일 평균 거래대금 200만 달러 미만 제외
    s.use_fundamentals = False        # 미국은 무료 실적 출처가 없습니다
    s.use_supply = False              # 미국에는 외국인·기관 순매수 공시가 없습니다
    s.exclude_spac = False            # 종목 '종류(type)' 로 이미 걸러냅니다
    s.exclude_etf_etn = False         # 〃
    s.markets = ['US']
    return s


# 보통주와 미국주식예탁증서(ADR)만 봅니다.
#  ETF · 펀드 · 우선주 · 워런트 · 신주인수권은 미너비니 대상이 아닙니다.
KEEP_TYPES = {'CS', 'ADRC'}


def universe(ohlcv: pd.DataFrame, tickers: pd.DataFrame, s) -> list[str]:
    """
    상세 자료(시가총액·업종)를 받을 종목을 고릅니다.

    5,000종목을 다 받으면 17시간이 걸립니다. 그런데 그중 절반 이상은
    하루 거래대금이 몇십만 달러뿐이라 미너비니 대상이 될 수 없습니다.
    먼저 '살아 있는 종목' 만 추려서 시간을 4분의 1로 줄입니다.
    """
    last = ohlcv['date'].max()
    recent = ohlcv[ohlcv['date'] > last - pd.Timedelta(days=40)]
    g = recent.groupby('code').agg(px=('close', 'last'), val=('value', 'mean'),
                                   n=('close', 'size'))
    keep = g[(g['px'] >= s.min_price) & (g['val'] >= s.min_trade_value) & (g['n'] >= 15)]
    codes = sorted(set(keep.index) & set(tickers['code']))
    return codes


def _stale(path: str, hours: int) -> bool:
    """파일이 없거나 hours 시간보다 오래됐으면 True."""
    try:
        return (time.time() - os.path.getmtime(path)) > hours * 3600
    except OSError:
        return True


def build_tickers() -> pd.DataFrame:
    # 2026-08-21: 7일마다 받던 것을 매일 받습니다.
    #  Polygon 은 active=true 인 종목만 주므로, 이 목록이 오래되면
    #  상장폐지된 종목이 최대 일주일간 남아 있게 됩니다.
    #  하루 한 번 호출은 유료 등급에서 부담이 없습니다.
    t = us_data.update_tickers(force=_stale(us_data.TICKERS, hours=20))
    keep = t[t['type'].isin(KEEP_TYPES)].copy()
    log(f'종목 {len(t):,}개 중 보통주·ADR {len(keep):,}개')
    return keep[['code', 'name', 'market']]


# ─────────────────────── 사이트로 보내기 ───────────────────────
def _no_nan(o):
    """
    파이썬의 NaN·Infinity 를 None 으로 바꿉니다.

    2026-08-19 사고: 발행주식수가 들어오면서 '시가총액' 칸이 생겼는데,
    값이 빈 종목은 NaN 이 됩니다. json.dumps 는 그것을 NaN 이라고 그대로 쓰는데
    JSON 규격에는 없는 글자라 사이트의 JSON.parse 가 거부합니다
    → HTTP 400 Bad Request. 자료가 제대로 들어온 순간 터졌습니다.
    """
    if isinstance(o, float):
        return None if (o != o or o in (float('inf'), float('-inf'))) else o
    if isinstance(o, dict):
        return {k: _no_nan(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_no_nan(v) for v in o]
    return o


def push(payload: dict) -> bool:
    site = os.environ.get('SITE_URL', '').rstrip('/')
    key = os.environ.get('SCREENER_KEY', '')
    if not site or not key:
        log('SITE_URL / SCREENER_KEY 가 없어 전송을 건너뜁니다')
        return False

    # allow_nan=False 로 한 번 더 막습니다 — 남아 있으면 보내기 전에 여기서 걸립니다.
    body = json.dumps(_no_nan(payload), ensure_ascii=False, allow_nan=False).encode('utf-8')
    log(f'전송 — {len(payload["result"]):,}종목 / {len(body) / 1024 / 1024:.2f} MB')
    req = urllib.request.Request(
        f'{site}/api/screener/upload', data=gzip.compress(body), method='POST',
        headers={'Content-Type': 'application/json; charset=utf-8',
                 'Content-Encoding': 'gzip', 'x-screener-key': key})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            log('전송 완료 — ' + r.read().decode()[:300])
        return True
    except urllib.error.HTTPError as e:
        # 사이트가 왜 거부했는지 그대로 남깁니다.
        #  'HTTP Error 400' 만 보고는 짐작밖에 할 수 없습니다.
        try:
            why = e.read().decode('utf-8', 'replace')[:400]
        except Exception:
            why = ''
        log(f'[오류] 전송 실패 HTTP {e.code} — {why}')
        return False
    except Exception as e:
        log(f'[오류] 전송 실패({e})')
        return False


def main(argv) -> int:
    t0 = time.time()
    s = us_settings()

    # ── 2년치 처음 쌓기 ─────────────────────────────────────
    if '--backfill' in argv:
        log('2년치 주가를 쌓습니다. 오래 걸리니 그냥 두세요.')
        us_data.update_tickers(force=True)
        us_data.update_ohlcv(years=2.0)
        log(f'백필 완료 ({(time.time() - t0) / 60:.0f}분)')
        if '--then-details' not in argv and '--then-run' not in argv:
            return 0

    if '--no-fetch' not in argv and '--backfill' not in argv:
        # 평소 실행 — 아직 못 받은 날짜(보통 어제 하루)만 채웁니다
        us_data.update_ohlcv(years=2.0)

    log('저장해 둔 주가를 읽습니다')
    ohlcv = us_data.load(years=2.0)
    log(f'{ohlcv["code"].nunique():,}종목 / {ohlcv["date"].nunique()}거래일')

    # ── 장중이면 '지금 이 순간의 봉' 을 얹습니다 (2026-08-24) ──────────
    #  얹고 나면 그 뒤의 모든 계산 — 8조건 · RS · 피벗 · 점수 — 이
    #  지금 값으로 돌아갑니다. 화면의 현재가도 마찬가지입니다.
    #
    #  전에는 이것이 없어서, 장중에 돌려도 어제 종가가 그대로 떴습니다.
    #  ("스크리너를 돌렸는데 현재가가 안 바뀐다" 의 두 번째 원인입니다.
    #   첫 번째는 서머타임을 안 지켜 하루가 밀린 것이었고, 그건 따로 고쳤습니다.)
    #
    #  --no-fetch 로 돌릴 때는 인터넷을 안 쓰기로 한 것이니 건너뜁니다.
    LIVE = False
    if '--no-fetch' not in argv and os.environ.get('US_LIVE', '1') != '0':
        ohlcv, LIVE, why = us_data.with_live(ohlcv)
        log(f'   · {why}')

    tickers = build_tickers()
    ohlcv = ohlcv[ohlcv['code'].isin(set(tickers['code']))]

    uni = universe(ohlcv, tickers, s)
    log(f'거래가 활발한 {len(uni):,}종목을 대상으로 합니다')

    # ── 시가총액 · 업종 ─────────────────────────────────────
    last_px = (ohlcv.sort_values('date').groupby('code')['close'].last().to_dict())
    if '--details' in argv or '--then-details' in argv:
        us_details.update(uni, price_now=last_px)
    det = us_details.load()
    if len(det):
        det = us_details.with_marcap(det, last_px)
        got = int(det['marcap'].notna().sum())
        log(f'시가총액 확보 {got:,}종목 / 업종 {det["sector"].nunique()}개')
    else:
        log('상세 자료가 아직 없습니다 — 시가총액·업종 없이 진행합니다')
        log('   (python3 run_us.py --details 로 하룻밤 받아 두시면 됩니다)')
        det = pd.DataFrame(columns=['code', 'sector', 'sic', 'marcap',
                                    'shares', 'list_date'])

    tickers = tickers.merge(det[['code', 'marcap']], on='code', how='left')
    sectors = det[['code', 'sector']].copy() if len(det) else \
        pd.DataFrame(columns=['code', 'sector'])
    sectors['product'] = ''
    sectors['출처'] = 'SIC'

    # ── 판정 ────────────────────────────────────────────────
    log('8개 조건을 판정합니다')
    df = rules.screen(ohlcv, tickers, sectors, s)
    # 히트맵을 핀비즈처럼 2단으로 그리려고 대분류를 함께 보냅니다 (2026-08-30).
    #  세부 업종이 130가지라 그대로 그리면 칸이 잘아 이름이 안 보입니다.
    #  큰 칸 = 대분류(11갈래) · 그 안의 작은 칸 = 종목.
    from screener.us_sectors import big_of as _big
    df['대분류'] = df['업종'].map(_big) if '업종' in df.columns else '기타'
    stats = rules.summarize(df)
    log(f'8조건 통과 {stats["통과"]}종목 / 7개 통과 {stats["7개통과"]}종목')

    # 미국에 없는 항목은 빈칸이 아니라 '해당없음' 으로 적어 둡니다.
    #  빈칸이면 화면에서 '아직 못 받았나?' 로 오해합니다.
    for c in ('외국인20일', '기관20일', '외국인지분율',
              'EPS증가율', '매출증가율', 'EPS가속'):
        df[c] = None
    df['수급판정'] = '해당없음'
    df['실적판정'] = '해당없음'
    df['실적출처'] = '-'

    # ── 실적 (SEC) ──────────────────────────────────────────
    #  tools/fetch_sec.py 가 만들어 둔 것을 붙입니다. 없으면 그냥 넘어갑니다.
    #  전 종목을 채우지는 못합니다(태그·결산월이 회사마다 달라서).
    #  못 구한 종목은 '해당없음' 그대로 둡니다 — 모르는 것을 아는 척하지 않습니다.
    fin_path = os.path.join(config.DATA_DIR, 'us_fin.parquet')
    if os.path.exists(fin_path):
        try:
            fin = pd.read_parquet(fin_path)
            keep = [c for c in ('code', 'EPS증가율', '매출증가율', 'EPS당분기',
                                'EPS전년', '매출당분기', '매출전년', '실적분기',
                                '실적분기목록', '매출분기목록', 'EPS분기목록',
                                '매출성장목록', 'EPS성장목록',
                                'EPS출처', 'EPS상태')
                    if c in fin.columns]
            fin = fin[keep].rename(columns={'code': '코드'})
            df = df.drop(columns=[c for c in fin.columns if c != '코드' and c in df.columns])
            df = df.merge(fin, on='코드', how='left')
            hit = df['매출증가율'].notna() | df['EPS증가율'].notna()
            if 'EPS상태' in df.columns:
                hit = hit | df['EPS상태'].fillna('').ne('')
            df.loc[hit, '실적출처'] = 'SEC'
            # 실적판정 — 한국과 같은 기준(EPS·매출 둘 다 문턱을 넘었나)
            e_min = float(getattr(s, 'eps_growth_min', 0.20))
            v_min = float(getattr(s, 'sales_growth_min', 0.15))
            ok = (df['EPS증가율'] >= e_min) & (df['매출증가율'] >= v_min)
            df.loc[hit, '실적판정'] = '미달'
            df.loc[hit & ok, '실적판정'] = '충족'
            # 회사마다 결산월이 달라 분기가 제각각입니다 — 많은 순으로 몇 개만 적습니다.
            q = ''
            if '실적분기' in df.columns:
                vc = df.loc[hit, '실적분기'].value_counts().head(3)
                q = ' '.join(f'{k}:{v:,}' for k, v in vc.items())
            log(f'실적(SEC) {int(hit.sum()):,}종목 붙임 [{q}] — '
                f'충족 {int((df["실적판정"] == "충족").sum()):,}종목')
        except Exception as e:
            log(f'   · 실적 붙이기 실패({e}) — 실적 없이 진행합니다')
    else:
        log('실적 자료가 없습니다 (tools/fetch_sec.py 를 한 번 돌려 두세요)')

    # ── 편입(잔류일) ─────────────────────────────────────────
    #  2026-08-20: 미국은 이걸 아예 안 돌리고 있었습니다. 한국만 돌고 있었어요.
    #  기준 시각이 다릅니다 — 한국은 오후 4시, 미국은 **오전 7시**입니다.
    #  오전 7시(KST)가 미국 동부 오후 5시라 전날 종가가 확정되는 시점이고,
    #  그때 정해진 값을 밤 10시 30분 실행이 흔들지 않도록 같은 날 재갱신은 막습니다.
    #  기록 파일도 한국 것과 섞이면 안 되니 따로 둡니다.
    report.STREAK = os.path.join(config.DATA_DIR, 'us_streak.csv')
    report.CLOSING_HOUR = int(os.environ.get('US_CLOSING_HOUR', '7'))
    df = report.track_streak(df)

    # 종합점수 — 미국 전용 배점을 씁니다.
    #  (잔류일이 점수에 들어가므로 track_streak 뒤에 불러야 합니다)
    #  한국 배점을 그대로 쓰면 실적·수급 45점이 '중립' 으로 고정되어
    #  최고점이 77점에 갇힙니다(90점·80점 뱃지가 영영 빔).
    df = rules.add_score_us(df, s)
    if len(df):
        log(f'점수 — 90점 이상 {int((df["종합점수"] >= 90).sum())}종목 / '
            f'80점 이상 {int((df["종합점수"] >= 80).sum())}종목')

    df = watchlist.attach(df, verbose=False)

    # '새로 통과한 종목' 기록은 한국 것과 섞이면 안 됩니다 — 파일을 나눕니다
    report.HISTORY = os.path.join(config.DATA_DIR, 'us_history.csv')
    df = report.mark_new(df)

    # 부적합(저가주·거래대금 부족·상장 1년 미만)은 화면 목록에서 빼듯이
    #  터미널 출력에서도 뺍니다 (2026-08-26). 안 그러면 거래대금 $0.4M 짜리가
    #  RS 99 로 맨 위에 올라옵니다 — 살 수 없는 종목입니다.
    fit = df[df['부적합사유'].fillna('') == ''] if '부적합사유' in df.columns else df
    passed = fit[fit['판정'] == '통과'].sort_values('RS', ascending=False)
    print()
    print(f'■ 미국 스크리닝 {dt.datetime.now():%Y-%m-%d %H:%M}')
    print(f'  {stats["전체"]:,}종목 중 8조건 통과 {len(passed)}종목 '
          f'(시장 온도 {stats["시장온도"]}%)')
    for _, r in passed.head(20).iterrows():
        print(f'   RS {int(r["RS"]):>3}  {r["코드"]:<6} {str(r["종목명"])[:26]:<26}'
              f' {str(r["업종"])[:12]:<12} 피벗대비 {r["피벗대비이격"] * 100:+6.1f}%'
              f'  {r["수축_추세"]}')
    print()

    # ── 히트맵용 요약 ────────────────────────────────────────
    #  사이트 홈의 US 히트맵은 이 표로 그립니다. 상자 크기 = 시가총액.
    heat = []
    if len(det):
        d = df[['코드', '종목명', '현재가', '업종', '시가총액']].copy()
        d = d.merge(ohlcv[ohlcv['date'] == ohlcv['date'].max()][['code', 'open', 'close']]
                    .rename(columns={'code': '코드'}), on='코드', how='left')
        d = d[d['시가총액'].notna() & (d['시가총액'] > 0)]
        d = d.sort_values('시가총액', ascending=False).head(600)
        for r in d.to_dict('records'):
            o, c = r.get('open'), r.get('close')
            heat.append({
                'sym': r['코드'],
                'name': str(r.get('종목명') or '')[:60],
                'c': round(float(c), 2) if c else None,
                'rate': round((c - o) / o * 100, 2) if o and c else None,
                'marcap': float(r['시가총액']),
                'sector': r['업종'] or '기타',
            })
        log(f'히트맵 {len(heat)}종목 (시가총액 상위)')

    payload = {
        'market': 'US',
        'stamp': (dt.datetime.now().strftime('%Y-%m-%d %H:%M')
                  + (' 미국 스크리닝(장중 실시간)' if LIVE else ' 미국 스크리닝')),
        'result': report._rows_for_web(df, s),
        'heat': heat,
        'source': os.environ.get('RUN_SOURCE', 'us'),
    }
    out = os.path.join(config.OUT_DIR, 'us_payload.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False)
    log(f'저장 — {out}')

    if '--no-push' not in argv:
        push(payload)

    log(f'끝 ({time.time() - t0:.0f}초)')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except KeyboardInterrupt:
        print('\n중단했습니다. 다시 실행하면 이어서 합니다.')
        sys.exit(1)
