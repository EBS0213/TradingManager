# -*- coding: utf-8 -*-
"""
실적(EPS·매출) 확인 — 표에 그려지는 종목에 대해서만 실행합니다.

네이버 금융에서 분기 매출·EPS 를 받아 작년 같은 분기 대비 증가율을 냅니다.

━━ 2026-09-14 두 가지를 고쳤습니다 ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

① 받아오는 길을 바꿨습니다 (그동안 실적이 통째로 비어 있었습니다)
   전에는 finance.naver.com 의 HTML 에서 '주요재무정보' 표를 긁었습니다.
   네이버가 그 화면을 **브라우저에서 그리는 방식**으로 바꾸면서, 받아 온
   HTML 에는 표가 아예 없습니다 (2026-09-14 확인 — 005930·000660·131290
   모두 0건). pd.read_html 이 'No tables found' 로 죽고 except 가 조용히
   삼켜서, 모든 종목이 '실적?' 로 나오고 있었습니다.
   이제 네이버가 그 화면을 그릴 때 부르는 JSON 을 직접 부릅니다.
     https://m.stock.naver.com/api/stock/{코드}/finance/quarter
   숫자가 표가 아니라 값으로 오니 글자 파싱도 사라졌습니다.

② 최근 4분기를 함께 담습니다 (Jun 요청)
   한 분기만 보면 "이번에 좋았다" 는 알아도 **"좋아지는 중인가, 꺾이는
   중인가"** 를 알 수 없습니다. 미너비니가 보는 것은 한 번의 호실적이
   아니라 분기마다 커지는 증가율입니다.

   ※ 네이버는 **확정 분기를 5개까지만** 내줍니다 (추정치 1개는 버립니다).
     4분기 각각을 전년 동기와 견주려면 8분기가 필요합니다. 그래서
     받아 온 분기를 data/fin_hist.json 에 **쌓아 둡니다.** 한 번 본 분기는
     지우지 않으므로, 분기가 지날수록 전년 동기 칸이 저절로 채워집니다.
     쌓이기 전에는 전년비를 낼 수 있는 분기만 채우고 나머지는 비워 둡니다
     (없는 값을 지어내지 않습니다 — 화면이 '-' 로 보여 줍니다).

   보내는 칸 (막대 | 로 이어 붙인 한 칸씩. 최신이 앞):
     실적분기목록  2026.06|2026.03|2025.12|2025.09
     매출분기목록  1714995|1338734|938374|860617      (억원)
     EPS분기목록   10718|6993|2864|1783               (원)
     매출성장목록  1.3|||                             (전년 같은 분기 대비)
     EPS성장목록   13.62|||
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

주의: 무료로 받아오는 자료라 종목에 따라 값이 비어 있을 수 있습니다.
      그런 종목은 '실적?' 으로 표시하고 탈락시키지 않습니다(설정으로 변경 가능).
"""
from __future__ import annotations
import os
import re
import json
import time
import concurrent.futures as cf
import pandas as pd

from . import config

# 네이버가 화면을 그릴 때 부르는 자리입니다. 확정 5분기 + 추정 1분기를 줍니다.
API = 'https://m.stock.naver.com/api/stock/{code}/finance/quarter'
HEADERS = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                         'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
           'Referer': 'https://m.stock.naver.com/'}

# 받아 온 분기를 쌓아 두는 곳. 네이버가 5분기만 주기 때문에 필요합니다.
HIST = os.path.join(config.DATA_DIR, 'fin_hist.json')
HIST_KEEP = 16                     # 종목당 보관할 분기 수 (4년)

QN = 4                             # 화면에 보여줄 분기 수

_QKEY = re.compile(r'^\d{4}(03|06|09|12)$')

# 표에 들어가는 실적 칸 — 여기 한 곳만 고치면 아래가 모두 따라옵니다.
FIN_COLS = ['EPS증가율', '매출증가율', 'EPS가속', '실적출처',
            'EPS당분기', 'EPS전년', '매출당분기', '매출전년',
            '실적분기목록', '매출분기목록', 'EPS분기목록',
            '매출성장목록', 'EPS성장목록']


def _num(v):
    """'1,714,995' · '-' · None → 숫자 또는 None"""
    s = re.sub(r'[,\s]', '', str(v if v is not None else ''))
    if not s or s in ('-', '_', 'N/A'):
        return None
    neg = s.startswith('(') and s.endswith(')')        # (1,234) = 음수 표기
    s = s.strip('()')
    try:
        n = float(s)
    except ValueError:
        return None
    return -n if neg else n


def _join(vals, nd: int = 9) -> str:
    """숫자 목록을 막대(|)로. 없는 자리는 빈칸 — '1234||1100' 처럼.

    %g 로 적습니다. 매출은 억원 단위라 소수점이 필요 없는데 .2f 로 적으면
    '1714995.00' 처럼 한 종목에 쓸데없는 글자가 붙습니다.
    자릿수(nd)를 9 로 두는 이유: 삼성전자 분기 매출이 171만(억원)이라
    6자리로 적으면 1714995 가 1.715e+06(=1715000)으로 반올림됩니다.
    증가율처럼 자리가 필요 없는 값은 부르는 쪽에서 nd 를 줄여 씁니다.
    """
    out = []
    for v in vals:
        if v is None:
            out.append('')
        else:
            try:
                out.append(f'{float(v):.{nd}g}')
            except (TypeError, ValueError):
                out.append('')
    return '|'.join(out)


def _yoy_key(k: str) -> str:
    """'202606' → '202506' (작년 같은 분기)"""
    return f'{int(k[:4]) - 1}{k[4:]}'


def _label(k: str) -> str:
    """'202606' → '2026.06' (화면·실적출처에 적는 이름)"""
    return f'{k[:4]}.{k[4:]}'


def _growth(cur, prev):
    if cur is None or prev is None:
        return None
    if prev == 0:
        return None
    if prev < 0:                       # 적자 → 흑자는 증가율 계산이 무의미
        return 999.0 if cur > 0 else None
    return cur / prev - 1


# ─────────────────────── 받아오기 ───────────────────────
def fetch_quarters(code: str, delay: float = 0.25) -> dict:
    """한 종목의 확정 분기. {'202606': {'매출': 1714995.0, 'EPS': 10718.0}, …}

    추정치(isConsensus = 'Y') 는 버립니다 — 아직 일어나지 않은 일입니다.
    """
    out = {}
    try:
        import requests
        j = requests.get(API.format(code=code), headers=HEADERS, timeout=10).json()
        fi = j.get('financeInfo') or {}
        keys = [str(t.get('key') or '') for t in (fi.get('trTitleList') or [])
                if str(t.get('isConsensus') or '').upper() != 'Y']
        keys = [k for k in keys if _QKEY.match(k)]
        if not keys:
            return out
        rows = {str(r.get('title') or ''): (r.get('columns') or {})
                for r in (fi.get('rowList') or [])}
        sales = rows.get('매출액') or {}
        eps = rows.get('EPS') or {}
        for k in keys:
            s = _num((sales.get(k) or {}).get('value'))
            e = _num((eps.get(k) or {}).get('value'))
            if s is None and e is None:
                continue
            out[k] = {'매출': s, 'EPS': e}
    except Exception:
        pass
    finally:
        time.sleep(delay)
    return out


# ─────────────────────── 쌓아 두기 ───────────────────────
#  네이버는 5분기만 줍니다. 4분기 각각을 전년 동기와 견주려면 8분기가 필요해서
#  한 번 본 분기를 파일에 남깁니다. 실을 여러 개 쓰는 구간이 끝난 뒤,
#  한 곳에서만 읽고 씁니다 (여러 실이 같은 파일에 쓰면 깨집니다).
def _hist_load() -> dict:
    try:
        with open(HIST, encoding='utf-8') as f:
            d = json.load(f)
        return d if isinstance(d, dict) else {}
    except Exception:
        return {}


def _hist_save(store: dict) -> None:
    try:
        os.makedirs(os.path.dirname(HIST), exist_ok=True)
        tmp = HIST + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(store, f, ensure_ascii=False)
        os.replace(tmp, HIST)          # 쓰다 만 파일이 남지 않도록
    except Exception:
        pass


def _merge(old: dict, new: dict) -> dict:
    """쌓아 둔 것 위에 새로 받은 것을 덮습니다 (새 값이 우선).

    옛 분기는 지우지 않습니다 — 그게 이 파일을 두는 이유입니다.
    다만 종목당 HIST_KEEP 분기까지만 남깁니다.
    """
    out = dict(old or {})
    for k, v in (new or {}).items():
        cur = dict(out.get(k) or {})
        for kk in ('매출', 'EPS'):
            if v.get(kk) is not None:
                cur[kk] = v[kk]
        out[k] = cur
    return {k: out[k] for k in sorted(out)[-HIST_KEEP:]}


# ─────────────────────── 한 줄 만들기 ───────────────────────
def _row(code: str, q: dict) -> dict:
    res = {c: None for c in FIN_COLS}
    res['코드'] = code
    res['실적출처'] = '없음'
    if not q:
        return res

    keys = sorted(q)                                   # 오래된 → 최신
    def v(k, kk):
        return (q.get(k) or {}).get(kk)

    # 매출과 EPS 가 둘 다 있는 마지막 분기 = 가장 최근 확정 실적
    filled = [k for k in keys if v(k, '매출') is not None and v(k, 'EPS') is not None]
    if not filled:
        return res
    cur = filled[-1]
    yoy = _yoy_key(cur)

    res['실적출처'] = f'네이버 {_label(cur)}'
    res['매출당분기'] = v(cur, '매출')                  # 억원
    res['EPS당분기'] = v(cur, 'EPS')                    # 원
    res['매출전년'] = v(yoy, '매출')
    res['EPS전년'] = v(yoy, 'EPS')
    res['매출증가율'] = _growth(res['매출당분기'], res['매출전년'])
    res['EPS증가율'] = _growth(res['EPS당분기'], res['EPS전년'])

    # ── 최근 4분기 ────────────────────────────────────────
    #  전년 동기가 아직 안 쌓인 분기는 증가율만 비워 둡니다 (값은 보여 줍니다).
    recent = filled[-QN:][::-1]                         # 최신이 앞
    res['실적분기목록'] = '|'.join(_label(k) for k in recent)
    res['매출분기목록'] = _join([v(k, '매출') for k in recent])
    res['EPS분기목록'] = _join([v(k, 'EPS') for k in recent])
    sg = [_growth(v(k, '매출'), v(_yoy_key(k), '매출')) for k in recent]
    eg = [_growth(v(k, 'EPS'), v(_yoy_key(k), 'EPS')) for k in recent]
    res['매출성장목록'] = _join(sg, 4)
    res['EPS성장목록'] = _join(eg, 4)

    # 증가율이 분기마다 커지는지 (가속) — 위에서 낸 분기별 증가율을 그대로 씁니다
    gs = [g for g in eg[:3] if g is not None]
    if len(gs) == 3:
        res['EPS가속'] = bool(gs[0] > gs[1] > gs[2])
    return res


def fetch_one(code: str, delay: float = 0.25) -> dict:
    """한 종목만 확인할 때 (쌓아 둔 것과 합쳐서 돌려줍니다)."""
    return _row(code, _merge(_hist_load().get(code) or {}, fetch_quarters(code, delay)))


def fetch_many(codes: list[str], s, verbose: bool = True) -> pd.DataFrame:
    if not codes:
        return pd.DataFrame(columns=['코드', *FIN_COLS])
    if verbose:
        print(f'[실적] {len(codes)}종목의 분기 실적을 확인합니다...')

    got = {}
    with cf.ThreadPoolExecutor(max_workers=s.max_workers) as ex:
        for code, q in zip(codes, ex.map(
                lambda c: fetch_quarters(c, s.request_delay), codes)):
            got[code] = q

    # 실이 모두 끝난 뒤에 한 곳에서만 파일을 읽고 씁니다
    store = _hist_load()
    for code, q in got.items():
        if q:
            store[code] = _merge(store.get(code) or {}, q)
    _hist_save(store)

    rows = [_row(code, store.get(code) or {}) for code in codes]
    df = pd.DataFrame(rows)
    if verbose:
        ok = int(df['실적출처'].ne('없음').sum())
        yoy = int(df['매출증가율'].notna().sum())
        print(f'[실적] {ok}/{len(df)}종목 확인 완료 (전년 동기까지 있는 종목 {yoy})')
        if ok and not yoy:
            print('[실적] 전년 같은 분기가 아직 없습니다 — 분기가 지나면 '
                  f'{os.path.basename(HIST)} 에 쌓여 저절로 채워집니다.')
    return df


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
    """표에 그려지는 종목에 실적을 붙입니다."""
    for c in (*FIN_COLS, '실적판정'):
        if c not in df.columns:
            df[c] = None
    if not s.use_fundamentals:
        df['실적판정'] = '미확인'
        return df

    targets = _targets(df, s)
    if not targets:
        df['실적판정'] = '-'
        return df

    fn = fetch_many(targets, s, verbose)
    df = df.drop(columns=list(FIN_COLS)).merge(fn, on='코드', how='left')

    # 실적을 확인한 종목이면 통과 여부와 상관없이 판정을 적습니다.
    #  (예전에는 8조건 통과 종목만 적어서 7개·6개 통과 종목이 '-' 로 비었습니다)
    seen = set(targets)

    def judge(r):
        if r['코드'] not in seen:
            return '-'
        e, v = r['EPS증가율'], r['매출증가율']
        if e is None or v is None or pd.isna(e) or pd.isna(v):
            return '실적?'
        if e >= s.eps_growth_min and v >= s.sales_growth_min:
            return '충족'
        return '미달'

    df['실적판정'] = df.apply(judge, axis=1)

    if s.fundamentals_as_filter:
        # 탈락시키는 것은 8조건을 다 통과한 종목뿐입니다.
        # 6·7개 통과 종목은 표기만 하고 그대로 둡니다.
        cand = df['판정'] == '통과'
        bad = df['실적판정'] == '미달'
        unknown = df['실적판정'] == '실적?'
        drop = cand & (bad | (unknown & ~s.pass_when_unknown))
        df.loc[drop, '판정'] = '실적탈락'
        if verbose:
            print(f'[실적] {int(drop.sum())}종목이 실적 기준에서 탈락했습니다.')
    return df
