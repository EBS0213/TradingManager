# -*- coding: utf-8 -*-
"""
DART 재무제표 읽어오기 — 리포트 자동제작의 1단계.

무엇을 가져오나
  분기별 손익계산서 · 재무상태표 · 현금흐름표에서 '리포트에 실제로 쓰는 것' 만
  추립니다. DART 는 계정을 수백 개 내려주는데 그걸 다 들고 있어 봐야
  글을 쓸 때 쓰지 않습니다.

    손익  매출액 · 영업이익 · 당기순이익
    재무  자산총계 · 부채총계 · 자본총계 · 현금성자산 · 차입금
    현금  영업활동현금흐름 · 투자활동 · 재무활동

  여기서 계산해 두는 것
    전년 동기 대비 증가율(YoY) · 영업이익률 · 순이익률
    ROE · 부채비율 · 현금흐름 대 이익 비율(이익의 질)

왜 계정명을 여러 개 적어 두나
  회사마다 계정 이름이 조금씩 다릅니다. '매출액' 을 '수익(매출액)' 이나
  '영업수익' 으로 적는 곳이 있습니다. 그래서 후보를 여러 개 두고
  먼저 걸리는 것을 씁니다.

주의
  · 분기 보고서의 '당기금액' 은 회사마다 누적치일 때가 있습니다.
    3분기보고서의 매출이 1~9월 누적인지 7~9월 3개월인지 구별해서 담습니다.
  · 연결(CFS)을 먼저 보고, 없으면 개별(OFS)로 물러섭니다.
    지주회사·해외법인이 있는 회사는 연결이 실제 규모입니다.
"""
from __future__ import annotations
import os
import re
import json
import time
import datetime as dt
import urllib.request
import urllib.error

API = 'https://opendart.fss.or.kr/api/fnlttSinglAcntAll.json'

# 보고서 코드 → (분기 번호, 이름)
REPORTS = [
    ('11013', 1, '1분기'),
    ('11012', 2, '반기'),
    ('11014', 3, '3분기'),
    ('11011', 4, '사업'),
]

# 찾을 계정 — 앞에 적은 이름부터 찾습니다
WANT = {
    '매출액':       ['매출액', '수익(매출액)', '영업수익', '매출', '수익'],
    '매출원가':     ['매출원가'],
    '영업이익':     ['영업이익', '영업이익(손실)', '영업손실'],
    '당기순이익':   ['당기순이익', '당기순이익(손실)', '분기순이익', '반기순이익',
                    '당기순손실'],
    '자산총계':     ['자산총계'],
    '부채총계':     ['부채총계'],
    '자본총계':     ['자본총계'],
    '현금성자산':   ['현금및현금성자산'],
    '영업현금흐름': ['영업활동현금흐름', '영업활동으로인한현금흐름',
                    '영업활동으로 인한 현금흐름'],
    '투자현금흐름': ['투자활동현금흐름', '투자활동으로인한현금흐름'],
    '재무현금흐름': ['재무활동현금흐름', '재무활동으로인한현금흐름'],
}

# 어느 표에서 찾을지 (엉뚱한 표의 같은 이름을 집지 않도록)
SJ = {
    '매출액': 'IS', '매출원가': 'IS', '영업이익': 'IS', '당기순이익': 'IS',
    '자산총계': 'BS', '부채총계': 'BS', '자본총계': 'BS', '현금성자산': 'BS',
    '영업현금흐름': 'CF', '투자현금흐름': 'CF', '재무현금흐름': 'CF',
}


def key() -> str:
    k = os.environ.get('DART_KEY')
    if not k:
        raise SystemExit('[오류] DART_KEY 환경변수가 필요합니다.')
    return k


def _num(v):
    """'1,234,567' · '-1,234' · '' → 숫자 또는 None"""
    s = re.sub(r'[,\s]', '', str(v or ''))
    if not s or s in ('-', '_'):
        return None
    neg = s.startswith('(') and s.endswith(')')     # (1,234) = 음수 표기
    s = s.strip('()')
    try:
        n = float(s)
    except ValueError:
        return None
    return -n if neg else n


def _norm(s) -> str:
    return re.sub(r'\s', '', str(s or ''))


def fetch_raw(corp_code: str, year: int, reprt: str, fs: str = 'CFS',
              timeout: int = 15) -> list | None:
    """한 회사·한 분기의 전체 재무제표. 없으면 None."""
    url = (f'{API}?crtfc_key={key()}&corp_code={corp_code}'
           f'&bsns_year={year}&reprt_code={reprt}&fs_div={fs}')
    req = urllib.request.Request(url, headers={'User-Agent': 'tm2026/1.0'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        j = json.loads(r.read().decode())
    st = j.get('status')
    if st == '013':           # 조회된 자료 없음
        return None
    if st != '000':
        raise RuntimeError(f'DART {st} {j.get("message", "")}')
    return j.get('list') or []


def pick(rows: list) -> dict:
    """전체 계정에서 우리가 쓸 것만 추립니다."""
    out = {}
    for want, names in WANT.items():
        sj = SJ.get(want)
        found = None
        for nm in names:
            target = _norm(nm)
            for x in rows:
                if sj and not str(x.get('sj_div', '')).startswith(sj):
                    continue
                if _norm(x.get('account_nm')) != target:
                    continue
                v = _num(x.get('thstrm_amount'))
                if v is not None:
                    found = v
                    break
            if found is not None:
                break
        out[want] = found
    return out


def quarter(corp_code: str, year: int, reprt: str) -> dict | None:
    """
    한 분기. 연결이 없으면 개별로 물러섭니다.
    돌려주는 값에 fs 를 함께 담아 어느 쪽을 썼는지 남깁니다.
    """
    for fs in ('CFS', 'OFS'):
        try:
            rows = fetch_raw(corp_code, year, reprt, fs)
        except Exception:
            rows = None
        if rows:
            d = pick(rows)
            if d.get('매출액') is not None or d.get('영업이익') is not None:
                d['fs'] = '연결' if fs == 'CFS' else '개별'
                return d
    return None


def history(corp_code: str, quarters: int = 12, delay: float = 0.12,
            verbose: bool = False) -> list:
    """
    최근 분기부터 거슬러 올라가며 모읍니다.

    반환: [{연도, 분기, 이름, fs, 매출액, ...}] — 오래된 것부터 정렬
    """
    now = dt.date.today()
    # 사업보고서는 이듬해 3월에 나옵니다. 넉넉히 뒤에서부터 훑습니다.
    todo = []
    y = now.year
    for _ in range(quarters + 6):
        for code, qn, nm in reversed(REPORTS):
            todo.append((y, code, qn, nm))
        y -= 1
    todo = todo[: quarters + 8]

    out = []
    for (yy, code, qn, nm) in todo:
        if len(out) >= quarters:
            break
        try:
            d = quarter(corp_code, yy, code)
        except Exception as e:
            if verbose:
                print(f'   {yy} {nm} 실패 {e}')
            d = None
        if d:
            d.update({'연도': yy, '분기': qn, '이름': nm})
            out.append(d)
        time.sleep(delay)

    out.sort(key=lambda x: (x['연도'], x['분기']))
    return out


# ─────────────────────── 누적치를 분기치로 ───────────────────────
def to_quarterly(hist: list) -> list:
    """
    DART 의 분기 '당기금액' 은 누적일 때가 많습니다.
    (3분기보고서의 매출 = 1~9월 합계)

    같은 해 앞 분기를 빼서 '그 분기만' 의 값으로 바꿉니다.
    재무상태표(자산·부채·자본·현금)는 시점 값이라 그대로 둡니다.
    """
    FLOW = ['매출액', '매출원가', '영업이익', '당기순이익',
            '영업현금흐름', '투자현금흐름', '재무현금흐름']
    by = {(x['연도'], x['분기']): x for x in hist}
    out = []
    for x in hist:
        d = dict(x)
        prev = by.get((x['연도'], x['분기'] - 1))
        if prev:
            for k in FLOW:
                a, b = x.get(k), prev.get(k)
                d[k] = None if (a is None or b is None) else a - b
        out.append(d)
    return out


# ─────────────────────── 지표 계산 ───────────────────────
def _r(a, b):
    if a is None or b in (None, 0):
        return None
    return a / b


def metrics(q: list) -> list:
    """분기별 지표. 전년 동기와 비교합니다(계절성 때문에 직전 분기와 비교하면 안 됩니다)."""
    by = {(x['연도'], x['분기']): x for x in q}
    out = []
    for x in q:
        yoy = by.get((x['연도'] - 1, x['분기']))
        rev, op, ni = x.get('매출액'), x.get('영업이익'), x.get('당기순이익')
        d = dict(x)
        d['영업이익률'] = _r(op, rev)
        d['순이익률'] = _r(ni, rev)
        d['ROE'] = _r(ni, x.get('자본총계'))
        d['부채비율'] = _r(x.get('부채총계'), x.get('자본총계'))
        # 이익의 질 — 영업이익만큼 현금이 실제로 들어왔나
        d['현금전환'] = _r(x.get('영업현금흐름'), op)
        if yoy:
            pr, po, pn = yoy.get('매출액'), yoy.get('영업이익'), yoy.get('당기순이익')
            d['매출YoY'] = None if (rev is None or not pr) else rev / pr - 1
            # 적자에서 흑자로 바뀐 경우 증가율은 뜻이 없습니다
            d['영업이익YoY'] = (None if (op is None or po is None or po <= 0)
                             else op / po - 1)
            d['순이익YoY'] = (None if (ni is None or pn is None or pn <= 0)
                           else ni / pn - 1)
            d['흑자전환'] = bool(po is not None and po <= 0 and op is not None and op > 0)
        out.append(d)
    return out


def summary(m: list) -> dict:
    """리포트 맨 앞에 쓸 한 줄 요약용."""
    if not m:
        return {}
    last = m[-1]
    def g(k, n=4):
        v = [x.get(k) for x in m[-n:] if x.get(k) is not None]
        return v
    acc = None
    ys = g('영업이익YoY', 3)
    if len(ys) == 3:
        acc = ys[2] > ys[1] > ys[0]        # 증가율이 분기마다 커지는가
    return {
        '최근분기': f"{last['연도']} {last['이름']}",
        '연결여부': last.get('fs'),
        '매출YoY': last.get('매출YoY'),
        '영업이익YoY': last.get('영업이익YoY'),
        '영업이익률': last.get('영업이익률'),
        '영업이익률_1년전': next((x.get('영업이익률') for x in m
                             if x['연도'] == last['연도'] - 1
                             and x['분기'] == last['분기']), None),
        'ROE': last.get('ROE'),
        '부채비율': last.get('부채비율'),
        '현금전환': last.get('현금전환'),
        '이익가속': acc,
        '흑자전환': last.get('흑자전환'),
        '분기수': len(m),
    }


def company(corp_code: str, quarters: int = 12, verbose: bool = False) -> dict:
    """한 회사의 재무 한 벌 — 이것이 리포트의 재료가 됩니다."""
    h = history(corp_code, quarters, verbose=verbose)
    if not h:
        return {'corp': corp_code, '분기': [], '요약': {}, '오류': '재무제표를 찾지 못했습니다'}
    q = to_quarterly(h)
    m = metrics(q)
    return {'corp': corp_code, '분기': m, '요약': summary(m)}
