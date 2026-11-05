#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
버핏지수를 서울 서버가 받아서 사이트로 밀어 넣습니다.

왜 이렇게 하나
  사이트는 미국 서버(Vercel)에서 도는데, 거기서 FRED 를 부르면 응답이 오지 않습니다
  (2026-08-18: 25초를 기다려도 'This operation was aborted'). 뉴스1·한국경제와
  같은 상황입니다 — 차단이지 고장이 아닙니다. 서울에서는 잘 열립니다.

계산
  분자  NCBEILQ027S  비금융기업 주식 시가총액 (백만 달러, 분기)
  분모  GDP          명목 GDP (십억 달러, 연율, 분기)
  보정  SP500        분기 말 이후 등락률을 곱해 오늘 값에 가깝게 (근사)

  ※ 예전에는 윌셔5000 을 썼지만 FRED 가 2024-06-03 자로 삭제했습니다.

하루 한 번이면 충분합니다 (분모·분자 모두 분기 자료).
"""
from __future__ import annotations
import datetime as dt
import json
import os
import sys
import urllib.request

UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'}

# 주소가 두 가지입니다.
#  · /data/ID.txt      미리 만들어 둔 파일 — 빠릅니다. 이걸 먼저 씁니다.
#  · fredgraph.csv     부를 때마다 그래프를 새로 만들어 줍니다 — 느려서 자주 끊깁니다
#                      (2026-08-18: 서울·미국 양쪽에서 read timeout).
FRED_TXT = 'https://fred.stlouisfed.org/data/{}.txt'
FRED_CSV = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id={}&cosd={}'
# 공식 API — 호스트가 다릅니다(api.stlouisfed.org). 위 두 주소가 막힌 곳에서도 열립니다.
#  .env 에 FRED_API_KEY 를 넣으면 이걸 가장 먼저 씁니다. 키는 무료입니다:
#    https://fredaccount.stlouisfed.org/apikeys
FRED_API = ('https://api.stlouisfed.org/fred/series/observations'
            '?series_id={}&observation_start={}&file_type=json&api_key={}')
TRIES = 2


def log(m):
    print(f'[{dt.datetime.now():%H:%M:%S}] {m}', flush=True)


def _tag(url: str) -> str:
    """오류 메시지에 API 키가 섞여 나가지 않도록 주소를 짧게 줄입니다."""
    if 'api.stlouisfed' in url:
        return 'api'
    if url.endswith('.txt'):
        return 'txt'
    return 'csv'


def _get(url: str, timeout: int) -> str:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode('utf-8', 'replace')


def _parse_txt(text: str) -> list[tuple[str, float]]:
    """'2026-01-01    69511628' 처럼 공백으로 늘어선 표를 읽습니다."""
    out = []
    for line in text.splitlines():
        p = line.split()
        if len(p) != 2 or len(p[0]) != 10 or p[0][4] != '-':
            continue
        try:
            out.append((p[0], float(p[1])))
        except ValueError:
            continue          # '.' = 휴장·미발표
    return out


def _parse_csv(text: str) -> list[tuple[str, float]]:
    out = []
    for line in text.splitlines()[1:]:
        p = line.split(',')
        if len(p) < 2:
            continue
        try:
            out.append((p[0].strip(), float(p[1])))
        except ValueError:
            continue
    return out


def _parse_api(text: str) -> list[tuple[str, float]]:
    j = json.loads(text)
    out = []
    for o in j.get('observations') or []:
        try:
            out.append((o['date'], float(o['value'])))
        except (KeyError, ValueError, TypeError):
            continue          # '.' = 휴장·미발표
    return out


def series(sid: str, cosd: str) -> list[tuple[str, float]]:
    """되는 주소를 차례로 시도합니다. 각각 두 번씩."""
    errs = []
    ways = []
    api_key = os.environ.get('FRED_API_KEY', '').strip()
    if api_key:
        ways.append((FRED_API.format(sid, cosd, api_key), _parse_api, 30))
    ways += [
        (FRED_TXT.format(sid), _parse_txt, 20),
        (FRED_CSV.format(sid, cosd), _parse_csv, 25),
    ]
    for url, parse, timeout in ways:
        for i in range(TRIES):
            try:
                rows = parse(_get(url, timeout))
                if rows:
                    return rows
                errs.append(f'{_tag(url)}: 빈 응답')
                break
            except Exception as e:
                errs.append(f'{_tag(url)}#{i + 1}: {e}')
    raise RuntimeError(f'{sid} — ' + ' / '.join(errs[-3:]))


def quarter_end(day: str) -> str:
    y, m, _ = (int(x) for x in day.split('-'))
    m += 3
    if m > 12:
        y, m = y + 1, m - 12
    return (dt.date(y, m, 1) - dt.timedelta(days=1)).isoformat()


def value_at(rows, day: str):
    hit = None
    for d, v in rows:
        if d <= day:
            hit = (d, v)
        else:
            break
    return hit


def main() -> int:
    site = os.environ.get('SITE_URL', '').rstrip('/')
    key = os.environ.get('SCREENER_KEY', '')
    if not site or not key:
        log('[오류] SITE_URL / SCREENER_KEY 가 없습니다')
        return 1

    q = (dt.date.today() - dt.timedelta(days=730)).isoformat()
    d = (dt.date.today() - dt.timedelta(days=400)).isoformat()
    try:
        eq = series('NCBEILQ027S', q)
        gdp = series('GDP', q)
    except Exception as e:
        log(f'[오류] 분기 자료를 받지 못했습니다 — {e}')
        return 1

    eq_d, eq_v = eq[-1]
    _, gdp_v = gdp[-1]
    anchor = (eq_v / 1000) / gdp_v * 100          # 백만→십억 으로 단위를 맞춥니다
    qe = quarter_end(eq_d)
    log(f'분기 앵커 {anchor:.1f}% ({qe} 기준)')

    ratio, approx, note = anchor, False, ''
    try:
        sp = series('SP500', d)
        base = value_at(sp, qe)
        if base and base[1] > 0 and sp[-1][0] > qe:
            ratio = anchor * (sp[-1][1] / base[1])
            approx = True
            log(f'S&P500 보정 {base[1]:.0f} → {sp[-1][1]:.0f} · 최종 {ratio:.1f}%')
    except Exception as e:
        note = 'S&P500 을 받지 못해 분기 값만 씁니다'
        log(f'   · S&P500 실패({e}) — 분기 값만 씁니다')

    body = json.dumps({
        'ratio': round(ratio, 1), 'anchor': round(anchor, 1), 'anchorAt': qe,
        'approx': approx, 'note': note, 'spAt': None,
    }, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(
        f'{site}/api/gauge/buffett', data=body, method='POST',
        headers={'Content-Type': 'application/json; charset=utf-8', 'x-screener-key': key})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            log(f'전송 완료 ({r.status}) — {ratio:.1f}%')
        return 0
    except Exception as e:
        log(f'[오류] 전송 실패 — {e}')
        return 1


if __name__ == '__main__':
    sys.exit(main())
