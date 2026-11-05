# -*- coding: utf-8 -*-
"""
미너비니 Trend Template 8개 조건 + RS 순위 계산.

엑셀 '종목스크리닝' 시트와 판정 방식이 완전히 동일합니다.
  ① 현재가 > 150일선 & 200일선
  ② 150일선 > 200일선
  ③ 200일선이 상승 중 (20거래일 전보다 높다)
  ④ 50일선 > 150일선 & 200일선
  ⑤ 현재가 > 50일선
  ⑥ 52주 최저가 대비 +30% 이상
  ⑦ 52주 최고가 대비 -25% 이내
  ⑧ RS 순위 70 이상
"""
from __future__ import annotations
import os
import re
import numpy as np
import pandas as pd

# 스크리닝에서 빠진 종목과 그 이유. screen() 이 채우고 report 가 결과에 함께 실어 보냅니다.
#  검색창에서 "왜 이 종목은 안 나오지?" 에 답하기 위한 것입니다.
LAST_EXCLUDED = pd.DataFrame(columns=['코드', '종목명', '시장', '제외사유'])

# 최근 10거래일 중 며칠은 실제로 거래돼야 하는가 (거래정지·상장폐지 걸러내기)
MIN_RECENT_DAYS = 5

# ETF·ETN·리츠 걸러내기.
#  운용사 이름(KODEX·TIGER…)만으로는 'KIWOOM 미국원유에너지기업' 같은 신규 브랜드를 놓칩니다.
#  그래서 상품에만 쓰이는 낱말(액티브·머니마켓·CD금리…)과,
#  '영문/숫자 + 띄어쓰기' 로 시작하는 이름(TIGER 200, 1Q CD금리…)도 함께 봅니다.
#  국내 상장사 이름에는 이런 형태가 거의 없습니다 (HD현대에너지솔루션·SK하이닉스처럼 붙여 씁니다).
#  다만 'JYP Ent.' 처럼 영문이 이어지는 회사가 있어, 띄어쓰기 뒤가 한글·숫자일 때만 봅니다.
#  ⚠️ '리츠' 는 앞에 '메' 가 없을 때만 봅니다 (2026-09-01, Jun 지적).
#     그냥 '리츠' 로 두었더니 **메리츠**금융지주·메리츠화재·메리츠증권이
#     전부 리츠로 몰려 스크리너 대상에서 빠졌습니다. 낱말 한가운데가 걸린 것입니다.
#     국내 리츠는 대신밸류리츠코크렙처럼 가운데 오는 것도 있어 '리츠$' 로는
#     부족하고, 앞글자만 막는 편이 안전합니다.
ETF_PAT = (r'ETN|KODEX|TIGER|KBSTAR|ARIRANG|HANARO|KOSEF|KIWOOM|TIMEFOLIO|SOL |ACE |PLUS |RISE |마이다스|히어로즈|액티브|머니마켓|단기금융|CD금리|국고채|통안채|종합채권|회사채|인버스|레버리지|커버드콜|배당다우존스|채권혼합|(?<!메)리츠|^[A-Za-z0-9]+ (?=[가-힣0-9])')


def name_reason(name: str, s) -> str:
    """이름만 보고 알 수 있는 제외 사유"""
    n = str(name or '')
    if getattr(s, 'exclude_spac', True) and re.search('스팩|기업인수목적', n):
        return '스팩(SPAC) — 개별 성장주가 아닙니다'
    if getattr(s, 'exclude_etf_etn', True) and re.search(ETF_PAT, n, re.I):
        return 'ETF·ETN·리츠 — 개별 성장주가 아닙니다'
    if re.search(r'우$|우B$|우C$|[0-9]우$', n):
        return '우선주 — 보통주로 검색해 보세요'
    return ''

COND_LABELS = {
    'c1': '① 현재가>150·200일선',
    'c2': '② 150일선>200일선',
    'c3': '③ 200일선 상승중',
    'c4': '④ 50일선>150·200일선',
    'c5': '⑤ 현재가>50일선',
    'c6': '⑥ 저점대비 +30%↑',
    'c7': '⑦ 고점대비 -25% 이내',
    'c8': '⑧ RS 70↑',
}
CONDS = list(COND_LABELS)

# 각 조건이 무엇을 보는지, 왜 보는지 — 대시보드 설명 패널에 그대로 쓰입니다.
COND_DESC = {
    'c1': ('현재가 > 150일선 이고 현재가 > 200일선',
           '주가가 중기·장기 평균선 위에 있어야 합니다. 최근 반년~1년간 이 주식을 산 사람들이 '
           '평균적으로 이익 구간에 있다는 뜻이고, 그래야 위에서 쏟아지는 매물이 적습니다.'),
    'c2': ('150일선 > 200일선',
           '중기 평균이 장기 평균보다 위. 최근 흐름이 예전보다 강해졌다는 신호입니다.'),
    'c3': ('200일선이 상승 중 (20거래일 전보다 높음)',
           '장기 추세 자체가 위를 향해야 합니다. 미너비니 원문은 최소 1개월(가능하면 4~5개월) '
           '상승을 요구합니다. 이 조건 하나가 하락장 종목 대부분을 걸러냅니다.'),
    'c4': ('50일선 > 150일선 이고 50일선 > 200일선',
           '단기·중기·장기 평균선이 위에서부터 50 > 150 > 200 순서로 정렬된 상태. '
           '미너비니가 말하는 "2단계 상승 추세"의 교과서적 모습입니다.'),
    'c5': ('현재가 > 50일선',
           '단기 평균선 위. 지금 이 순간에도 힘이 살아 있다는 확인입니다.'),
    'c6': ('현재가 ≥ 52주 최저가 × 1.30 (저점 대비 +30% 이상)',
           '바닥에서 확실히 올라온 종목만 봅니다. 최저가 근처에서 기어다니는 주식은 '
           '아직 바닥을 다지는 중이거나 계속 빠지는 중입니다. 미너비니는 "싸게 사려다 '
           '더 싸지는" 자리를 피하려고 이 조건을 둡니다.'),
    'c7': ('현재가 ≥ 52주 최고가 × 0.75 (고점 대비 -25% 이내)',
           '1년 최고점에서 너무 많이 밀리지 않았어야 합니다. -25%를 넘게 빠졌다면 '
           '추세가 이미 꺾인 것으로 봅니다. 0%에 가까울수록(신고가 부근) 좋습니다.'),
    'c8': ('RS 순위 ≥ 70',
           '시장 전체에서 상위 30% 안에 드는 상대강도. 최근 3개월 수익률에 가중치 40%, '
           '6·9·12개월에 각 20%를 줘서 계산합니다. 미너비니는 70을 최소선, '
           '80~90 이상을 주도주로 봅니다.'),
}


def to_wide(ohlcv: pd.DataFrame, col: str) -> pd.DataFrame:
    """long → wide (행=날짜, 열=종목코드)"""
    return ohlcv.pivot(index='date', columns='code', values=col).sort_index()


def compute_rs(close: pd.DataFrame) -> pd.Series:
    """
    IBD 방식 상대강도(RS) 순위 1~99.
    최근 분기에 가중치를 더 줘서 '지금 잘 가는 종목'을 위로 올립니다.
        RS원점수 = 0.4×(3개월 수익률) + 0.2×(6개월) + 0.2×(9개월) + 0.2×(12개월)
    """
    last = close.iloc[-1]
    parts, weights = [], [0.4, 0.2, 0.2, 0.2]
    for lag, w in zip((63, 126, 189, 252), weights):
        if len(close) > lag:
            past = close.iloc[-(lag + 1)]
        else:                       # 상장 초기 종목은 가장 오래된 값으로 대체
            past = close.iloc[0]
        ratio = (last / past).replace([np.inf, -np.inf], np.nan)
        parts.append(ratio * w)
    raw = sum(parts)
    raw = raw.where(np.isfinite(raw))
    # 백분위 → 1~99 정수
    rank = raw.rank(pct=True) * 98 + 1
    return rank.round(0)


def _vcp_hint(high: pd.DataFrame, low: pd.DataFrame, volume: pd.DataFrame,
              weeks: int = 8) -> pd.DataFrame:
    """
    VCP 참고 지표(필터 아님). 최근 구간을 3등분해 변동폭이 줄어드는지만 봅니다.
    사람이 차트로 확인하기 전 '먼저 볼 순서'를 정하는 용도입니다.
    """
    n = weeks * 5
    n = min(n, len(high) - 1)
    seg = max(n // 3, 5)
    out = {}
    for i in range(3):
        s = -(3 - i) * seg
        e = None if i == 2 else -(2 - i) * seg
        h = high.iloc[s:e].max()
        l = low.iloc[s:e].min()
        out[f'w{i}'] = (h - l) / h.replace(0, np.nan)
    w = pd.DataFrame(out)
    res = pd.DataFrame(index=high.columns)
    res['수축_추세'] = np.where((w['w2'] < w['w1']) & (w['w1'] < w['w0']), '수축',
                        np.where(w['w2'] < w['w1'], '수축(약)', '-'))
    # 마지막 구간이 첫 구간의 몇 배인가. 1보다 작을수록 조여든 것.
    #  2026-08-20: 채점을 이 값으로 합니다. 세 구간이 '연속으로' 줄었는지만 보면
    #  10% → 7% → 7.2% 처럼 사실상 잘 조여든 종목이 마지막 0.2%p 때문에
    #  '-' 로 떨어져 배점을 통째로 잃었습니다.
    res['수축비'] = (w['w2'] / w['w0'].replace(0, np.nan)).round(4)
    res['마지막_변동폭'] = w['w2']
    base_vol = volume.iloc[-n:].mean()
    res['최근거래량_비율'] = volume.iloc[-5:].mean() / base_vol.replace(0, np.nan)

    # ── 수축 횟수 (2026-08-30) ─────────────────────────────────
    #  위의 수축비는 최근 8주를 **달력으로 3등분**한 값입니다. 편하지만
    #  진짜 수축은 달력이 아니라 '되돌림 한 번' 단위이고, 뒤로 갈수록
    #  짧아집니다. 13일씩 자르면 그 구조가 뭉개집니다.
    #
    #  그래서 가격 움직임으로 구간을 나눠 되돌림 횟수를 셉니다.
    #  6% 이상 되돌리면 수축 하나로 봅니다(3% 로 두면 잔파동까지 세서
    #  한 베이스에 30번이 넘습니다 — 미너비니가 세는 T 는 보통 2~6회입니다).
    #
    #  백테스트: IC +0.099 · t 6.95 · 61시점 중 49개 적중 · 두 국면 모두 +.
    #  수축이 **적을수록** 좋습니다 — 되돌림이 반복된다는 것은 아직 매물이
    #  소화되지 않았다는 뜻입니다.
    res['수축개수'] = _contraction_count(high, low, days=min(130, len(high)))
    return res


def _contraction_count(high: pd.DataFrame, low: pd.DataFrame,
                       days: int = 130, rev: float = 0.06) -> pd.Series:
    """종목마다 '되돌림을 몇 번 했나' 를 셉니다 (지그재그).

    구간 안의 최고 고점을 베이스의 왼쪽 벽으로 잡고, 그 뒤의
    (고점 → 저점) 쌍을 셉니다. rev 의 80% 보다 얕은 되돌림은
    잔파동으로 보고 세지 않습니다.
    """
    if days < 40 or len(high) < 40:
        return pd.Series(np.nan, index=high.columns)
    H = high.iloc[-days:].to_numpy(dtype=float)
    L = low.iloc[-days:].to_numpy(dtype=float)
    out = np.full(H.shape[1], np.nan)
    for j in range(H.shape[1]):
        h, l = H[:, j], L[:, j]
        ok = np.isfinite(h) & np.isfinite(l)
        if ok.sum() < 40:
            continue
        h, l = h[ok], l[ok]
        n2 = len(h)
        hi_i = int(np.argmax(h))
        if hi_i >= n2 - 5:
            continue                      # 고점이 맨 끝이면 아직 베이스가 없습니다
        piv, mx_i, mx, mn_i, mn, dirn = [], 0, h[0], 0, l[0], 0
        for i in range(1, n2):
            if h[i] > mx:
                mx, mx_i = h[i], i
            if l[i] < mn:
                mn, mn_i = l[i], i
            if dirn >= 0 and mx > 0 and l[i] <= mx * (1.0 - rev):
                piv.append((mx_i, mx, 'H')); dirn = -1; mn, mn_i = l[i], i
            elif dirn <= 0 and mn > 0 and h[i] >= mn * (1.0 + rev):
                piv.append((mn_i, mn, 'L')); dirn = 1; mx, mx_i = h[i], i
        after = [pv for pv in piv if pv[0] >= hi_i]
        if not after or after[0][2] != 'H':
            after = [(hi_i, float(h[hi_i]), 'H')] + after
        cnt = 0
        for k in range(len(after) - 1):
            a, b = after[k], after[k + 1]
            if a[2] == 'H' and b[2] == 'L' and a[1] > 0:
                if (a[1] - b[1]) / a[1] >= rev * 0.8:
                    cnt += 1
        # 아직 저점을 안 찍은 마지막 되돌림도 셉니다
        if after and after[-1][2] == 'H':
            jj = after[-1][0]
            if jj < n2 - 1 and after[-1][1] > 0:
                if (after[-1][1] - float(np.min(l[jj:]))) / after[-1][1] >= rev * 0.8:
                    cnt += 1
        out[j] = float(cnt)
    return pd.Series(out, index=high.columns)



SWING_K = 3          # 앞뒤 몇 봉보다 높아야 '국소 최고점' 인가
SWING_DROP = 0.08    # 그 뒤 종가가 몇 % 밀려야 '확정된 저항' 인가
SWING_HOLD = 5       # 되돌림이 얕아도 이만큼 '천장 노릇' 을 했으면 저항선으로 인정
SWING_LOOK = 250     # 확정 고점을 찾아볼 범위 (거래일)

# ── 추세유지 재확정 (2026-08-22) ────────────────────────────────────────
#  이미 피벗을 +5% 넘긴 종목은 **자기 실력을 증명한 종목**입니다.
#  미너비니가 말하는 2차·3차 베이스가 여기서 생깁니다. 그래서 이 종목들만
#  돌파일 이후 구간을 다시 훑어, 새로 생긴 마디를 피벗으로 올려 줍니다.
#
#  왜 필요한가 — 피벗이 첫 벽에 얼어붙으면 우상향이 이어지는 동안
#  상태가 영원히 '추세유지' 로 남고, 숫자만 +19% → +40% → +85% 로 커집니다.
#  그 사이 고점 대비 -7% 눌림이 와도 화면은 똑같습니다. 판정 기준이
#  두 달 전 자리에 멈춰 있기 때문입니다.
#
#  문턱은 **앞뒤 3봉 · 깊이 8% 를 그대로 두고 시간만 5일 → 1일** 로 줄였습니다
#  (2026-08-22 Jun 결정). 곧 "고점을 찍고 3봉 동안 더 높은 고가가 안 나오고,
#  다음 날 종가가 그 고가를 못 넘으면" 바로 새 벽으로 인정합니다.
#  앞뒤 3봉 조건이 남아 있으므로 피벗이 '어제 고가' 가 되는 일은 없습니다 —
#  가장 최신이라도 3거래일 전 고점입니다.
RETREND_MULT = 1.05  # 이 배수를 넘긴 종목만 재확정 대상 (= 추세유지 문턱과 같음)
RETREND_K = SWING_K  # 재확정 때의 국소 최고점 조건 (앞뒤 몇 봉). 3 유지
RETREND_HOLD = 1     # 재확정 때의 시간 조건 (거래일). 5 → 1
#
#  ⚠️ 2026-08-22 저녁에 재보고 알게 된 것 — **k=3 에서는 hold 3 과 1 이 완전히 같다.**
#     1,200번 시험해서 결과가 한 번도 안 달랐습니다. 앞뒤 3봉 조건이 이미
#     "고점 뒤 3봉의 고가가 더 낮아야 한다" 를 요구하므로, 그 3일 동안 종가가
#     그 고가를 넘는 일이 사실상 없기 때문입니다. 곧 **시간 조건을 3일 밑으로
#     내려도 아무 일도 일어나지 않습니다.** 실질 동작은 '앞뒤 3봉 + 3일' 입니다.
#     (RETREND_K 를 2 로 내리면 그때는 1 과 3 이 달라집니다. 그래서 1 로 남겨 둡니다.)
RETREND_MAX = 20     # 한 종목이 한 번에 오를 수 있는 계단 수 (무한루프 방지)


def _last_confirmed_high(hj, cj, k=SWING_K, drop=SWING_DROP,
                         hold=SWING_HOLD, look=SWING_LOOK,
                         before=None, cap=None):
    """되돌림으로 확정된 가장 최근 고점을 찾습니다. (위치, 값) 또는 (None, nan).

    사람이 차트에서 저항선을 찾을 때 무엇을 보는지 그대로 옮긴 것입니다 —
    **한 번 부딪히고 밀린 자리**만 저항선으로 봅니다.

      · 그 봉의 고가가 앞뒤 k봉보다 높다      → 국소 최고점
      그리고 아래 둘 중 하나 (천장 노릇을 했다는 증거):
      · 그 뒤 종가가 drop 이상 밀렸다        → 깊이로 확정
      · 그 뒤 hold 거래일 동안 못 넘었다      → 시간으로 확정

    시간 조건은 2026-08-21 에 티쓰리 사례를 보고 넣었습니다. 3,440 에서 꺾여
    엿새째 그 아래에서 베이스를 만드는데 되돌림이 5.8% 뿐이라, 깊이 조건만으로는
    3,440 이 저항선으로 안 잡혔습니다. 그러면 피벗이 한 굽이 뒤처집니다.
    반대로 자이에스앤디의 9,615 는 다음 날 바로 뚫려서 시간 조건에 걸리지 않습니다 —
    두 사례가 이 한 줄로 같이 풀립니다.

    2026-08-21 이전에는 그냥 '직전 20일 고가의 최대값' 을 저항선으로 썼습니다.
    그런데 그건 이동 최댓값이지 저항선이 아닙니다. 매일 신고가를 만들며 오르는
    종목에서는 그 값이 늘 '어제 고가' 가 되어, 돌파의 뜻이 "어제 고가를 넘겼다" 로
    쪼그라들었습니다. 강한 추세에서는 매일 일어나는 일입니다.
    (자이에스앤디 2026-08-21 사례: 7월 고점 8,402 을 두고 피벗이 9,670 으로 잡혔는데,
     9,670 은 돌파일 바로 전날의 고가였습니다.)

    뒤에서부터 찾아 첫 번째로 확정된 것을 돌려줍니다 — 보통 몇십 봉 안에 끝납니다.

    before / cap 을 주면 '그보다 앞쪽 · 그보다 낮은' 것만 찾습니다.
    이미 뚫고 올라온 자리(= 이전 피벗, 지금은 지지선)를 찾을 때 씁니다.

    (2026-08-22: 이전 피벗은 이 함수로 찾지 않습니다 — _pivot_stage 주석 참고)
    """
    n = len(hj)
    if n < 2 * k + 2:
        return None, np.nan
    # 종가의 '이 시점 이후 최솟값' 을 미리 만들어 둡니다 (매번 뒤를 훑지 않도록)
    suffmin = np.full(n, np.nan)
    run = np.inf
    for i in range(n - 1, -1, -1):
        if np.isfinite(cj[i]):
            run = min(run, cj[i])
        suffmin[i] = run
    stop = max(k, n - look)
    top = (before - 1) if before is not None else (n - k - 1)
    for i in range(min(top, n - k - 1), stop - 1, -1):
        h = hj[i]
        if not np.isfinite(h) or h <= 0:
            continue
        if cap is not None and h >= cap:
            continue                       # 지금 피벗보다 높은 것은 '이전' 이 아닙니다
        w = hj[i - k:i + k + 1]
        if not np.isfinite(w).any() or h < np.nanmax(w):
            continue                       # 앞뒤 k봉보다 높지 않습니다
        low_after = suffmin[i + 1]
        if np.isfinite(low_after) and low_after <= h * (1 - drop):
            return i, h                    # 깊이로 확정
        # 시간으로 확정 — 다음 hold 거래일의 종가가 그 고가를 못 넘었나
        seg = cj[i + 1:i + 1 + hold]
        if len(seg) >= hold and (not np.isfinite(seg).any() or np.nanmax(seg) <= h):
            return i, h
    return None, np.nan


# ══════════════════════════════════════════════════════════════════
#  상태 기계 (2026-08-23) — 시세로 되짚어(replay) 상태를 굴립니다.
#
#  왜 다시 짰나 — 예전 규칙은 상태를 **오늘 가격 하나**로 정했습니다. 기억이 없으니
#  '돌파한 지 며칠인가' 를 화면에 적기만 하고 판정에는 못 썼습니다. 그래서
#  **돌파 당일에 +7% 를 뛰어넘은 종목이 '추세유지(추격 금지)'** 로 찍혔습니다
#  (Ero Copper, 2026-08-23 Jun 발견).
#
#  새 규칙은 지난 90거래일을 하루씩 되짚습니다. 그래야 '5일 유지', '-3% 지속',
#  '최근 2달 이력' 같은 **기억이 필요한 규칙**을 쓸 수 있습니다.
#  DB 에 쌓지 않고 되짚는 이유는 statemachine 주석에 적어 두었습니다 —
#  쌓아 두면 규칙을 바꾸는 순간 어제까지의 이력이 옛 규칙 산물이 됩니다.
# ══════════════════════════════════════════════════════════════════
import heapq

ZONE_LO = -0.03      # 돌파구간 아래 끝 (피벗 -3%)
ZONE_HI = 0.05       # 매수 가능 밴드 위 끝 (피벗 +5%)
BRK_DAYS = 5         # 돌파가 이만큼 이어지면 추세유지
BASE_DAYS = 5        # 되돌림이 이만큼 이어지면 베이스
RETRY_LOOK = 40      # 재시도 — 최근 2달(40거래일) 안에 돌파·추세유지 이력
REPLAY = 90          # 며칠치를 되짚을까


def _conf_days_v2(hj, cj, k=SWING_K, drop=SWING_DROP, hold=SWING_HOLD):
    """봉마다 **그 고점이 '확정된 저항' 이 되는 날**을 돌려줍니다. 안 되면 -1.

    확정 조건은 지금과 같습니다.
      · 앞뒤 k봉보다 높은 고가 (국소 최고점)          → i+k 일에 알 수 있습니다
      · 그리고 아래 둘 중 하나
          깊이 : 그 뒤 종가가 drop 이상 밀린 날
          시간 : 그 뒤 hold 거래일 동안 종가가 그 고가를 못 넘음 → i+hold 일

    깊이 조건을 봉마다 앞을 훑으면 O(n²) 이 됩니다(2,400종목 × 500봉이면 못 씁니다).
    대신 **아직 답을 기다리는 봉들을 문턱이 높은 순서로 줄 세워 두고**(heap),
    종가가 하나씩 들어올 때마다 그 종가 아래로 내려온 것들을 한꺼번에 확정합니다.
    한 봉이 한 번 들어갔다 한 번 나오므로 O(n log n) 입니다.
    """
    n = len(hj)
    out = np.full(n, -1, dtype=np.int64)
    if n < 2 * k + 2:
        return out

    # ① 국소 최고점인가 (앞뒤 k봉)
    local = np.zeros(n, dtype=bool)
    for i in range(k, n - k):
        h = hj[i]
        if not np.isfinite(h) or h <= 0:
            continue
        w = hj[i - k:i + k + 1]
        if np.isfinite(w).any() and h >= np.nanmax(w):
            local[i] = True

    # ② 깊이로 확정되는 날 — 종가를 훑으며 기다리던 봉들을 풀어 줍니다
    depth = np.full(n, -1, dtype=np.int64)
    pend = []                                   # (-문턱, 봉번호) 문턱이 높은 것부터
    for t in range(n):
        c = cj[t]
        if np.isfinite(c):
            while pend and -pend[0][0] >= c:
                _, i = heapq.heappop(pend)
                depth[i] = t
        if local[t]:
            heapq.heappush(pend, (-(hj[t] * (1.0 - drop)), t))

    # ③ 시간으로 확정되는 날
    for i in range(k, n - k):
        if not local[i]:
            continue
        cand = []
        if depth[i] >= 0:
            cand.append(depth[i])
        seg = cj[i + 1:i + 1 + hold]
        if len(seg) >= hold and (not np.isfinite(seg).any() or np.nanmax(seg) <= hj[i]):
            cand.append(i + hold)
        if cand:
            out[i] = max(i + k, min(cand))      # 국소 최고점은 i+k 일에야 알 수 있습니다
    return out


def _latest_bar_v2(conf, n):
    """날짜별로 '그날까지 확정된 것 중 가장 최근 봉' 을 돌려줍니다.

    확정되는 순서와 봉 순서가 다를 수 있어서(뒤늦게 확정되는 옛 고점이 있습니다)
    **본 것 중 가장 큰 봉 번호**를 계속 들고 갑니다.
    """
    order = sorted((int(conf[i]), i) for i in range(n) if conf[i] >= 0)
    out = np.full(n, -1, dtype=np.int64)
    p = 0
    best = -1
    for t in range(n):
        while p < len(order) and order[p][0] <= t:
            if order[p][1] > best:
                best = order[p][1]
            p += 1
        out[t] = best
    return out


def _pivot_series_v2(hj, cj):
    """날짜별 (피벗 봉번호, 피벗 값). 재확정까지 반영합니다.

    재확정 — 피벗을 +5% 넘긴 동안에는, **느슨한 기준으로 확정된 더 높은 고점**이
    생기면 그리로 갈아탑니다(미너비니의 2차·3차 베이스). 피벗은 위로만 움직입니다.
    """
    n = len(hj)
    strict = _latest_bar_v2(_conf_days_v2(hj, cj), n)
    loose = _latest_bar_v2(_conf_days_v2(hj, cj, k=RETREND_K, hold=RETREND_HOLD), n)

    bars = np.full(n, -1, dtype=np.int64)
    for t in range(n):
        b = int(strict[t])
        if b < 0:
            bars[t] = -1
            continue
        res = hj[b]
        lb = int(loose[t])
        # 갈아타기는 한 번이면 충분합니다 — loose[t] 가 이미 '가장 최근' 이라
        # 한 번 갈아타면 다음 번에는 같은 봉이 나옵니다.
        if (lb > b and np.isfinite(cj[t]) and np.isfinite(hj[lb])
                and cj[t] > res * RETREND_MULT and hj[lb] > res):
            b = lb
        bars[t] = b
    return bars


STAGES = ('베이스', '돌파구간', '재시도', '돌파', '추세유지', '되돌림')


def _replay_v2(hj, cj, days=REPLAY):
    """하루씩 상태를 굴립니다. 마지막 날의 상태와 부속 숫자를 돌려줍니다.

    상태가 갈리는 자리는 **피벗 대비 이격 하나**입니다. 겹치지 않습니다.

        이격 ≤ -3%        되돌림 (뚫었던 종목만) → 5거래일 이어지면 베이스
        -3% < 이격 ≤ +5%  돌파구간  ← **지금 사도 되는 자리**
                          (최근 2달 안에 돌파 이력이 있으면 재시도)
        이격 > +5%        돌파 → 5거래일 지나면 추세유지

    2026-08-23 Jun 확정 — '돌파구간' 은 피벗을 사이에 둔 **-3% ~ +5% 밴드 전체**입니다.
    피벗을 갓 넘긴 +1% 도 아직 살 수 있는 자리이므로 돌파구간입니다.
    **+5% 를 넘어가면 그때부터 '돌파'** 이고, 그 상태로 5거래일이 지나면 추세유지입니다.
    (Ero Copper 2026-08-23: 돌파 당일 +7% → 돌파. 예전 규칙은 추세유지로 찍었습니다)
    """
    n = len(cj)
    bars = _pivot_series_v2(hj, cj)
    start = max(SWING_K + 1, n - days)

    state = '베이스'
    brk_day = -1          # 지금 돌파(+5% 초과) 국면이 시작된 날
    retrace = 0           # 되돌림이 며칠째인가
    ever = False          # 지금 피벗을 한 번이라도 넘어선 적이 있나
    hist = []             # 돌파·추세유지였던 날들 (재시도 판정용)
    prev_bar = -1
    sdays = 0             # 지금 상태가 며칠째인가 (되돌림 3일차 …)
    seen = 0              # 실제로 되짚은 날 수 — '90일+' 인지 알려면 필요합니다

    for t in range(start, n):
        b = int(bars[t])
        px = cj[t]
        if b < 0 or not np.isfinite(px):
            continue
        pv = hj[b]
        if not np.isfinite(pv) or pv <= 0:
            continue
        gap = px / pv - 1.0
        was = state

        # 피벗이 계단을 올랐으면 처음부터 다시 셉니다 (새 벽은 새 싸움입니다)
        if b != prev_bar:
            brk_day = -1
            ever = False
            prev_bar = b

        if gap <= ZONE_LO:
            if state == '되돌림':
                retrace += 1
                # `>` 입니다(`>=` 아님). 돌파 쪽과 세는 법을 맞춘 것입니다 —
                #  돌파는 1~5일차까지 '돌파' 이고 6일차에 추세유지가 됩니다.
                #  되돌림도 1~5일차까지 '되돌림' 이고 6일차에 베이스가 되어야
                #  "5거래일 유지되면 넘어간다" 는 말이 양쪽에서 같은 뜻이 됩니다.
                #  (2026-08-23: 되돌림이 4일까지밖에 안 나온다는 Jun 지적으로 고침)
                if retrace > BASE_DAYS:
                    state = '베이스'
            elif ever or state in ('돌파', '추세유지', '재시도'):
                # 되돌림 = **뚫었다가 무너진 것**. 뚫은 적 없는 종목은 그냥 베이스입니다.
                #  (2026-08-23 시험에서 찾은 빈틈 — 규격을 글자 그대로 옮기면 한 번도
                #   뚫은 적 없이 피벗 -1% 까지 올라왔다 밀린 종목이 '실패한 돌파' 가 됩니다)
                state, retrace = '되돌림', 1
            else:
                state, retrace = '베이스', retrace + 1
            brk_day = -1
        elif gap <= ZONE_HI + 1e-9:      # 정확히 +5.0% 는 밴드 안입니다
            # -3% ~ +5% — 피벗을 사이에 둔 매수 검토 밴드
            if gap >= 0:
                ever = True
            recent = any(t - d <= RETRY_LOOK for d in hist)
            state = '재시도' if recent else '돌파구간'
            retrace = 0
            brk_day = -1
        else:
            # +5% 초과 — 밴드를 벗어나 위로 갔습니다
            ever = True
            if brk_day < 0:
                brk_day = t                      # 오늘이 이번 돌파의 첫날
            state = '추세유지' if (t - brk_day) >= BRK_DAYS else '돌파'
            retrace = 0
            hist.append(t)

        # 같은 상태가 이어지면 하루 더, 바뀌면 1일차부터
        sdays = sdays + 1 if state == was else 1
        seen += 1

    t = n - 1
    b = int(bars[t]) if n else -1
    pv = hj[b] if b >= 0 else np.nan
    px = cj[t] if n else np.nan
    gap = (px / pv - 1.0) if (b >= 0 and np.isfinite(pv) and pv > 0) else np.nan
    return {
        '피벗봉': b,
        '피벗가격': pv,
        '피벗상태': state,
        '피벗대비이격': gap,
        '돌파후일수': (t - brk_day) if brk_day >= 0 else np.nan,
        # 지금 상태가 며칠째인가. 되짚은 기간 내내 같은 상태였으면 '그 이상' 입니다
        '상태일수': sdays,
        '상태일수이상': bool(seen and sdays >= seen),
        # 매수 가능 밴드 (-3% ~ +5%). 상태와 따로 씁니다.
        # 매수 검토 자리인가 — 이제 '돌파구간·재시도' 상태와 같은 뜻입니다.
        #  (2026-08-23: 돌파구간을 -3%~+5% 밴드 전체로 정하면서 둘이 겹쳤습니다.
        #   화면에서 따로 표시하지는 않지만, 다른 곳에서 쓰기 편하게 남겨 둡니다)
        '매수자리': bool(np.isfinite(gap) and ZONE_LO <= gap <= ZONE_HI),
    }


def _pivot_stage(high: pd.DataFrame, low: pd.DataFrame, close: pd.DataFrame,
                 volume: pd.DataFrame, win: int = 20, max_age: int = 40,
                 vol_mult: float = 1.5, retry_gap: float = 0.03) -> pd.DataFrame:
    """미너비니식 '피벗' 과 상태.

    피벗 = **가장 최근에 확정된 저항선** (_conf_days_v2 참고). 위로만 움직입니다.

    상태는 여섯 가지이고, **갈리는 자리는 피벗 대비 이격 하나**입니다. 겹치지 않습니다.

        이격 ≤ -3%        되돌림 → 5거래일 이어지면 베이스
        -3% < 이격 < 0    돌파구간 → 최근 2달 안에 돌파 이력이 있으면 재시도
        이격 ≥ 0          돌파 → 5거래일 지나면 추세유지

    2026-08-23 에 다시 짰습니다. 예전에는 추세유지를 '피벗 +5% 초과' 라는 **거리**로
    갈랐는데, 피벗이 안 움직이는 동안 그 거리가 무한정 커져 `60일 · +85%` 같은
    쓸모없는 숫자가 나왔습니다. 게다가 **돌파 당일에 +7% 를 뛰어넘은 종목이
    '추세유지(추격 금지)'** 로 찍혔습니다. 이제 시간으로 가릅니다.

    `매수자리` 는 돌파구간·재시도와 같은 뜻입니다 (피벗 -3% ~ +5%).
    상태 이름이 이미 그것을 말하므로 화면에서 따로 표시하지는 않습니다.

    max_age · vol_mult · retry_gap 은 이제 안 씁니다. 부르는 쪽을 안 고치려고 남겨 둡니다.
    """
    h = high.to_numpy(dtype=float)
    c = close.to_numpy(dtype=float)
    v = volume.to_numpy(dtype=float)
    rows = len(close)
    codes = list(close.columns)

    pivot = np.full(len(codes), np.nan)
    prev_pivot = np.full(len(codes), np.nan)      # 이미 뚫고 올라온 자리 = 지지선
    brk_vol = np.full(len(codes), np.nan)         # 돌파일 거래량 ÷ 직전 50일 평균
    pv_age = np.full(len(codes), np.nan)          # 피벗이 며칠 전 고점인가
    pp_age = np.full(len(codes), np.nan)          # 이전피벗이 며칠 전 고점인가
    stage = np.array(['-'] * len(codes), dtype=object)
    age = np.full(len(codes), np.nan)             # 돌파 후 며칠째
    since = np.full(len(codes), np.nan)           # 돌파가 대비 등락
    zone = np.zeros(len(codes), dtype=bool)       # 매수 가능 밴드 안인가
    sdays = np.full(len(codes), np.nan)           # 지금 상태가 며칠째인가
    sover = np.zeros(len(codes), dtype=bool)      # 되짚은 기간을 넘겼는가 ('90일+')

    need = win + 5
    for j in range(len(codes)):
        hj, cj, vj = h[:, j], c[:, j], v[:, j]
        if rows < need or not np.isfinite(cj[-1]):
            continue
        px = cj[-1]
        last = rows - 1

        out = _replay_v2(hj, cj)
        p = int(out['피벗봉'])
        if p < 0 or not np.isfinite(out['피벗가격']) or out['피벗가격'] <= 0:
            # 확정된 저항선이 아직 없습니다(상장 직후 등) — 만들어지는 중인 것으로 대신합니다
            recent = hj[-win:]
            res = np.nanmax(recent) if np.isfinite(recent).any() else np.nan
            pivot[j] = res
            if np.isfinite(res):
                pv_age[j] = win - 1 - int(np.nanargmax(recent))
                gap = px / res - 1 if res > 0 else np.nan
                stage[j] = '돌파구간' if (np.isfinite(gap) and gap >= ZONE_LO) else '베이스'
                zone[j] = bool(np.isfinite(gap) and ZONE_LO <= gap <= ZONE_HI)
            else:
                stage[j] = '베이스'
            continue

        pivot[j] = out['피벗가격']
        pv_age[j] = last - p
        stage[j] = out['피벗상태']
        zone[j] = bool(out['매수자리'])
        sdays[j] = out['상태일수']
        sover[j] = bool(out['상태일수이상'])
        if np.isfinite(out['돌파후일수']):
            age[j] = out['돌파후일수']
            since[j] = out['피벗대비이격']
            # 돌파일 거래량 — 판정에는 안 쓰고 품질 표시로만 씁니다
            t = last - int(out['돌파후일수'])
            if 0 <= t < rows:
                base = vj[max(0, t - 50):t]
                avg = np.nanmean(base) if np.isfinite(base).any() else np.nan
                if np.isfinite(avg) and avg > 0 and np.isfinite(vj[t]):
                    brk_vol[j] = vj[t] / avg

        # ── 이전 피벗 = **이번 신고가 국면이 시작되기 전까지의 252일 최고가** ──
        #  급등 구간을 통째로 건너뛰고, 그 급등이 시작되기 전의 천장을 찾습니다.
        #  (2026-08-22 에 네 번 만에 맞춘 정의입니다. 자세한 사연은 프로젝트 문서에)
        t2 = p
        while t2 > 0:
            lo = max(0, t2 - 252)
            prior = hj[lo:t2]
            if not len(prior) or not np.isfinite(prior).any():
                break
            if np.isfinite(hj[t2]) and hj[t2] > np.nanmax(prior):
                t2 -= 1
            else:
                break
        lo = max(0, t2 - 252)
        seg = hj[lo:t2]
        if len(seg) and np.isfinite(seg).any():
            k2 = int(np.nanargmax(seg)) + lo
            prev_pivot[j] = hj[k2]
            pp_age[j] = last - k2

    return pd.DataFrame({'피벗가격': pivot, '이전피벗': prev_pivot, '피벗상태': stage,
                         '돌파후일수': age, '돌파가대비': since,
                         '돌파거래량': brk_vol, '매수자리': zone,
                         '상태일수': sdays, '상태일수이상': sover,
                         '피벗나이': pv_age, '이전피벗나이': pp_age}, index=codes)


def _setup_pivot_one(h, l, c):
    """한 종목의 셋업 피벗 (2026-10-10). 웹 lib/setup.js 의 judge() 와 **같은 규칙**입니다 — 한쪽만 고치지 말 것.

      베이스 시작 = 최근 260일 최고가 (같은 고가가 두 번이면 앞의 것)
      베이스가 10거래일 미만이면 없음 (신고가 진행 중)
      수축 = 베이스 안 지그재그 (문턱 max(4%, 20일 평균 일중 변동 × 1.5))
      피벗 = 마지막 수축의 고점 · 손절 = 그 수축의 저점 (아직 저점이 없으면 피벗 뒤 최저가)
    돌려주는 값: (피벗, 손절, 피벗이 며칠 전인가, 베이스 길이) 또는 None
    """
    n = len(c)
    t = n - 1
    if t < 220:
        return None
    lo_i = t - min(260, t)
    bs = lo_i
    for i in range(lo_i, t + 1):
        if h[i] > h[bs]:
            bs = i
    blen = t - bs
    if blen < 10:
        return None
    adr20 = float(np.mean((h[t - 19:t + 1] - l[t - 19:t + 1]) / c[t - 19:t + 1]))
    th = max(0.04, 1.5 * adr20)
    pts = []                    # (종류, 봉, 값)
    mode = None
    hi_i, hi_p, lo_i2, lo_p = bs, h[bs], bs, l[bs]
    for i in range(bs, t + 1):
        if mode is None or mode == 'up':
            if h[i] >= hi_p:
                hi_i, hi_p = i, h[i]
            if l[i] <= hi_p * (1 - th):
                pts.append(('H', hi_i, hi_p)); mode = 'down'; lo_i2, lo_p = i, l[i]
                continue
        if mode == 'down':
            if l[i] <= lo_p:
                lo_i2, lo_p = i, l[i]
            if h[i] >= lo_p * (1 + th):
                pts.append(('L', lo_i2, lo_p)); mode = 'up'; hi_i, hi_p = i, h[i]
    if mode == 'down':
        pts.append(('L', lo_i2, lo_p))
    elif mode == 'up':
        pts.append(('H', hi_i, hi_p))
    highs = [p for p in pts if p[0] == 'H']
    piv_i, pivot = (highs[-1][1], highs[-1][2]) if highs else (bs, h[bs])
    stop = float(np.min(l[piv_i:t + 1])) if piv_i < t else float(l[t])
    for k in range(len(pts) - 1):
        if pts[k][0] == 'H' and pts[k + 1][0] == 'L' and pts[k][1] == piv_i and k + 1 == len(pts) - 1:
            stop = float(pts[k + 1][2])
    return float(pivot), stop, t - piv_i, blen


def _setup_pivot(high: pd.DataFrame, low: pd.DataFrame, close: pd.DataFrame) -> pd.DataFrame:
    """종목마다 셋업 피벗·손절을 구합니다. 값이 빈 날은 빼고 봅니다."""
    out = {}
    H, L, C = high.to_numpy(float), low.to_numpy(float), close.to_numpy(float)
    for j, code in enumerate(close.columns):
        ok = np.isfinite(H[:, j]) & np.isfinite(L[:, j]) & np.isfinite(C[:, j]) & (C[:, j] > 0)
        h, l, c = H[ok, j], L[ok, j], C[ok, j]
        # 거래정지일처럼 고가·저가가 0 으로 온 날은 종가로 채웁니다 (lib/setup.js cleanBars 와 같음)
        h = np.where(h > 0, h, c); l = np.where(l > 0, l, c)
        r = _setup_pivot_one(h, l, c) if len(c) else None
        if r:
            out[code] = {'셋업피벗': r[0], '셋업손절': r[1], '셋업피벗나이': r[2], '셋업베이스일': r[3]}
    return pd.DataFrame.from_dict(out, orient='index')


def _accumulation(close: pd.DataFrame, volume: pd.DataFrame, days: int = 50) -> pd.DataFrame:
    """
    미너비니가 말하는 '기관 매집(institutional accumulation)'을 거래량으로 읽습니다.
    한국식 외국인·기관 순매수와는 다른, 원문 그대로의 접근입니다.

      · UD비율  = 상승일 거래량 합 ÷ 하락일 거래량 합
                  1.0 초과면 오를 때 더 크게 거래됨 = 사는 쪽이 강함
      · 매집일  = 거래량이 평소의 1.5배 이상이면서 상승 마감한 날의 수
      · 분산일  = 거래량이 평소의 1.5배 이상이면서 하락 마감한 날의 수
    """
    n = min(days, len(close) - 1)
    c = close.iloc[-(n + 1):]
    v = volume.iloc[-n:]
    chg = c.diff().iloc[1:]

    up_vol = v.where(chg.values > 0).sum()
    dn_vol = v.where(chg.values < 0).sum()
    ud = up_vol / dn_vol.replace(0, np.nan)

    avg = v.mean()
    big = v.gt(avg * 1.5, axis=1) if False else v.div(avg, axis=1).gt(1.5)
    res = pd.DataFrame(index=close.columns)
    res['UD비율'] = ud
    res['매집일'] = big.where(chg.values > 0).sum()
    res['분산일'] = big.where(chg.values < 0).sum()
    # 자금흐름 판정 — 1.0 을 경계로 삼습니다.
    #  유입: UD 1.25 이상 + 대량 상승일이 대량 하락일 이상 (큰손이 사 모으는 중)
    #  유출: UD 1.0 미만, 또는 대량 하락일이 상승일보다 3일 이상 많음
    #  보통: 그 사이 (1.00 ~ 1.25)
    #  예전에는 0.8~1.2 가 전부 '중립' 이라 구간이 너무 넓어 대부분 뭉개졌습니다.
    res['매집판정'] = np.where(
        (res['UD비율'] >= 1.25) & (res['매집일'] >= res['분산일']), '유입',
        np.where((res['UD비율'] < 1.0) | (res['분산일'] > res['매집일'] + 2), '유출', '보통'))
    return res


def screen(ohlcv: pd.DataFrame, tickers: pd.DataFrame, sectors: pd.DataFrame,
           s) -> pd.DataFrame:
    """전 종목 판정 결과를 담은 표를 돌려줍니다."""
    global LAST_EXCLUDED
    LAST_EXCLUDED = pd.DataFrame(columns=['코드', '종목명', '시장', '제외사유'])
    close = to_wide(ohlcv, 'close')
    high = to_wide(ohlcv, 'high')
    low = to_wide(ohlcv, 'low')
    low = low.where(low > 0)  # Trading halts may be represented by zero OHLC.
    vol = to_wide(ohlcv, 'volume')
    val = to_wide(ohlcv, 'value')

    # 데이터가 충분한 종목만
    enough = close.notna().sum() >= s.min_history_days
    keep = enough[enough].index
    close, high, low, vol, val = (d[keep] for d in (close, high, low, vol, val))

    # 최근에 '실제로' 거래됐는지 — 반드시 ffill 전에 셉니다.
    #  2026-08-21 발견: 거래정지·상장폐지 종목이 목록에 남아 있었습니다. 원인은 둘.
    #   ① close.ffill() 이 마지막 가격을 계속 이어 붙여 살아 있는 것처럼 보이게 함
    #   ② 거래대금 평균이 pandas 기본값대로 빈 날을 건너뛰고 계산됨
    #      (10일 전에 멈춘 종목도 그 전 10일치로 평균이 나와 유동성 문턱을 통과)
    #  → 최근 10거래일 중 실제 거래가 5일 미만이면 뺍니다.
    #    반나절 정지·공휴일 정도는 통과하고, 멈춘 종목만 걸립니다.
    recent_days = close.iloc[-10:].notna().sum()
    close = close.ffill()

    px = close.iloc[-1]
    ma50 = close.rolling(s.ma_short).mean().iloc[-1]
    ma150 = close.rolling(s.ma_mid).mean().iloc[-1]
    ma200_series = close.rolling(s.ma_long).mean()
    ma200 = ma200_series.iloc[-1]
    ma200_prev = ma200_series.iloc[-(s.ma_long_lookback + 1)]

    win = min(252, len(close))
    hi52 = high.iloc[-win:].max()
    lo52 = low.iloc[-win:].min()

    # ── 직전 52주 최고가 (2026-08-21) ─────────────────────────────
    #  위의 hi52 는 '오늘까지' 의 최고가라, 오늘 신고가를 내면 곧 오늘 값이 됩니다.
    #  그러면 "뚫어야 할 값" 으로는 쓸 수가 없습니다 — 늘 지금 가격이니까요.
    #  그래서 최근 5거래일(약 일주일)을 빼고 다시 잽니다.
    #    · 뚫은 날부터 나흘간은 뚫기 전의 고점이 그대로 남습니다 (선이 안 움직입니다)
    #    · 닷새째에 그날이 창 안으로 들어와 새 고점으로 갱신됩니다
    #  8조건 ⑦ 은 미너비니 원문대로 hi52(오늘 포함)를 그대로 씁니다. 이 값은 표시용입니다.
    HI52_HOLD = 5
    if len(high) > HI52_HOLD:
        prev = high.iloc[-win:-HI52_HOLD]
        hi52_prev = prev.max() if len(prev) else hi52
    else:
        hi52_prev = hi52

    rs = compute_rs(close)

    df = pd.DataFrame({
        '현재가': px, '50일선': ma50, '150일선': ma150, '200일선': ma200,
        '200일선_1개월전': ma200_prev, '52주최고': hi52, '52주최저': lo52,
        '직전52주최고': hi52_prev,
        'RS': rs,
        # 오늘 하루 거래대금 (한국 원 · 미국 달러). 검색 상세에서 보여줍니다.
        #  20일 평균만 있으면 "오늘 얼마나 손바뀜이 있었나" 를 못 봅니다 (2026-08-23)
        '거래대금': val.iloc[-1],
        '거래대금20일': val.iloc[-20:].mean(),
        '최근거래일': recent_days,
        # 값이 있는 거래일 수 — '상장한 지 얼마나 됐나' 를 가늠합니다 (2026-08-26).
        #  252거래일(약 1년)이 안 되면 200일선·52주 고저가 제 뜻을 갖지 못합니다.
        '거래일수': close.notna().sum(),
    })

    df['c1'] = (df['현재가'] > df['150일선']) & (df['현재가'] > df['200일선'])
    df['c2'] = df['150일선'] > df['200일선']
    df['c3'] = df['200일선'] > df['200일선_1개월전']
    df['c4'] = (df['50일선'] > df['150일선']) & (df['50일선'] > df['200일선'])
    df['c5'] = df['현재가'] > df['50일선']
    df['c6'] = df['현재가'] >= df['52주최저'] * s.above_52w_low
    df['c7'] = df['현재가'] >= df['52주최고'] * s.below_52w_high
    df['c8'] = df['RS'] >= s.rs_min

    df['통과개수'] = df[CONDS].sum(axis=1)
    # 전일 종가 대비 등락률 (화면에서 현재가 옆에 표시)
    df['등락률'] = (px / close.iloc[-2] - 1) if len(close) >= 2 else np.nan
    df['저점대비'] = df['현재가'] / df['52주최저'] - 1
    df['고점대비'] = df['현재가'] / df['52주최고'] - 1
    # 직전 고점을 넘어섰으면 + 로 나옵니다 ("3.2% 넘어섰다")
    df['직전고점대비'] = df['현재가'] / df['직전52주최고'].replace(0, np.nan) - 1

    # ── 하락의 '질' 을 재는 재료 ──────────────────────────────
    #  같은 -5% 라도 거래량이 실렸으면 큰손이 파는 것이고,
    #  거래량 없이 조용히 밀린 것은 흔한 눌림입니다. 이 둘을 구분하려면
    #  '오늘 거래량이 평소의 몇 배인가' 가 필요합니다.
    #  (표에 이미 있는 '거래량' 칸은 최근 5일 평균이라 오늘 하루를 못 봅니다)
    base_vol = vol.iloc[-21:-1].mean() if len(vol) >= 21 else vol.mean()
    df['당일거래량비'] = vol.iloc[-1] / base_vol.replace(0, np.nan)
    df['20일선'] = close.rolling(20).mean().iloc[-1]
    # ── 변동성 축소·자리 지표 (2026-10-10) — 종합점수 가격 항목으로 씁니다 ──
    #  셋업 판정(웹 lib/setup.js)의 손절 거리·피벗 근접은 지그재그가 필요해 무겁습니다.
    #  같은 것을 한 줄로 재는 대체값이 검증에서 오히려 더 잘 맞았습니다
    #  (10일 범위 IC +0.105 vs 손절 거리 +0.090 · 20일 고가 근접 +0.070 vs 피벗 근접 +0.053).
    df['일중변동5'] = ((high - low) / close).iloc[-5:].mean()          # 최근 5일 평균 (고−저)/종가
    df['범위10'] = high.iloc[-10:].max() / low.iloc[-10:].min() - 1     # 최근 10일 고가÷저가 − 1
    # 가격 고정 (2026-10-12) — 인수합병·공개매수가 발표돼 제시가 근처에 묶인 종목.
    #  Bowhead(BOW)·Integer(ITGR)·Utz(UTZ) 등은 10일 평균 일중 변동 0.1~0.6%, 종가 범위 0.2~2% 였고
    #  보통 종목은 가장 잔잔한 KO·AAPL 도 일중 변동 1.4~1.8% 였습니다. 이런 종목은 '플랫'·'셋업'으로 잘못 잡힙니다.
    df['일중변동10'] = ((high - low) / close).iloc[-10:].mean()
    df['종가범위10'] = close.iloc[-10:].max() / close.iloc[-10:].min() - 1
    df['고가20근접'] = px / high.iloc[-20:].max() - 1                     # 0 이면 20일 고가에 붙어 있음
    df['거래량5_50'] = vol.iloc[-5:].mean() / vol.iloc[-50:].mean()      # 1 보다 작으면 마르는 중
    # 최근 5거래일 고점 대비 얼마나 밀렸나 (돌파 직후 급반락을 잡습니다)
    df['5일고점대비'] = df['현재가'] / high.iloc[-5:].max() - 1

    df = df.join(_vcp_hint(high, low, vol, s.vcp_base_weeks))
    df = df.join(_pivot_stage(high, low, close, vol))
    df = df.join(_accumulation(close, vol, s.accumulation_days))
    df['피벗대비이격'] = df['현재가'] / df['피벗가격'] - 1

    # 수축이 없으면 '피벗권'이라 부르지 않습니다 (VCP 가 없으면 살 자리가 아닙니다)
    no_vcp = (df['피벗상태'] == '피벗권') & (~df['수축_추세'].isin(['수축', '수축(약)']))
    df.loc[no_vcp, '피벗상태'] = '베이스'
    # 피벗 아래 손절 자리 제안: 최근 베이스 저점과 진입가 -8% 중 높은 쪽
    n = min(s.vcp_base_weeks * 5, len(low) - 1)
    base_low = low.iloc[-n:].min()
    df['손절가제안'] = np.maximum(base_low * 0.99, df['피벗가격'] * (1 - s.max_stop_pct))
    df['예상손절폭'] = 1 - df['손절가제안'] / df['피벗가격']

    # ── 피벗을 셋업 기준으로 (2026-10-10, Jun 승인) ─────────────────────────
    #  지금까지의 피벗(최근 '확정된 저항', 위로만 움직임)은 백테스트에서 이격의 예측력이 없었습니다
    #  (IC −0.013). 셋업 탭의 피벗(베이스 안 마지막 수축의 고점, 미너비니·오닐 정의)은 +0.053 이었습니다.
    #  그래서 **화면에 나가는 피벗·피벗 대비·손절가를 셋업 기준으로 바꿉니다** — 목록·차트·전광판·카드뉴스가
    #  모두 이 값을 씁니다. 상태 라벨(돌파구간 …)은 아직 예전 피벗으로 매기므로, 그 값은 '라벨…' 칸에 남깁니다.
    #  셋업 피벗이 없는 종목(베이스 2주 미만 = 신고가 진행 중, 이력 부족)은 예전 값을 그대로 둡니다.
    df['라벨피벗가격'] = df['피벗가격']
    df['라벨피벗대비이격'] = df['피벗대비이격']
    df['라벨손절가'] = df['손절가제안']
    sp = _setup_pivot(high, low, close)
    df = df.join(sp)
    m = df['셋업피벗'].notna() if '셋업피벗' in df else pd.Series(False, index=df.index)
    df['피벗출처'] = np.where(m, '셋업', '라벨')
    if m.any():
        df.loc[m, '피벗가격'] = df.loc[m, '셋업피벗']
        df.loc[m, '손절가제안'] = df.loc[m, '셋업손절']
        df.loc[m, '피벗나이'] = df.loc[m, '셋업피벗나이']
        df['피벗대비이격'] = df['현재가'] / df['피벗가격'] - 1
        df['예상손절폭'] = 1 - df['손절가제안'] / df['피벗가격']

    # 목록의 [거래량 5일] 칸에 쓰는 작은 막대그림 재료 (2026-08-23).
    #  최근 5거래일 거래량과, 견줄 잣대가 되는 20일 평균을 함께 보냅니다.
    #  숫자 하나(평균 대비 몇 배)만으로는 '늘어나는 중인지 줄어드는 중인지' 를 못 봅니다.
    vv = vol.iloc[-5:]
    df['거래량추이'] = vv.apply(
        lambda col: '|'.join('' if pd.isna(v) else f'{v:.0f}' for v in col), axis=0)
    df['거래량평균20'] = base_vol

    # 차트용: 최근 N일 종가를 "|" 로 이어붙인 문자열 (대시보드에서 선형차트로 그립니다)
    if s.spark_days > 0:
        recent = close.iloc[-s.spark_days:]
        df['주가추이'] = recent.round(1).apply(
            lambda col: '|'.join('' if pd.isna(v) else f'{v:g}' for v in col), axis=0)

    # 종목명 · 시장 · 업종 붙이기
    df = df.reset_index().rename(columns={'code': '코드', 'index': '코드'})
    df = df.merge(tickers.rename(columns={'code': '코드', 'name': '종목명',
                                          'market': '시장', 'marcap': '시가총액'}),
                  on='코드', how='left')
    if len(sectors):
        cols = {'code': '코드', 'sector': '업종', 'product': '주요제품', '출처': '업종출처'}
        keep = [c for c in cols if c in sectors.columns]
        df = df.merge(sectors[keep].rename(columns=cols), on='코드', how='left')
    df = _apply_wics(df)
    for c in ('업종', '주요제품', '업종출처'):
        if c not in df.columns:
            df[c] = pd.NA
    df['업종'] = df['업종'].fillna('-')
    df['주요제품'] = df['주요제품'].fillna('')
    df['업종출처'] = df['업종출처'].fillna('-')

    df = _exclude(df, s)
    df['판정'] = np.where(df['통과개수'] == 8, '통과', '탈락')

    # 여기까지 오지 못한 나머지 종목도 사유를 적어 둡니다.
    #  · 이름으로 걸린 것 (ETF·우선주·스팩) — 주가를 받지도 않았습니다
    #  · 주가 이력이 모자란 것 (상장 1년 미만 등)
    done = set(df['코드']) | set(LAST_EXCLUDED['코드'])
    hist = {str(c) for c in close.columns}
    rest = []
    for t in tickers.itertuples():
        code = str(getattr(t, 'code', ''))
        if not code or code in done:
            continue
        nm = str(getattr(t, 'name', ''))
        why = name_reason(nm, s)
        if not why:
            price = getattr(t, 'price', None)
            if price is not None and not pd.isna(price) and price < s.min_price:
                why = f'{s.min_price:,}원 미만 저가주'
            elif code not in hist:
                why = (f'주가 이력이 {s.min_history_days}거래일에 못 미칩니다 '
                       f'— 200일선을 계산하려면 상장 후 1년이 필요합니다')
            else:
                why = '판정에 필요한 자료가 모자랍니다'
        rest.append({'코드': code, '종목명': nm,
                     '시장': str(getattr(t, 'market', '') or ''), '제외사유': why})
    if rest:
        _remember(pd.DataFrame(rest))
    print(f'[스크리닝] 대상 {len(df):,}종목 / 제외 {len(LAST_EXCLUDED):,}종목')

    return df.sort_values(['통과개수', 'RS'], ascending=False).reset_index(drop=True)


LIST_YEAR_DAYS = 252          # 약 1년. 이보다 짧으면 200일선·52주 고저가 뜻이 없습니다


def _money_px(v, s) -> str:
    """가격 문턱을 한국은 '원', 미국은 '$' 로."""
    us = getattr(s, 'markets', ['KOSPI']) == ['US']
    return f'${v:g}' if us else f'{v:,.0f}원'


def _money(v, s) -> str:
    """거래대금을 한국은 '억', 미국은 '$만' 으로 읽기 좋게."""
    us = getattr(s, 'markets', ['KOSPI']) == ['US']
    if us:
        return f'${v / 1e6:.1f}M'
    return f'{v / 1e8:.1f}억'


# 가격 고정 문턱 (2026-10-12) — 둘 다 넘지 않으면 인수합병 대기로 보고 부적합 처리합니다
FLAT_ADR10 = 0.007    # 10일 평균 (고−저)/종가 0.7% 이하
FLAT_RNG10 = 0.025    # 10일 종가 최고÷최저 − 1 이 2.5% 이하


def _exclude(df: pd.DataFrame, s) -> pd.DataFrame:
    """
    두 갈래로 나눕니다 (2026-08-26 에 바꿨습니다).

      ① **버립니다** — 애초에 개별 성장주가 아닌 것
         ETF·ETN·리츠 · 스팩 · 우선주 · 거래정지/상장폐지
         이런 것은 8조건을 매겨 봐야 뜻이 없습니다.

      ② **남기고 표시만 합니다** — 회사는 회사인데 지금 사고팔기 어려운 것
         저가주 · 거래대금 부족 · 상장 1년 미만
         전에는 이것도 버렸습니다. 그래서 검색으로 찾아보면 이름과 '제외' 라는
         말만 나오고 RS·점수·차트가 하나도 없었습니다.
         이제 **다 계산해 두고** '트레이딩 부적합' 이라고 적기만 합니다.
         (Jun 요청 2026-08-26: "모두 분석해주되 이런 종목들은 부적합이라고만")

    부적합 종목은 `부적합사유` 칸이 채워집니다. 화면은 이 칸이 있는 행을
    스크리닝 결과와 통계에서 빼고, **검색에서는 모든 값을 그대로 보여줍니다.**
    RS 순위는 이 함수보다 **먼저** 매겨지므로(전 종목 기준), 여기서 무엇을
    남기고 버리든 다른 종목의 RS 는 흔들리지 않습니다.
    """
    n0 = len(df)
    name = df['종목명'].fillna('')

    # ── ① 버릴 것 ────────────────────────────────────────
    drop = pd.Series(False, index=df.index)
    if s.exclude_spac:
        drop |= name.str.contains('스팩|기업인수목적', regex=True)
    if s.exclude_etf_etn:
        drop |= name.str.contains(ETF_PAT, case=False, regex=True)
    drop |= name.str.contains(r'우$|우B$|우C$|[0-9]우$', regex=True)      # 우선주
    drop |= df['최근거래일'].fillna(0) < MIN_RECENT_DAYS                  # 거래정지·상장폐지

    gone = df[drop].copy()
    if len(gone):
        def why_drop(r):
            t = name_reason(r['종목명'], s)
            if t:
                return t
            rd = 0 if pd.isna(r.get('최근거래일')) else int(r['최근거래일'])
            return (f'최근 10거래일 중 {rd}일만 거래됐습니다 — '
                    f'거래정지·상장폐지이거나 거래가 사실상 멈춘 종목입니다')
        gone['제외사유'] = gone.apply(why_drop, axis=1)
        _remember(gone[['코드', '종목명', '시장', '제외사유']])

    out = df[~drop].copy()

    # ── ② 남기되 '트레이딩 부적합' 이라고 적을 것 ──────────
    low_px = out['현재가'].fillna(0) < s.min_price
    thin = out['거래대금20일'].fillna(0) < s.min_trade_value
    young = out['거래일수'].fillna(0) < LIST_YEAR_DAYS if '거래일수' in out.columns \
        else pd.Series(False, index=out.index)

    def why_unfit(r):
        bits = []
        if pd.isna(r['현재가']) or r['현재가'] < s.min_price:
            bits.append(f'{_money_px(s.min_price, s)} 미만 저가주')
        v = 0 if pd.isna(r['거래대금20일']) else r['거래대금20일']
        if v < s.min_trade_value:
            bits.append(f'20일 평균 거래대금 {_money(v, s)} '
                        f'(기준 {_money(s.min_trade_value, s)}) — 원하는 가격에 사고팔기 어렵습니다')
        d = 0 if pd.isna(r.get('거래일수')) else int(r['거래일수'])
        if d < LIST_YEAR_DAYS:
            bits.append(f'거래 이력 {d}일 (1년 미만) — 200일선·52주 고저가 아직 뜻을 갖지 못합니다')
        a10, r10 = r.get('일중변동10'), r.get('종가범위10')
        if pd.notna(a10) and pd.notna(r10) and a10 <= FLAT_ADR10 and r10 <= FLAT_RNG10:
            bits.append(f'가격 고정 — 10일 평균 일중 변동 {a10 * 100:.2f}% · 종가 범위 {r10 * 100:.2f}%. '
                        f'인수합병·공개매수로 제시가에 묶인 것으로 보입니다')
        return ' · '.join(bits)

    if '일중변동10' in out.columns:
        pinned = (out['일중변동10'].fillna(1) <= FLAT_ADR10) & (out['종가범위10'].fillna(1) <= FLAT_RNG10)
    else:
        pinned = pd.Series(False, index=out.index)
    unfit = low_px | thin | young | pinned
    out['부적합사유'] = ''
    if unfit.any():
        out.loc[unfit, '부적합사유'] = out[unfit].apply(why_unfit, axis=1)

    print(f'[스크리닝] {n0:,}종목 → 버림 {int(drop.sum()):,} · '
          f'남김 {len(out):,} (그중 트레이딩 부적합 {int(unfit.sum()):,})')
    return out


def _remember(rows: pd.DataFrame):
    global LAST_EXCLUDED
    LAST_EXCLUDED = pd.concat([LAST_EXCLUDED, rows], ignore_index=True) \
        .drop_duplicates('코드', keep='first')


def summarize(df: pd.DataFrame) -> dict:
    """통계는 **트레이딩 부적합 종목을 뺀 것** 으로 냅니다 (2026-08-26).

    부적합 종목도 8조건은 매깁니다. 하지만 '오늘 몇 종목이 통과했나' 나
    '시장 온도' 에 그런 종목을 섞으면 숫자의 뜻이 달라집니다 —
    살 수 없는 종목이 통과했다고 시장이 뜨거운 것은 아니니까요.
    부적합 종목이 목록에 새로 들어왔다고 해서 예전 숫자와 달라지면 안 됩니다."""
    fit = df[df['부적합사유'].fillna('') == ''] if '부적합사유' in df.columns else df
    passed = fit[fit['판정'] == '통과']
    return {
        '전체': len(fit),
        '통과': len(passed),
        '7개통과': int((fit['통과개수'] == 7).sum()),
        '평균RS': float(fit['RS'].mean()) if len(fit) else 0.0,
        '시장온도': round(len(passed) / max(len(fit), 1) * 100, 1),
        '부적합': int(len(df) - len(fit)),
    }

# ── WICS 업종으로 바꿔치기 ────────────────────────────────
#  KRX 표준산업분류는 이름이 제각각이라 '어느 업종에 돈이 몰렸나' 를 보기에
#  결이 맞지 않습니다. WICS 는 증권가가 실제로 쓰는 분류라 리포트·시황과
#  같은 언어로 읽힙니다. 미너비니가 말하는 '주도 업종' 을 시장과 같은
#  단위로 보려는 것입니다.
#
#  tools/fetch_wics.py 가 하루 한 번 data/wics.parquet 을 만들어 둡니다.
#  파일이 없으면 아무 일도 하지 않습니다 — 예전 업종 그대로 갑니다.
#  config 를 끌어오지 않고 파일 위치에서 바로 찾습니다 (import 가 얽히지 않게).
WICS_FILE = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'wics.parquet')


def _apply_wics(df: pd.DataFrame) -> pd.DataFrame:
    if not os.path.exists(WICS_FILE) or '코드' not in df.columns:
        return df
    try:
        w = pd.read_parquet(WICS_FILE)
    except Exception:
        return df
    if 'code' not in w.columns or 'wics중분류' not in w.columns:
        return df
    w = w.rename(columns={'code': '코드'})[['코드', 'wics중분류', 'wics대분류']]
    df = df.merge(w, on='코드', how='left')
    hit = df['wics중분류'].notna() & (df['wics중분류'].astype(str).str.len() > 0)
    if '업종' not in df.columns:
        df['업종'] = pd.NA
    # WICS 에 있는 종목만 바꿉니다. 없는 종목(신규상장 등)은 예전 업종을 지킵니다.
    df.loc[hit, '업종'] = df.loc[hit, 'wics중분류']
    if '업종출처' not in df.columns:
        df['업종출처'] = pd.NA
    df.loc[hit, '업종출처'] = 'WICS'
    return df


# ═══════════════════════════════════════════════════════════════
#  종합점수 (0~100)
#
#  8조건은 '관문' 이지 점수가 아닙니다. 미너비니는 추세가 없는 종목은
#  실적이 아무리 좋아도 사지 않습니다. 그래서 관문은 그대로 두고,
#  관문 안에서 줄을 세우기 위한 점수를 따로 매깁니다.
#
#  이렇게 하면 '매출 +14.9% 와 +15.1% 의 운명이 갈리는' 절벽이 사라지고,
#  기준이 6·7개 통과 종목에도 똑같이 적용됩니다.
# ═══════════════════════════════════════════════════════════════
# 2026-08-20 개편 (사용자 결정)
#
#  왜 바꿨나 ①  미너비니의 핵심이 점수에서 빠져 있었습니다.
#   VCP 수축·52주 고점 근접·거래량·추세 지속 — 넷 다 화면에는 보여주면서
#   채점에는 안 쓰고 있었습니다. 미국 쪽만 먼저 손보고 한국을 빠뜨린 탓입니다.
#
#  왜 바꿨나 ②  한국은 이익이 주가로 잘 전이되지 않습니다.
#   주주환원(배당·자사주)이 낮으면 이익이 늘어도 주주에게 돌아오지 않아
#   주가 반응이 약합니다. 게다가 환원하지 않은 이익이 자기자본으로 쌓여
#   같은 EPS 증가율이라도 '더 많은 자본을 써서 만든' 것이 됩니다.
#   → 실적의 예측력이 미국보다 낮다고 보고 실적 층 비중을 낮췄습니다.
#   → 뺀 몫은 RS·52주 고점 근접으로 옮겼습니다.
#     '실적이 주가로 전이됐는지' 는 결국 가격이 이미 말해 주기 때문입니다.
#
#  ※ EPS 증가율 자체는 한국이 오히려 정직합니다. 미국은 자사주 매입으로
#    분모(주식수)가 줄어 EPS 가 순이익보다 빨리 늘거든요. 한국은 그 효과가 적어
#    EPS 증가율 ≈ 순이익 증가율 입니다. 낮춘 이유는 '전이' 이지 '왜곡' 이 아닙니다.
#
#     전:  RS 25 · EPS 20 · 매출 15 · 자금흐름 15 · 수급 10 · 피벗 15
#     후:  RS 21 · EPS 12 · 매출 11 · 자금흐름 6 · 수급 5 · 피벗 12
#          + 52주 고점 11 · VCP 10 · 거래량 6 · 추세 지속 6
# 2026-08-20 3차 — 점수에서 '타이밍' 을 뺐습니다.
#
#  왜: 피벗 자리와 거래량은 이미 표에 각각 칸으로 있습니다(상태 칸 · 거래량 칸).
#      그것을 점수에 또 넣으면서 세 가지 문제가 생겼습니다.
#       ① 종목의 질은 그대로인데 자리만 바뀌어 하루에 20점씩 흔들렸습니다.
#       ② 두 항목이 평균 34%·37% 밖에 안 나와(실측) 점수 천장이 낮아졌습니다.
#          118종목 중 90점이 0개, 80점이 2개뿐이었습니다.
#       ③ 베이스에서 잘 다지는 훌륭한 종목이, 어중간한데 마침 돌파한 종목보다
#          아래에 놓였습니다.
#
#  이제 종합점수는 "이 종목이 얼마나 좋은가" 하나만 답합니다.
#  "지금 살 자리인가" 는 상태 칸과 [피벗권] 칩이 답합니다.
#  미너비니의 실제 순서(후보를 추리고 → 자리를 기다린다)와 같습니다.
# ═══════════════════════════════════════════════════════════════
# 2026-08-30 배점 개편 — **백테스트로 정했습니다**
#   tools/backtest_weights.py 로 2020~2026년 61개 시점(표본 27,722건,
#   겹치지 않는 구간 20개)을 되짚어 항목별 예측력(IC)을 재고,
#   배점안 20여 개를 맞붙여 정했습니다.
#   자세한 것은 프로젝트 문서 '배점-검증-백테스트-2026-08-30' 에 있습니다.
#
#   ■ 왜 바꿨나 — **옛 배점은 점수를 안 매기느니만 못했습니다.**
#       옛 배점 상위 20종목  -0.84%   (최악 -57.4%)
#       8조건 통과 종목 전부  +0.70%   (최악 -41.3%)
#     점수를 매기는 행위가 오히려 1.5%p 손해를 끼치고 있었습니다.
#
#   ■ 원인 — **문턱을 순위표로 옮겨 쓴 것.**
#     8조건 ⑧번이 이미 'RS 70↑' 을 거릅니다. 그런데 통과한 종목들 사이에서
#     RS 에 26점을 더 줬습니다. 그건 "더 많이 오른 것을 더 사겠다" 는 뜻이고,
#     미너비니가 반복해서 경고하는 '뻗은(extended) 종목' 을 맨 위로 올립니다.
#     같은 함정에 빠진 항목이 넷이고, 넷 다 IC 가 음수였습니다.
#       RS -0.107 · 자금(U/D) -0.141 · 저점대비 -0.114 · 직전상승 -0.170
#
#   ■ RS 배점과 최악 낙폭 — 세 번의 백테스트에서 예외가 없었습니다.
#       RS 41 → -57.4% | RS 28 → -45.7% | RS 12 → -39.6% | RS 0 → -21.6%
#     평균수익 차이는 구별이 안 되는데 낙폭은 35%p 벌어집니다.
#
#   ■ 넣지 않기로 한 것 (전부 실측 근거)
#       거래대금  t 1.45 로 유의하지 않고, 넣은 쪽이 더 나빴습니다
#       거래량    IC -0.028 (뒤집어도 배점안으로는 뺀 쪽이 우위)
#       저점대비  IC -0.114
#       베이스깊이 IC 는 +0.168 로 최강이었지만 고점대비와 **-0.748 로 겹칩니다**.
#                맞대결에서도 고점대비만 쓴 쪽이 이겼습니다.
#       자금(U/D) 61시점 중 **맞힌 적 0회**. 화면 칸으로는 남깁니다 —
#                순위에 나쁜 것과 정보로 쓸모없는 것은 다릅니다.
#
#   ⚠️ EPS·매출·수급(합 36점)은 **과거 자료가 없어 검증하지 못했습니다.**
#      "쓸모없다" 가 아니라 "시험을 못 했다" 입니다. 이익 가속은 SEPA 의
#      기둥이라 손대지 않았습니다. 과거 분기 실적을 모으면 그때 다시 봅니다.
# ═══════════════════════════════════════════════════════════════
# ═══════════════════════════════════════════════════════════════
#  2026-10-10 한국 배점 개편 (Jun 승인) — 가격 항목 64점을 다시 나눴습니다
#
#   검증: 맥에서 한국 2,350종목 일봉(네이버)으로 2024-11~2026-07, 5거래일마다 79시점.
#         그날 8조건 통과 종목의 항목 값 ↔ 이후 20일 수익률 순위상관(IC).
#
#     항목                   IC20    t    앞1년  뒤1년   →
#     일중 변동 5일(작을수록) +0.113  6.0   +.107  +.119   12점 (신설)
#     10일 범위(작을수록)     +0.105  5.9   +.109  +.101   12점 (신설)
#     20일 고가 근접          +0.070  5.1   +.070  +.069    8점 (신설)
#     52주 고점 근접          +0.058  4.4   +.054  +.063   22 → 12
#     8조건 유지일            +0.057  4.3   +.062  +.052    8 → 12
#     거래량 5일÷50일(작을수록)+0.046  2.9   +.080  +.013    8점 (신설)
#     VCP 수축비              +0.025  1.8   +.058  −.007   12 → 0  (뒤 1년 뒤집힘)
#     수축 횟수               +0.021  1.6   +.012  +.029   12 → 0  (8/30 의 +0.099 가 재현 안 됨)
#     8조건 통과 개수          — 목록 종목은 모두 8개라 순위를 못 가름 —  10 → 0
#     20일선 위 15% 넘게 떠 있음  IC +0.060(감점 쪽이 맞음)  → 감점 −5 · 25% 넘으면 −8
#     자금 U/D               −0.103 t −7.9  — 0점 유지 (높을수록 덜 오릅니다)
#
#   ⚠️ 같은 2년(대체로 상승장) · 상장폐지 종목 빠진 자료입니다. EPS·매출·수급 36점은 그대로입니다.
#      미국은 따로 검증해 다른 배점을 썼습니다 (US_W_* 쪽 표).
#   화면(app.html)은 점수내역이 9칸이면 이 차례(PARTS_KR)로, 8칸이면 예전 차례로 읽습니다.
# ═══════════════════════════════════════════════════════════════
W_RS = 0                       # 순위에서 뺐습니다 — 문턱은 8조건 ⑧번이 겁니다
W_EPS, W_SALES, W_SUPPLY = 16, 14, 6
W_UD = 0                       # 61시점 중 맞힌 적 0회 · 2026-10-10 재검증 IC −0.103
W_HI, W_VCP, W_STAY = 12, 0, 12   # 2026-10-10: 고점 22→12 · VCP 12→0 · 지속 8→12
W_PASS = 0                     # 2026-10-10: 10→0 (목록 종목이 모두 같은 값)
W_CONTR = 0                    # 2026-10-10: 12→0 (재검증 IC +0.021, t 1.6)
W_ADR, W_RNG, W_NEAR, W_DRY = 12, 12, 8, 8   # 2026-10-10 신설 — 위 표
W_STAGE = W_VOL = 0            # 점수에서 뺐습니다 (표의 칸으로만 봅니다)

STAGE_SCORE = {'피벗권': 1.0, '돌파': 0.85, '재시도': 0.55, '베이스': 0.6, '추세유지': 0.25, '되돌림': 0.05}
# RS 만점선 — 미너비니가 말하는 주도주는 대개 90대입니다.
#  99 를 만점으로 두면 전 시장 1등만 만점이라 눈금이 실제로 쓰이지 않습니다.
RS_FULL = 90
UD_FULL = 1.20
#  2026-08-27: '이탈' 을 0.0 → 0.15. 파는 것은 나쁘지만 '자료 없음(0.5)' 과의
#  거리가 너무 벌어져 있었습니다. 감점은 [하락의 질] 이 따로 맡습니다.
SUPPLY_SCORE = {'쌍끌이': 1.0, '외인': 0.5, '기관': 0.5, '이탈': 0.15}


def _lerp(v, lo, hi):
    """lo 에서 0, hi 에서 1. 그 밖은 잘라냅니다."""
    if v is None or pd.isna(v) or hi == lo:
        return None
    return float(min(1.0, max(0.0, (v - lo) / (hi - lo))))


# ═══════════════════════════════════════════════════════════════
#  2026-08-27 — '기준 미달 = 0점' 을 없앴습니다 (사용자 결정)
#
#  무엇이 문제였나
#   채점이 이기거나 없거나(win-or-nothing) 였습니다. RS 를 예로 들면
#   `_lerp(RS, 70, 90)` 이라서 **RS 69 와 RS 5 가 똑같이 0점** 이었습니다.
#   RS 69 는 시장 상위 31% 인데 꼴찌와 같은 대접을 받은 셈입니다.
#   52주 고점(-25% 밑), VCP(수축비 1.0 위), 성장률(0% 이하)도 모두 같았습니다.
#   그래서 8조건을 다 못 채운 종목의 점수가 한 덩어리로 바닥에 몰려
#   '어느 쪽이 그나마 나은가' 를 점수로는 알 수 없었습니다.
#
#  어떻게 바꿨나 — 기준선을 **0점이 아니라 낮은 점수(보통 만점의 30~35%)** 로 둡니다.
#   기준선 아래로는 거기서 다시 0 을 향해 매끄럽게 내려갑니다.
#
#      만점선 ┤                          ●━━━━ 1.0
#             │                    ╱
#      기준선 ┤          ●━━━━━━━━╱            0.35   ← 전에는 여기가 0 이었습니다
#             │      ╱
#      0점선  ┤●━━━╱                            0.0
#
#   ※ 걸러내는 일은 여전히 **8조건 관문**이 합니다. 점수는 줄을 세울 뿐입니다.
#     그러니 점수에 바닥을 깔아도 '나쁜 종목이 통과하는' 일은 생기지 않습니다.
def _ramp(v, zero, base, full, base_frac=0.35):
    """기준선(base)에서 base_frac, 만점선(full)에서 1.0, 0점선(zero)에서 0.

    full < base < zero 처럼 **거꾸로 된 눈금**(작을수록 좋은 값)도 그대로 됩니다.
    VCP 수축비가 그런 경우입니다 — 0.5 가 좋고 1.6 이 나쁩니다.
    """
    if v is None or pd.isna(v) or full == base or base == zero:
        return None
    v = float(v)
    up = (v - base) / (full - base)          # 기준선 0, 만점선 1
    if up >= 0:
        return base_frac + (1.0 - base_frac) * min(1.0, up)
    lo = (v - zero) / (base - zero)          # 0점선 0, 기준선 1
    return base_frac * min(1.0, max(0.0, lo))


RS_ZERO = 0.0          # RS 0 이라야 비로소 0점 (전에는 70 밑이 전부 0점)
HI_ZERO = -0.60        # 52주 고점 대비 -60% 라야 0점 (전에는 -25% 밑이 전부 0점)
UD_ZERO = 0.60         # 사는 쪽이 파는 쪽의 60% 밖에 안 될 때 0점
VCP_ZERO = 1.60        # 변동폭이 1.6배로 늘어야 0점 (전에는 1.0 위가 전부 0점)
BASE_FRAC = 0.35       # 기준선에서 받는 몫
GROW_ZERO = -0.50      # 역성장 -50% 라야 0점 (전에는 조금만 역성장해도 감점)
GROW_BASE = 0.30       # 성장률 0% 에서 받는 몫


def _grow_frac(v, target) -> float:
    """성장률 → 0~1. 목표에서 1.0, **0% 성장에서 0.30**, -50% 에서 0.

    2026-08-27: 전에는 0% 성장이 0점, 역성장이면 배점의 절반을 **빼앗았습니다**.
    +0.1% 와 -0.1% 사이에 배점의 80% 가 걸린 절벽이었습니다.
    이제 0% 를 바닥이 아니라 '낮은 점수' 로 두고, 역성장은 매끄럽게 내려갑니다.
    점수를 마이너스로 만들지는 않습니다 — 감점은 [하락의 질] 이 따로 맡습니다.
    """
    v = float(v)
    if v >= 0:
        return GROW_BASE + (1.0 - GROW_BASE) * min(1.0, v / target)
    #  v 도 GROW_ZERO 도 음수입니다. v/GROW_ZERO 는 0%에서 0, -50%에서 1 이 됩니다.
    return GROW_BASE * max(0.0, min(1.0, 1.0 - (v / GROW_ZERO)))


def _growth_pts(v, prev, target, weight, small):
    """성장률 점수(한국). 전년이 작아 부풀려진 값에는 상한을 둡니다."""
    if v is None or pd.isna(v):
        return weight * 0.5                      # 확인 못 함 — 중립
    if v >= 900:                                 # 흑자 전환: 좋지만 크기를 잴 수 없음
        return weight * 0.8
    pts = weight * _grow_frac(v, target)
    if prev is not None and not pd.isna(prev) and abs(prev) < small and v >= 1.0:
        pts = min(pts, weight * 0.6)             # 기저효과 — 만점은 주지 않습니다
    return pts


# ── 하락의 질 감점 (최대 -20) ────────────────────────────────
#  왜 필요한가:
#   전에는 주가가 내려와 '추세유지'에서 '돌파'로 자리가 바뀌면 점수가 9점 올랐습니다.
#   하락이 가점이 된 셈입니다. 그런데 대량 거래를 동반한 하락은 큰손이 파는 것이라
#   미너비니가 가장 경계하는 신호(분산)입니다. 그것을 깎지 않으면
#   '떨어져서 좋아 보이는' 종목이 맨 위에 옵니다.
#
#  2026-08-18 개정 — 계단을 없앴습니다.
#   전에는 -5% 든 -15% 든 똑같이 7점이었습니다. 폭락이 급락과 같은 대접을
#   받은 셈입니다. 이제 하락 폭에 비례해 매끄럽게 커지고,
#   거래량이 많을수록 더 깎습니다. 대량 거래를 동반한 하락일수록
#   분산 신호가 강하다는 미너비니 논리 그대로입니다.
#
#     깊이 = 3.0 + 130 x (하락률 - 2%)      상한 13
#     배수 = 1.0 + 0.4 x (거래량비 - 1.5)/1.5   상한 1.4  (3배에서 최대)
#     감점 = 깊이 x 배수                     최대 18.2
#
#   -3% 1.5배 →  4.3 |  -5% 1.5배 →  6.9 (전 7점과 거의 같음)
#   -8% 1.5배 → 10.8 | -12% 3.0배 → 18.2
DROP_MAX = 20.0
VOL_ON = 1.5          # 이 배수를 넘어야 '거래량이 실렸다'고 봅니다
VOL_FULL = 3.0        # 여기서 배수 가중이 최대(1.4배)가 됩니다
DEPTH_ON = 0.02       # 이 하락률부터 깎기 시작합니다
DEPTH_CAP = 13.0      # 깊이만으로 받을 수 있는 최대 감점


def _drop_depth(rate: float) -> float:
    """하락 폭 자체의 감점. -2% 에서 3점, 아래로 갈수록 매끄럽게 커집니다."""
    return min(DEPTH_CAP, 3.0 + 130.0 * (abs(rate) - DEPTH_ON))


def _vol_mult(vr: float) -> float:
    """거래량 가중. 1.5배에서 1.0, 3배 이상에서 1.4."""
    t = (vr - VOL_ON) / (VOL_FULL - VOL_ON)
    return 1.0 + 0.4 * min(1.0, max(0.0, t))


def _drop_penalty(r, ext: bool = True) -> tuple[float, str]:
    """(감점, 사유). 감점은 0 이상의 값이고 점수에서 뺍니다.
    ext=False 면 확장 감점을 건너뜁니다 (지금은 한국·미국 모두 켭니다 — 2026-10-10 두 시장 모두 검증)."""
    pen = 0.0
    why = []
    rate = r.get('등락률')
    vr = r.get('당일거래량비')
    rate = None if rate is None or pd.isna(rate) else float(rate)
    vr = None if vr is None or pd.isna(vr) else float(vr)

    # ① 대량 거래를 동반한 하락 = 분산일. 폭과 거래량에 비례합니다.
    if rate is not None and rate <= -DEPTH_ON and vr is not None and vr >= VOL_ON:
        d = round(_drop_depth(rate) * _vol_mult(vr), 1)
        pen += d
        word = ('대량 급락' if rate <= -0.05
                else '대량 하락' if rate <= -0.03
                else '거래량 실린 하락')
        why.append(f'{word} {rate * 100:.1f}%·거래량 {vr:.1f}배 (−{d:.1f})')

    # ② 20일선 이탈 — 돌파 이후 가장 먼저 무너지는 선입니다
    px, ma20 = r.get('현재가'), r.get('20일선')
    if px is not None and ma20 is not None and not pd.isna(px) and not pd.isna(ma20) \
            and ma20 > 0 and px < ma20:
        pen += 4; why.append('20일선 아래 (−4)')

    # ② 확장 (2026-10-10) — 20일선 위로 너무 떠 있으면 사는 자리가 아닙니다.
    #  검증: 20일선 대비 +15% 넘는 종목이 이후 20일 덜 올랐습니다 (IC +0.060 · 두 기간 모두).
    #  20일선 이격 분포는 중앙값 +5% · 상위 10% +23% 입니다.
    if ext and px is not None and ma20 is not None and not pd.isna(px) and not pd.isna(ma20) and ma20 > 0:
        ex = px / ma20 - 1
        if ex > 0.25:
            pen += 8; why.append(f'20일선 +{ex * 100:.0f}% 확장 (−8)')
        elif ex > 0.15:
            pen += 5; why.append(f'20일선 +{ex * 100:.0f}% 확장 (−5)')

    # ③ 돌파 직후 급반락 — 최근 5일 고점에서 8% 넘게 밀렸으면 돌파가 흔들린 것입니다
    d5 = r.get('5일고점대비')
    stage = str(r.get('피벗상태') or '')
    #  2026-10-10: '돌파구간' 을 더했습니다. 2026-08-23 에 '피벗권' 을 '돌파구간' 으로 바꾼 뒤
    #  이 줄만 옛 이름으로 남아, 같은 밴드에서 재시도만 깎이고 돌파구간은 안 깎였습니다.
    if d5 is not None and not pd.isna(d5) and d5 <= -0.08 and stage in ('돌파', '돌파구간', '피벗권', '재시도', '추세유지'):
        pen += 5; why.append(f'5일 고점 대비 {d5 * 100:.0f}% (−5)')

    return round(min(pen, DROP_MAX), 1), ' · '.join(why)


# ═══════════════════════════════════════════════════════════════
#  미국용 종합점수
#
#  미국에는 분기 실적(EPS·매출)도, 외국인·기관 수급 공시도 없습니다.
#  한국 배점을 그대로 쓰면 그 45점이 '중립' 으로 고정되어 최고점이 77점에
#  갇힙니다. 90점·80점 뱃지가 영영 비게 되죠.
#
#  그래서 미국에서 실제로 잴 수 있는 것에 45점을 돌립니다.
#  뜻은 한국과 같습니다 — '추세·자리·매집이 얼마나 갖춰졌나'.
#
#    RS 25 · 자금흐름 20 · 피벗 20 · 52주 고점 근접 15 · 가격수축 10 · 거래량 10
#
#  거래량은 자리에 따라 방향이 뒤집힙니다.
#   돌파·피벗권이면 실려야 좋고, 베이스·추세유지이면 말라야 좋습니다.
#   한 방향으로만 주면 '베이스에서 거래량이 터진' 종목이 좋아 보입니다.
# ═══════════════════════════════════════════════════════════════
# 2026-08-20 배점 조정 (사용자 결정)
#   자금흐름 20 → 10  : 20점은 '미국에서 큰손을 볼 수 있는 유일한 창' 이라는
#                       자료 사정으로 정한 값이었지 근거가 아니었습니다.
#                       UD비율은 50일 거래량 비율이라 잡음이 많습니다.
#   피벗 자리 20 → 15 : 돌파(20) → 되돌림(1) 로 하루에 19점이 날아가
#                       종목의 질은 그대로인데 순위가 뒤집혔습니다.
#   VCP     10 → 13  : 미너비니 방법론의 중심이라 비중을 올립니다.
#   추세 지속  신설 12 : '추세는 지속된다' 는 추세추종의 전제를 점수에 반영합니다.
#                       8조건을 40거래일째 지킨 종목과 어제 막 들어온 종목을
#                       똑같이 취급하고 있었습니다.
# 2026-08-20 2차 — 실적을 넣었습니다.
#  왜: 미국 점수에 실적이 0점이라 매출도 이익도 없는 임상단계 바이오텍이
#      가격·거래량만으로 만점을 받고 상위를 도배했습니다(모더나·앱사이·프락시스…).
#      미너비니 SEPA 에서 실적은 절반의 무게인데 우리는 아예 안 보고 있었습니다.
#  자료가 없으면 중립(40%) — 커버리지가 82% 에서 더 오르지 않는 것을 확인했으므로
#  '90% 넘으면 넣겠다' 던 조건은 영영 오지 않습니다. 대신 모르는 것을 벌주지 않습니다.
# 2026-08-20 3차 — 한국과 같은 이유로 피벗 자리·거래량을 점수에서 뺐습니다.
# 2026-08-31 개편 — **한국과 같은 뼈대로 맞췄습니다** (미국 5년치 백테스트 뒤).
#  44개 시점(상승 23·하락 21)으로 재어 본 결과:
#    · RS   IC −0.036 · t −2.15 · 상승장 +0.004 · 하락장 −0.080
#      → 한국(−0.055/−0.107)과 같은 방향. 두 시장·다른 기간·다른 종목에서
#        같은 답이 나왔으므로 **0점**으로 확정합니다. 문턱은 8조건 ⑧번이 겁니다.
#    · 자금(U/D)  IC −0.023 · t −2.56 · 두 국면 모두 음(−)
#      → "미국은 수급 자료가 없으니 U/D 가 유일한 창" 이라는 명분이 자료로
#        기각됐습니다. 유일한 창이어도 그 창으로 보이는 것이 틀렸으면 안 봅니다.
#        채점표에서 빼고 화면 아래 참고 상자로만 보여줍니다 (한국과 같음).
#    · 고점대비  IC +0.023 · t 1.22 · 상승장 −0.055
#      → 한국에서 30점을 준 근거가 미국에는 없습니다. 다만 8조건 ⑦번
#        (고점 −25% 이내)은 미국에서 t 4.15 로 여덟 조건 중 가장 강했습니다.
#        **문턱으로서는 강하고 순위로서는 약하다** 는 뜻이라, 문턱은 8조건에
#        맡기고 순위 배점은 30 → 22(한국)·24(미국)로 낮춥니다.
#    · 수축개수  t 2.85 · 맞힌비율 66%  → 두 시장 모두 +. 4점은 너무 낮았습니다.
#  ※ 수급 6점이 미국에는 없어(미국은 투자자 유형별 수급을 공표하지 않습니다)
#    그만큼을 가격 항목에 비율대로 얹었습니다.
# ═══════════════════════════════════════════════════════════════
#  2026-10-10 미국 배점 개편 (Jun 승인) — 한국과 **다르게** 정했습니다
#
#   검증: 맥에서 미국 5,027종목 일봉(야후 — 서버 Massive 와 같은 종목, 키가 서버에만 있어 대신 씀)
#         2024-12~2026-10, 5거래일마다 79시점. 8조건 통과 종목 ↔ 이후 20일 수익 순위상관(IC).
#
#     항목                    미국 IC20  t    (한국)    →
#     일중 변동 5일(작을수록)  +0.040   1.7  (+0.113)   14점 (신설)
#     10일 범위(작을수록)      +0.033   1.5  (+0.105)   10점 (신설)
#     VCP 수축비              +0.021   2.2  (+0.025)   13 → 14 (미국은 두 기간 모두 + 라 남김)
#     52주 고점 근접           +0.021   1.3  (+0.058)   24 → 14
#     거래량 5일÷50일(작을수록) +0.021   2.0  (+0.046)    8점 (신설)
#     20일 고가 근접           +0.023   1.5  (+0.070)    6점 (신설)
#     8조건 유지일            −0.014  −1.5  (+0.057)   10 → 4  (미국은 반대로 나옴)
#     되돌림 횟수              +0.005   0.3  (+0.021)   13 → 0
#     8조건 통과 개수           — 목록 종목이 모두 같은 값 —      10 → 0
#     20일선 위 15% 넘게 떠 있음  +0.039 t 2.8 → 확장 감점을 미국에도 겁니다
#
#   ⚠️ 미국은 모든 가격 항목의 예측력이 한국의 1/3 수준으로 약합니다. 셋업 진입(웹 셋업 탭 v3)도
#      미국에서는 PF 0.97 로 효과가 재현되지 않았습니다. 배점을 바꿔도 효과는 작을 것입니다.
# ═══════════════════════════════════════════════════════════════
US_W_PASS = 0                  # 2026-10-10: 10→0 (목록 종목이 모두 같은 값)
US_W_EPS, US_W_SALES = 16, 14  # 실적 30점 고정 (Jun 결정)
US_W_HI, US_W_VCP = 14, 14     # 2026-10-10: 고점 24→14 · VCP 13→14
US_W_CONTR = 0                 # 2026-10-10: 13→0 (IC +0.005)
US_W_STAY = 4                  # 2026-10-10: 10→4 (미국 IC −0.014)
US_W_ADR, US_W_RNG, US_W_NEAR, US_W_DRY = 14, 10, 6, 8   # 2026-10-10 신설
US_W_RS = US_W_UD = 0          # 위 설명 참고 — 순위에서 뺐습니다
US_W_STAGE = US_W_VOL = 0      # 점수에서 뺐습니다 (표의 칸으로만 봅니다)
STAY_FULL = 40.0               # 8조건을 40거래일 이상 지키면 만점

US_RS_FULL = 90
US_UD_FULL = 1.20
US_HI_FLOOR = -0.25            # 8조건이 요구하는 '52주 고점 -25% 이내' 를 눈금으로
VCP_SCORE = {'수축': 1.0, '수축(약)': 0.6}
BREAKOUT = ('돌파', '피벗권', '재시도')   # 거래량이 실려야 좋은 자리


VOL_BREAK_FULL = 1.5           # 돌파일 거래량 +50% — 미너비니가 보는 확인선
VOL_DRY_FULL = 0.6             # 베이스에서 이만큼 마르면 만점


def _fv(v):
    return None if v is None or pd.isna(v) else float(v)


def _vol_pts(r, weight: float = None) -> float:
    """
    거래량 점수. 자리에 따라 좋은 방향이 뒤집힙니다.

    돌파·피벗권 — 실려야 합니다.
      미너비니는 돌파한 '그날' 거래량이 평소보다 40~50% 이상 늘었는지를 봅니다.
      거래량 없는 돌파는 가짜일 때가 많습니다.
      그래서 당일 거래량비와 최근 5일 거래량비 중 **큰 쪽**을 씁니다.
      5일 평균만 보면 돌파 순간의 폭증이 나흘치 평범한 날에 묻혀 버리고,
      당일만 보면 사흘 전에 터진 돌파를 놓칩니다.

    베이스·추세유지·되돌림 — 말라야 합니다.
      수축 구간에서 거래량이 늘어난다는 것은 누군가 내놓고 있다는 뜻입니다.
      여기서는 5일 평균을 봅니다(하루치는 우연일 수 있습니다).
    """
    w = US_W_VOL if weight is None else float(weight)
    stage = str(r.get('피벗상태') or '')
    day = _fv(r.get('당일거래량비'))
    week = _fv(r.get('최근거래량_비율'))

    if stage in BREAKOUT:
        vals = [v for v in (day, week) if v is not None]
        if not vals:
            return w * 0.4                       # 모르면 중립보다 조금 아래
        v = max(vals)
        return w * min(1.0, max(0.0, (v - 1.0) / (VOL_BREAK_FULL - 1.0)))

    if week is None:
        return w * 0.4
    return w * min(1.0, max(0.0, (1.0 - week) / (1.0 - VOL_DRY_FULL)))


# 적자 회사의 EPS 는 증가율이 성립하지 않아 방향만 옵니다(fetch_sec.py 참고).
#  적자축소는 흑자 회사의 '보통' 만큼, 적자확대는 확실히 아래로 둡니다.
LOSS_SCORE = {'적자축소': 0.50, '적자지속': 0.30, '적자확대': 0.15}


def _growth_pts_us(v, state, target, weight) -> float:
    """
    미국 실적 점수. 한국판(_growth_pts)과 두 가지가 다릅니다.

      · 자료 없음을 0.5(중립) 가 아니라 0.4 로 둡니다.
        미국은 5분의 1이 빈칸이라, 빈칸에 후한 점수를 주면
        '자료가 없다는 이유로' 상위에 오르는 종목이 생깁니다.
      · 적자 회사는 '적자축소/지속/확대' 방향으로 채점합니다.
        매출이 아예 없는 임상단계 회사를 중립으로 두면 여전히 상위에 오릅니다.

    기저효과(전년이 작아 부풀려진 값) 상한은 두지 않습니다.
    미국 EPS 는 달러라 한국의 '100원 미만' 잣대를 그대로 쓸 수 없고,
    억지로 옮기면 정상적인 저가 EPS 종목까지 깎이기 때문입니다.
    """
    if v is None or pd.isna(v):
        if state in LOSS_SCORE:
            return weight * LOSS_SCORE[state]
        return weight * 0.4
    if v >= 900:                                 # 흑자 전환
        return weight * 0.8
    return weight * _grow_frac(v, target)


VCP_TIGHT = 0.50               # 첫 구간의 절반으로 조여들면 만점


def _vcp_pts(r, weight: float) -> float:
    """
    VCP 점수 — 변동폭이 얼마나 조여들었는지를 **연속으로** 잽니다.

    수축비 = 마지막 구간 변동폭 ÷ 첫 구간 변동폭
      0.50 이하 → 만점 (절반으로 조여듦)
      0.75      → 50%
      1.00 이상 → 0점 (안 줄거나 오히려 늘어남)

    세 구간이 연속으로 줄어든 '수축' 종목은 최소 60% 를 보장합니다.
    순서대로 조여든 것 자체가 미너비니가 보는 모양이라, 폭이 조금 덜 줄었다고
    끌어내리지는 않습니다.

    수축비를 못 구한 종목(자료 부족)은 예전 방식(세 단계)으로 채점합니다.
    """
    ratio = _fv(r.get('수축비'))
    tag = str(r.get('수축_추세') or '')
    if ratio is None or ratio <= 0:
        #  2026-08-27: 못 잰 종목에 0 이 아니라 낮은 점수(25%)를 줍니다.
        #  '수축이 없다' 와 '잴 수 없었다' 는 다른 이야기입니다.
        return weight * VCP_SCORE.get(tag, 0.25)
    v = _ramp(ratio, VCP_ZERO, 1.0, VCP_TIGHT, 0.30)
    if v is None:
        v = 0.25
    if tag == '수축':
        v = max(v, 0.6)
    return weight * v


def _hi_pts(r, weight: float) -> float:
    """52주 고점 근접도 — 신고가에 가까울수록 만점, -25% 에서 0점.

    8조건 ⑦ 이 요구하는 '고점 대비 -25% 이내' 를 그대로 눈금으로 씁니다.
    '52주 고점 근처' 자체가 독립적인 모멘텀 현상으로 알려져 있어
    RS 와 겹친다기보다 서로를 보강합니다.
    """
    hi = _fv(r.get('고점대비'))
    if hi is None:
        return weight * 0.3
    #  2026-08-27: -25% 가 0점이 아니라 35% 입니다. -60% 라야 0 이 됩니다.
    v = _ramp(hi, HI_ZERO, US_HI_FLOOR, 0.0, BASE_FRAC)
    return weight * (0.3 if v is None else v)


def _stay_pts(r, weight: float = None) -> float:
    """
    추세 지속 점수 — 8조건(또는 7조건)을 며칠째 지키고 있는가.

    추세추종의 전제는 '한번 난 추세는 지속된다' 입니다. 그렇다면 어제 막
    조건을 채운 종목과 두 달째 지키고 있는 종목을 같게 볼 이유가 없습니다.
    잔류일은 이미 계산해 화면에 보여주고 있었는데 점수에는 안 쓰고 있었습니다.

    자료가 없으면 0 이 아니라 중립보다 조금 아래(35%)를 줍니다 —
    모르는 것을 벌주지 않되 상주지도 않는 원칙은 다른 항목과 같습니다.
    """
    w = US_W_STAY if weight is None else float(weight)
    v = _fv(r.get('잔류일'))
    if v is None or v <= 0:
        return w * 0.35
    return w * min(1.0, 0.35 + 0.65 * (v / STAY_FULL))


CONTR_FULL = 4.0      # 되돌림 4회 이하면 만점
CONTR_ZERO = 32.0     # 32회를 넘으면 0점 (실측 90% 지점)


def _pass_pts(r, weight: float) -> float:
    """
    8조건을 몇 개 채웠나 (2026-08-30, Jun 제안).

    RS 를 대신합니다. RS 는 상한이 없어 많이 오른 종목이 끝없이 위로 오지만,
    통과개수는 8 에서 천장이 있어 그 편향이 구조적으로 없습니다.

    목록에 오르는 것은 6·7·8 뿐이므로 그 구간에 눈금을 폅니다.
      8개 → 만점 · 7개 → 절반 · 6개 이하 → 0
    (Jun 의 원안은 '하나당 -1.5' 였는데, 그러면 7.0~10.0 세 값만 쓰여
     10점짜리 항목이 3점 폭만 움직입니다. 같은 뜻을 넓게 편 것입니다.)

    ※ 조건마다 값어치가 크게 다릅니다(IC 편차 0.148 — ⑦고점대비 +0.105 vs
       ⑥저점대비 -0.043). 그래서 '균등 감점' 자체는 근거가 약합니다.
       다만 조건끼리 0.5 넘게 겹치는 짝은 없어 중복 계산 문제는 없습니다.
       조건별 가중은 다음 검증 과제로 남겨 둡니다.
    """
    v = _fv(r.get('통과개수'))
    if v is None:
        return weight * 0.35
    return weight * min(1.0, max(0.0, (v - 6.0) / 2.0))


def _contr_pts(r, weight: float) -> float:
    """
    수축이 몇 번이었나 — **적을수록** 좋습니다 (2026-08-30).

    미너비니가 세는 수축(T)은 보통 2~6회입니다. 되돌림이 계속 반복된다는 것은
    아직 매물이 소화되지 않았다는 뜻이라, 깔끔한 베이스가 낫습니다.
    IC +0.099 (t 6.95, 61시점 중 49개 적중, 두 국면 모두 +).

    ⚠️ 2026-08-30 눈금을 다시 잡았습니다 (실측하고 고쳤습니다).
       처음에는 '2회 이하 만점 · 8회 이상 0점' 으로 두었습니다. 미너비니가
       세는 수축(T)이 보통 2~6회라기에 그 범위에 맞춘 것인데, **실제 분포는
       전혀 달랐습니다** — 통과 214종목의 중앙값이 21회, 최대 47회였고
       68%가 16회를 넘었습니다. 그 눈금대로면 3분의 2가 0점이라 4점짜리
       항목이 죽어 버립니다.

       원인은 우리 셈이 미너비니의 T 와 다르기 때문입니다. 우리는 130일
       안에서 6% 이상 되돌림을 **전부** 셉니다. 변동성 큰 코스닥 종목이면
       6% 움직임이 사흘에 한 번씩 나오니 40회도 나옵니다.
       그러니 이 값은 'T' 가 아니라 **'고점 이후 얼마나 자주 출렁였나'** 입니다.

       그래도 배점은 남깁니다 — 백테스트에서 **이 값 그대로** 재서 IC +0.099
       (t 6.95, 두 국면 모두 +) 이 나왔습니다. 이름과 다른 것을 재고 있을 뿐
       재는 것 자체에는 예측력이 있습니다. 그리고 백테스트는 원값의 **순위**로
       겨뤘지 아래 눈금을 쓰지 않았습니다. 포화되는 눈금은 그 순위 정보를
       뭉개므로, 실제 분포에 맞추는 편이 검증한 것에 더 가깝습니다.

       새 눈금은 실측 분포의 10~90% 언저리입니다 — 4회 이하 만점 · 32회 이상 0점.
    """
    v = _fv(r.get('수축개수'))
    if v is None:
        return weight * 0.5
    return weight * min(1.0, max(0.0, (CONTR_ZERO - v) / (CONTR_ZERO - CONTR_FULL)))


def _lin_pts(v, full, zero, weight: float) -> float:
    """full 에서 만점, zero 에서 0 — 사이는 곧은 선. full > zero 든 full < zero 든 됩니다.
    값이 없으면 만점의 35% (모르는 것을 벌주지도 상주지도 않는 다른 항목과 같은 원칙).
    눈금은 2026-10-10 검증 때 8조건 통과 종목의 실제 분포에서 잡았습니다
    (대략 상위 10% 언저리 만점 · 하위 10% 언저리 0점)."""
    v = _fv(v)
    if v is None:
        return weight * 0.35
    t = (v - zero) / (full - zero)
    return weight * min(1.0, max(0.0, t))


def _rs_pts(r, rs_min: float, weight: float) -> float:
    """상대강도 점수. 기준선(보통 RS 70)에서 35%, RS 90 에서 만점, RS 0 에서 0.
       2026-08-27 전에는 기준선 아래가 **전부 0점** 이었습니다."""
    v = _ramp(r.get('RS'), RS_ZERO, rs_min, US_RS_FULL, BASE_FRAC)
    return weight * (0.30 if v is None else v)


def _ud_pts(r, weight: float) -> float:
    """자금흐름(U/D 비율) 점수. 1.00 에서 35%, 1.20 에서 만점, 0.60 에서 0.

    2026-08-27 전에는 1.00 미만이면 **배점의 20% 를 빼앗았습니다**.
    0.99 와 0.30 이 같은 대접을 받았고, 0.99 와 1.00 사이에 큰 절벽이 있었습니다.
    이제 마이너스를 만들지 않고 낮은 점수로 내려갑니다.
    """
    ud = r.get('UD비율')
    if ud is None or pd.isna(ud):
        return weight * 0.4                      # 자료 없음 — 중립
    v = _ramp(float(ud), UD_ZERO, 1.0, US_UD_FULL, BASE_FRAC)
    return weight * (0.4 if v is None else v)


#  화면(app.html)이 항목별 막대를 그릴 때 쓰는 **차례**입니다.
#  이 차례대로 '점수내역' 에 숫자만 담아 보냅니다 — 화면이 계산을 다시 하지
#  않게 하려는 것입니다. 전에는 화면이 같은 규칙을 한 벌 더 갖고 있었고,
#  한쪽만 고쳐지면 '항목 합계와 서버 점수가 어긋납니다' 경고가 떴습니다.
PARTS_KR = ['EPS', '매출', '수급', '고점', '지속', '변동', '범위', '고가', '마름']   # 2026-10-10 (예전 8칸: 통과·EPS·매출·수급·고점·VCP·수축·지속)
#  ⚠️ 이 차례가 화면(app.html)의 SCW_US 차례와 글자 하나까지 같아야 합니다 —
#     '점수내역' 을 자리(index)로 갖다 붙이기 때문입니다.
PARTS_US = ['EPS', '매출', '고점', 'VCP', '지속', '변동', '범위', '고가', '마름']   # 2026-10-10 (예전 7칸: 통과·EPS·매출·고점·VCP·수축·지속)


def add_score_us(df: pd.DataFrame, s) -> pd.DataFrame:
    """미국 결과에 종합점수와 등급을 붙입니다."""
    if not len(df):
        return df
    rs_min = float(getattr(s, 'rs_min', 70))
    pts, pens, whys, parts = [], [], [], []
    for _, r in df.iterrows():
        part = {}
        # 2026-08-31 개편 — RS·자금(U/D)은 순위에서 뺐습니다 (위 배점표 설명 참고)
        # ⑧ 실적 — SEC 에서 받은 EPS·매출. 적자 회사는 방향으로 채점합니다.
        st = str(r.get('EPS상태') or '')
        part['EPS'] = _growth_pts_us(r.get('EPS증가율'), st,
                                     float(getattr(s, 'eps_growth_min', 0.20)), US_W_EPS)
        # 매출 — 2026-08-20 고침: '적자' 상태는 EPS(순이익) 이야기입니다.
        #  매출 자료가 아예 없는 임상단계 회사(팔 것이 없음)에 적자축소라고
        #  매출 점수의 절반을 주고 있었습니다. 그래서 바이오텍이 여전히 후했습니다.
        #  매출의 흔적이 하나도 없으면 0점 — 없는 매출은 채점하지 않습니다.
        #  (자료를 '못 가져온' 회사는 매출 원값이 있으니 중립 40% 그대로 받습니다)
        no_rev = all(r.get(k) is None or pd.isna(r.get(k))
                     for k in ('매출증가율', '매출당분기', '매출전년'))
        if no_rev and st in LOSS_SCORE:
            part['매출'] = 0.0                     # 없는 매출은 채점하지 않습니다
        else:
            part['매출'] = _growth_pts_us(r.get('매출증가율'), st,
                                        float(getattr(s, 'sales_growth_min', 0.15)), US_W_SALES)
        part['고점'] = _hi_pts(r, US_W_HI)          # 신고가에 가까울수록 좋습니다
        part['VCP'] = _vcp_pts(r, US_W_VCP)
        part['지속'] = _stay_pts(r, US_W_STAY)
        # 2026-10-10 신설 — 눈금은 미국 8조건 통과 종목의 실제 분포 (한국보다 변동이 작습니다)
        part['변동'] = _lin_pts(r.get('일중변동5'), 0.02, 0.07, US_W_ADR)     # 2% 이하 만점 · 7% 이상 0
        part['범위'] = _lin_pts(r.get('범위10'), 0.06, 0.30, US_W_RNG)        # 6% 이하 만점 · 30% 이상 0
        part['고가'] = _lin_pts(r.get('고가20근접'), -0.01, -0.12, US_W_NEAR)  # −1% 안 만점 · −12% 밖 0
        part['마름'] = _lin_pts(r.get('거래량5_50'), 0.65, 1.5, US_W_DRY)     # 0.65배 이하 만점 · 1.5배 이상 0
        #  ※ 피벗 자리·거래량은 점수에 넣지 않습니다 — 표의 칸으로 따로 봅니다.
        # ⑨ 하락의 질 — 한국과 같은 잣대입니다
        pen, why = _drop_penalty(r)   # 2026-10-10: 확장 감점을 미국에도 겁니다 (미국 IC +0.039, t 2.8)
        p = sum(part.values()) - pen
        pens.append(round(pen, 1)); whys.append(why)
        parts.append([round(part[k], 2) for k in PARTS_US])
        pts.append(round(max(0.0, min(100.0, p)), 1))

    df['감점'] = pens
    df['감점사유'] = whys
    df['종합점수'] = pts
    #  항목별 점수를 숫자만 담아 보냅니다 (차례는 PARTS_KR / PARTS_US).
    #  화면이 같은 규칙을 한 벌 더 갖고 있다가 어긋나는 일을 없앱니다.
    df['점수내역'] = parts
    #  ⚠️ 미국 **배점**은 아직 개편하지 않았습니다 (2026-08-31).
    #  한국 백테스트 결과를 그대로 옮기면 안 됩니다 — 미국은 수급 자료가 없어
    #  U/D 가 큰손을 보는 유일한 창이고, 시장 구조도 다릅니다.
    #  us_ohlcv 를 6년치로 늘린 뒤 `--market US` 로 따로 검증할 예정입니다.
    #
    #  등급 경계 — **한국과 같습니다** (A 80↑ · B 70↑ · C 60↑ · D 60미만).
    #
    #  오전에 85/75/65 로 올렸다가 되돌린 것입니다. 그때는 RS 27점이 최대인
    #  옛 배점이라 미국 점수가 전반적으로 높게 나왔고, 그래서 경계를 올리는 것이
    #  맞았습니다. 이제 그 27점이 사라졌으니 같은 종목이 20점 넘게 낮은 점수를
    #  받습니다 — 85 를 그대로 두면 A 가 거의 안 나옵니다.
    #  배점이 한국과 같은 뼈대가 된 이상, 경계도 같아야 두 시장을 한 잣대로
    #  볼 수 있습니다. '미국 75점' 과 '한국 75점' 이 같은 뜻이어야 합니다.
    df['등급'] = pd.cut(df['종합점수'], bins=[-1, 60, 70, 80, 101],
                      labels=['D', 'C', 'B', 'A']).astype(str)
    return df


def add_score(df: pd.DataFrame, s) -> pd.DataFrame:
    """종합점수와 등급을 붙입니다. 수급·실적까지 채운 뒤에 부르세요."""
    if not len(df):
        return df
    rs_min = float(getattr(s, 'rs_min', 70))
    eps_t = float(getattr(s, 'eps_growth_min', 0.20))
    sal_t = float(getattr(s, 'sales_growth_min', 0.15))

    pts, pens, whys, parts = [], [], [], []
    for _, r in df.iterrows():
        part = {}
        # 2026-08-30 개편 — RS·자금(U/D)은 순위에서 뺐습니다 (위 설명 참고)
        # 2026-10-10 개편 — 통과개수·VCP·수축횟수를 빼고 변동성 축소·자리를 넣었습니다
        part['EPS'] = _growth_pts(r.get('EPS증가율'), r.get('EPS전년'), eps_t, W_EPS, 100)
        part['매출'] = _growth_pts(r.get('매출증가율'), r.get('매출전년'), sal_t, W_SALES, 100)
        part['수급'] = W_SUPPLY * SUPPLY_SCORE.get(str(r.get('수급판정') or ''), 0.5)
        part['고점'] = _hi_pts(r, W_HI)
        part['지속'] = _stay_pts(r, W_STAY)
        part['변동'] = _lin_pts(r.get('일중변동5'), 0.03, 0.10, W_ADR)    # 3% 이하 만점 · 10% 이상 0
        part['범위'] = _lin_pts(r.get('범위10'), 0.10, 0.45, W_RNG)       # 10% 이하 만점 · 45% 이상 0
        part['고가'] = _lin_pts(r.get('고가20근접'), -0.02, -0.18, W_NEAR)  # −2% 안 만점 · −18% 밖 0
        part['마름'] = _lin_pts(r.get('거래량5_50'), 0.5, 1.5, W_DRY)      # 0.5배 이하 만점 · 1.5배 이상 0
        #  ※ 피벗 자리·거래량은 점수에 넣지 않습니다 — 표의 칸으로 따로 봅니다.
        # ⑨ 하락의 질 — 대량 거래를 동반한 하락은 깎습니다
        pen, why = _drop_penalty(r)
        p = sum(part.values()) - pen
        pens.append(round(pen, 1)); whys.append(why)
        parts.append([round(part[k], 2) for k in PARTS_KR])
        pts.append(round(max(0.0, min(100.0, p)), 1))

    df['감점'] = pens
    df['감점사유'] = whys
    df['종합점수'] = pts
    #  항목별 점수를 숫자만 담아 보냅니다 (차례는 PARTS_KR / PARTS_US).
    #  화면이 같은 규칙을 한 벌 더 갖고 있다가 어긋나는 일을 없앱니다.
    df['점수내역'] = parts
    #  2026-08-30 배점 개편에 맞춰 경계를 다시 잡았습니다 (Jun 결정, 10단위).
    #
    #    A 80↑ · B 70↑ · C 60↑ · D 60미만
    #
    #  왜 낮췄나 — 점수가 전체적으로 내려갔기 때문입니다.
    #  RS(26점)는 70만 넘으면 35%부터 시작해 90에서 만점이라 후했는데,
    #  그 자리를 받은 고점대비(30점)는 신고가여야 만점이라 박합니다.
    #  실측: 통과 214종목의 평균이 54.2점, 90%가 75.6점입니다.
    #  옛 경계(55/70/84)를 그대로 두면 **A 가 214개 중 1개**가 됩니다.
    #
    #  점수가 낮아진 것은 고장이 아닙니다 — 후하게 주던 항목에 예측력이
    #  없었으니, 그 점수를 걷어낸 것이 이번 개편의 요지입니다.
    #
    #  ⚠️ 배점을 다시 손대면 이 경계도 반드시 함께 확인하세요.
    #     확인 방법: output/result.csv 의 종합점수 백분위를 봅니다.
    df['등급'] = pd.cut(df['종합점수'], bins=[-1, 60, 70, 80, 101],
                      labels=['D', 'C', 'B', 'A']).astype(str)
    return df
