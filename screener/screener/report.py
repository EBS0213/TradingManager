# -*- coding: utf-8 -*-
"""
결과 출력.
  · output/dashboard.html  — 브라우저에서 보는 대시보드 (검색·정렬 가능)
  · output/summary.txt     — 통과 종목만 짧게 요약
  · output/history.csv     — 실행 때마다 누적 (신규 진입 판별용)
"""
from __future__ import annotations
import os
import json
import html
import datetime as dt
import pandas as pd

from . import config
from .rules import COND_LABELS, COND_DESC, CONDS

KST = dt.timezone(dt.timedelta(hours=9))


def now_kst() -> dt.datetime:
    """서버 시계가 UTC 여도 항상 한국시간으로 찍습니다."""
    return dt.datetime.now(KST)


HISTORY = os.path.join(config.DATA_DIR, 'history.csv')
STREAK = os.path.join(config.DATA_DIR, 'streak.csv')

# 등재·잔류는 매일 '그 시장의 마감 뒤 첫 실행' 결과로만 갱신합니다.
#  한국 오후 4시 / 미국 오전 7시(= 미국 동부 오후 5시, 전날 종가 확정).
#  run_us.py 가 CLOSING_HOUR 와 STREAK 를 미국 것으로 바꿔 끼웁니다.
CLOSING_HOUR = 16


def track_streak(df: pd.DataFrame, now=None) -> pd.DataFrame:
    """
    조건을 며칠째 지키고 있는지 셉니다.

    **등재 기준은 매일 오후 4시(마지막 스크리닝) 결과입니다.**
    장중(10·12·14시) 실행은 4시에 정해진 값을 그대로 보여주기만 하고 셈을 바꾸지 않습니다.
    장중에는 50일선·RS를 오르내리며 판정이 수시로 뒤집히기 때문입니다.

      · 8조건을 처음 채우면           NEW
      · 7조건을 처음 채우면           NEW
      · 8조건이던 종목이 7로 내려가면  DOWN
      · 그 뒤로는 하루 지날 때마다 1일씩 쌓입니다.

    6개 이하로 내려가면 기록을 지웁니다. 다시 올라오면 NEW 부터 새로 셉니다.
    """
    now = now or now_kst()
    today = now.strftime('%Y-%m-%d')

    prev, last_day = {}, ''
    if os.path.exists(STREAK):
        try:
            h = pd.read_csv(STREAK, dtype={'코드': str})
            for r in h.to_dict('records'):
                prev[str(r['코드'])] = (int(r['단계']), int(r['일수']), str(r.get('표시', '')))
            if len(h):
                last_day = str(h.iloc[0].get('갱신일', ''))
        except Exception:
            prev, last_day = {}, ''

    # 오후 4시 이후 첫 실행에서만 갱신합니다
    #  CLOSING_HOUR 는 모듈 변수라 미국 실행에서는 7 로 바뀌어 있습니다.
    #  같은 날 두 번째 실행부터는 last_day == today 라 갱신하지 않습니다
    #  (미국 22:30 실행이 07:00 에 정한 값을 흔들지 않도록).
    is_final = (now.hour >= CLOSING_HOUR) and (last_day != today)

    if is_final:
        level = {}
        for code, n in zip(df['코드'], df['통과개수']):
            if n >= 8:
                level[str(code)] = 8
            elif n == 7:
                level[str(code)] = 7

        state = {}
        for code, lv in level.items():
            p = prev.get(code)
            if p and p[0] == lv:
                state[code] = (lv, p[1] + 1, '유지')
            elif p and p[0] == 8 and lv == 7:
                state[code] = (lv, 0, 'DOWN')
            else:
                state[code] = (lv, 0, 'NEW')

        pd.DataFrame([{'코드': c, '단계': v[0], '일수': v[1], '표시': v[2], '갱신일': today}
                      for c, v in state.items()]) \
            .to_csv(STREAK, index=False, encoding='utf-8-sig')
        print(f'[잔류] 마감 기준으로 갱신했습니다 — {len(state):,}종목')
    else:
        state = prev
        if last_day:
            print(f'[잔류] {last_day} 마감 기준 값을 그대로 씁니다 (갱신은 오후 4시 이후).')

    df['잔류일'] = df['코드'].map(lambda c: state.get(str(c), (0, None, ''))[1])
    df['편입상태'] = df['코드'].map(lambda c: state.get(str(c), (0, None, ''))[2])
    df['등재기준일'] = today if is_final else (last_day or '')
    return df


# SEPA 워크북과 같은 색 계열
NAVY, HDR = '#1F3864', '#2F5597'
OK, WARN, BAD, MUTED = '#548235', '#BF8F00', '#C00000', '#7F7F7F'


def _pct(x, digits=1):
    if x is None or pd.isna(x):
        return '-'
    return f'{x * 100:.{digits}f}%'


def _num(x):
    if x is None or pd.isna(x):
        return '-'
    return f'{x:,.0f}'


NUMERAL = {'c1': '①', 'c2': '②', 'c3': '③', 'c4': '④',
           'c5': '⑤', 'c6': '⑥', 'c7': '⑦', 'c8': '⑧'}


def _spark(raw, w=74, h=24):
    """CSV에 담긴 주가 이력을 작은 선형차트(SVG)로."""
    if not isinstance(raw, str) or not raw:
        return '<span style="color:#BBB">-</span>'
    try:
        d = [float(x) for x in raw.split('|') if x]
    except ValueError:
        return '<span style="color:#BBB">-</span>'
    if len(d) < 3:
        return '<span style="color:#BBB">-</span>'
    mn, mx = min(d), max(d)
    rg = (mx - mn) or 1
    pts = ' '.join(f'{i / (len(d) - 1) * (w - 2) + 1:.1f},'
                   f'{h - 2 - (v - mn) / rg * (h - 4):.1f}' for i, v in enumerate(d))
    col = OK if d[-1] >= d[0] else BAD
    return (f'<svg width="{w}" height="{h}" viewBox="0 0 {w} {h}" style="display:block">'
            f'<polyline points="{pts}" fill="none" stroke="{col}" stroke-width="1.5" '
            f'stroke-linejoin="round" stroke-linecap="round"/></svg>')


def _prod(r) -> str:
    v = r.get('주요제품')
    if v is None or (isinstance(v, float) and pd.isna(v)) or not str(v).strip():
        return ''
    return f' title="주요제품: {html.escape(str(v))}"'


def _cond_boxes(r) -> str:
    return ''.join(
        f'<i class="{"o" if r[c] else "x"}" data-c="{c}" data-ok="{1 if r[c] else 0}">'
        f'{NUMERAL[c]}</i>' for c in CONDS)


def mark_new(df: pd.DataFrame) -> pd.DataFrame:
    """
    지난 실행과 비교해서 표시를 답니다.

      · 신규 — 지난번엔 8조건을 다 못 채웠는데 이번에 채운 종목
      · 이탈 — 지난번엔 8조건을 다 채웠는데 이번에 하나라도 깨진 종목

    기준이 되는 '지난번'은 history.csv 에 기록된 **직전 실행 한 번**입니다.
    같은 날 여러 번 돌리면 그 직전 실행이 기준이 됩니다.
    """
    passed = set(df.loc[df['판정'] == '통과', '코드'])
    prev = set()
    if os.path.exists(HISTORY):
        try:
            h = pd.read_csv(HISTORY, dtype={'코드': str})
            if len(h):
                last_run = h['실행시각'].max()
                prev = set(h.loc[h['실행시각'] == last_run, '코드'])
        except Exception:
            prev = set()
    first_run = not prev                      # 첫 실행이면 비교 대상이 없습니다
    df['신규'] = (~first_run) & df['코드'].isin(passed - prev) & (df['판정'] == '통과')
    df['이탈'] = df['코드'].isin(prev - passed)
    # 이탈 종목은 "어느 조건이 깨졌나" 를 바로 보여줍니다
    if df['이탈'].any():
        df.loc[df['이탈'], '이탈사유'] = df.loc[df['이탈'], CONDS].apply(
            lambda r: ' · '.join(COND_LABELS[c] for c in CONDS if not r[c]), axis=1)
    if '이탈사유' not in df.columns:
        df['이탈사유'] = ''
    df['이탈사유'] = df['이탈사유'].fillna('')

    now = now_kst().strftime('%Y-%m-%d %H:%M')
    rec = pd.DataFrame({'실행시각': now, '코드': sorted(passed)})
    rec.to_csv(HISTORY, mode='a', header=not os.path.exists(HISTORY),
               index=False, encoding='utf-8-sig')
    return df


def write_summary(df: pd.DataFrame, stats: dict) -> str:
    # 부적합(저가주·거래대금 부족·상장 1년 미만)은 요약글에서도 뺍니다.
    #  화면 목록에서는 이미 빼고 있는데 터미널 출력만 안 걸러져서,
    #  거래대금 $0.4M 짜리가 RS 99 로 맨 위에 올라오고 있었습니다.
    fit = df[df['부적합사유'].fillna('') == ''] if '부적합사유' in df.columns else df
    p = fit[fit['판정'] == '통과'].sort_values('RS', ascending=False)
    new = p[p['신규']]
    now = now_kst().strftime('%Y-%m-%d %H:%M')

    lines = [f'■ 미너비니 스크리닝 {now}',
             f'  전체 {stats["전체"]:,}종목 중 8조건 통과 {len(p)}종목 '
             f'(시장 온도 {stats["시장온도"]}%)', '']
    if len(new):
        lines.append(f'▶ 새로 통과한 종목 {len(new)}개')
        for _, r in new.iterrows():
            lines.append(
                f'   · {r["종목명"]} ({r["코드"]}) RS {int(r["RS"])} | {r["업종"]}\n'
                f'       피벗 {_num(r["피벗가격"])}원 (현재 {_pct(r["피벗대비이격"])}) '
                f'· 손절 제안 {_num(r.get("손절가제안"))}원 ({_pct(r.get("예상손절폭"))})\n'
                f'       매집 {r.get("매집판정","-")} · 수급 {r.get("수급판정","-")} '
                f'· 실적 {r["실적판정"]}')
    else:
        lines.append('▶ 새로 통과한 종목 없음')
    lines.append('')
    if len(p):
        lines.append(f'▶ 통과 종목 RS 상위 (전체 {len(p)}개)')
        for _, r in p.head(15).iterrows():
            tag = ' NEW' if r['신규'] else ''
            lines.append(f'   {int(r["RS"]):>3}  {r["종목명"]:<12} {r["업종"][:14]:<14}'
                         f' 피벗대비 {_pct(r["피벗대비이격"]):>7}  {r["수축_추세"]}{tag}')
    try:
        from .watchlist import report_lines
        lines += report_lines(df)
    except Exception:
        pass
    txt = '\n'.join(lines)
    with open(os.path.join(config.OUT_DIR, 'summary.txt'), 'w', encoding='utf-8') as f:
        f.write(txt)
    return txt


CSV_COLS = ['코드', '종목명', '시장', '업종', '대분류', '주요제품', '업종출처', 'RS', '현재가', '등락률',
            '시가총액',
            '저점대비', '고점대비', '52주최고', '52주최저', '직전52주최고', '직전고점대비',
            '피벗가격', '이전피벗', '피벗나이', '이전피벗나이', '피벗대비이격', '피벗상태', '돌파후일수', '돌파가대비', '돌파거래량', '매수자리', '상태일수', '상태일수이상',
            '손절가제안', '예상손절폭',
            '수축_추세', '수축비', '수축개수', '최근거래량_비율', 'UD비율', '매집판정', '거래대금', '거래대금20일', '거래량추이', '거래량평균20',
            '외국인20일', '기관20일', '수급판정',
            'EPS증가율', '매출증가율', 'EPS당분기', 'EPS전년', '매출당분기', '매출전년', '실적판정',
            'EPS출처', 'EPS상태',
            # 최근 4분기 — 막대(|)로 이어 붙인 한 칸씩입니다 (2026-09-14).
            #  칸을 스무 개 늘리는 대신 이렇게 담습니다. 화면이 갈라 씁니다.
            '실적분기목록', '매출분기목록', 'EPS분기목록', '매출성장목록', 'EPS성장목록',
            '종합점수', '등급', '감점', '감점사유', '점수내역', '당일거래량비', '부적합사유',
            *CONDS, '통과개수', '판정', '편입상태', '잔류일', '등재기준일', '신규', '이탈', '이탈사유', '관심', '관심메모', '주가추이']


# 표에 실제로 그려지는 종목(6개 이상 통과·관심)만 모든 정보를 담고,
# 나머지는 통계용 최소 정보만 담습니다. 이렇게 하면 전송량이 1/4 로 줄어듭니다.
SLIM_COLS = ['코드', '종목명', '시장', '업종', 'RS', '현재가', '등락률', '시가총액',
             '52주최고', '직전52주최고', '통과개수', '판정',
             '편입상태', '잔류일', *CONDS]


def _excluded_rows() -> list:
    """스크리닝에서 빠진 종목 — 코드·이름·사유만 담습니다.

    검색창에서 "왜 이 종목은 안 나오지?" 에 답하기 위한 것입니다.
    통과개수·RS 같은 값은 없습니다 (계산하지 않았으니까요).
    """
    from . import rules
    ex = getattr(rules, 'LAST_EXCLUDED', None)
    if ex is None or not len(ex):
        return []
    out = []
    for r in ex.to_dict('records'):
        code = str(r.get('코드') or '')
        if not code:
            continue
        out.append({'코드': code, '종목명': str(r.get('종목명') or ''),
                    '시장': str(r.get('시장') or ''),
                    '제외사유': str(r.get('제외사유') or '')})
    return out


def _rows_for_web(df: pd.DataFrame, s=None) -> list:
    """대시보드/사이트로 보낼 행 목록.

    예전에는 6개 미만 통과 종목을 최소 정보만 담아 보냈습니다(전송량 절약).
    그런데 그러면 검색으로 그런 종목을 봤을 때 차트도, 피벗·손절도 안 보였습니다.
    값은 어차피 다 계산해 두었으니 전부 실어 보냅니다.
    (빈 값은 아래에서 건너뛰므로 실제로 늘어나는 것은 주가추이 정도입니다)
    """
    d = df.copy()

    # ── 주가추이는 '표에 그려지는 종목' 만 지고 갑니다 (2026-08-26) ──
    #  주가추이는 60일 종가라 한 줄에 270바이트쯤 됩니다. 5,000종목이면 1.35MB,
    #  자료 전체의 4분의 1입니다. 그런데 이건 **스크리너 표의 작은 추이선**을
    #  그리는 데만 씁니다. 목록에 안 나오는 종목은 그릴 일이 없습니다 —
    #  검색으로 열었을 때 나오는 큰 차트는 /api/ohlcv 에서 따로 받아옵니다.
    #
    #  설정에 spark_only_candidates 가 예전부터 있었는데 CSV 를 만들 때만
    #  쓰이고 사이트로 보낼 때는 안 쓰이고 있었습니다. 여기에도 씁니다.
    #  (전 종목 판정으로 바꾸면서 종목 수가 3,000 → 5,000 으로 늘었고,
    #   그만큼 이 짐도 같이 늘었습니다)
    if '주가추이' in d.columns and getattr(s, 'spark_only_candidates', True):
        keep = d['통과개수'] >= 7
        for col in ('관심', '이탈'):
            if col in d.columns:
                keep = keep | d[col].fillna(False).astype(bool)
        # 부적합 종목은 목록에 안 나오므로 언제나 뺍니다
        if '부적합사유' in d.columns:
            keep = keep & (d['부적합사유'].fillna('') == '')
        d.loc[~keep, '주가추이'] = ''
    d = d[[c for c in CSV_COLS if c in d.columns]]
    out = []
    for rec in d.to_dict('records'):
        row = {}
        for k, v in rec.items():
            if v is None or (isinstance(v, float) and not __import__('math').isfinite(v)):
                continue
            if isinstance(v, (bool,)):
                row[k] = bool(v)
            elif isinstance(v, (int,)):
                row[k] = int(v)
            elif isinstance(v, float):
                row[k] = round(float(v), 6)
            else:
                sv = str(v)
                if sv and sv != 'nan':
                    row[k] = sv
        out.append(row)
    return out


def write_html(df: pd.DataFrame, stats: dict, s) -> str:
    """screener/app.html 템플릿에 결과를 박아 output/dashboard.html 을 만듭니다."""
    from .rules import add_score
    df = add_score(df.copy(), s)
    tpl_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'app.html')
    with open(tpl_path, encoding='utf-8') as f:
        tpl = f.read()

    try:
        from .watchlist import load as _wl_load
        wl = _wl_load().to_dict('records')
    except Exception:
        wl = []

    # 제외 종목은 결과 목록 뒤에 붙여 보냅니다.
    #  화면은 '제외사유' 가 있는 행을 목록·통계에서 빼고, 검색에서만 씁니다.
    payload = {
        'stamp': now_kst().strftime('%Y-%m-%d %H:%M') + ' 스크리닝 결과',
        'result': _rows_for_web(df, s) + _excluded_rows(),
        'watchlist': wl,
    }
    data = json.dumps(payload, ensure_ascii=False, allow_nan=False).replace('</', '<\\/')
    html_out = tpl.replace('__DATA__', data)

    path = os.path.join(config.OUT_DIR, 'dashboard.html')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(html_out)

    # 웹사이트로 보낼 원본 (tools/push_result.py 가 이 파일을 씁니다)
    with open(os.path.join(config.OUT_DIR, 'payload.json'), 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, allow_nan=False)
    return path


def write_csv(df: pd.DataFrame, s=None) -> str:
    from .rules import add_score
    d = add_score(df.copy(), s)
    if '주가추이' in d.columns and getattr(s, 'spark_only_candidates', True):
        keep = (d['통과개수'] >= 7) | d.get('관심', False) | d.get('이탈', False)
        d.loc[~keep, '주가추이'] = ''
    cols = [c for c in CSV_COLS if c in d.columns]
    path = os.path.join(config.OUT_DIR, 'result.csv')
    d[cols].to_csv(path, index=False, encoding='utf-8-sig')
    return path
