#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
재무제표를 모아 사이트로 보내기 (AWS 서울 서버에서 실행).

무엇을 하나
  ① 대상 종목을 고릅니다 — 워치리스트 + 스크리너 7조건 이상 통과
  ② 각 회사의 최근 12분기 재무제표를 DART 에서 받습니다
  ③ 분기 지표를 계산해 사이트로 보냅니다 (/api/fin/push)

왜 전 종목이 아닌가
  3,900개를 다 받으면 회사당 12번 × 3,900 = 46,800번입니다.
  DART 하루 한도(20,000)를 넘고, 쓰지도 않을 자료입니다.
  리포트를 쓸 종목은 어차피 워치리스트와 스크리너 통과 종목입니다.
  보통 100~250개 → 회사당 12번이면 1,200~3,000번, 한도 안입니다.

  한 번 받은 회사는 저장해 두고, 새 분기 보고서가 나올 때까지 다시 받지 않습니다.

언제 도나
  하루 한 번이면 충분합니다. 분기 실적은 하루에 몇 번씩 바뀌지 않습니다.

환경변수
  SITE_URL · SCREENER_KEY · DART_KEY
"""
from __future__ import annotations
import os
import re
import sys
import csv
import json
import time
import datetime as dt
import urllib.request
import urllib.error

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)

from screener import dartfin                                   # noqa: E402

SITE = os.environ.get('SITE_URL', '').rstrip('/')
KEY = os.environ.get('SCREENER_KEY', '')

OUT = os.path.join(BASE, 'output')
DATA = os.path.join(BASE, 'data')
STORE = os.path.join(DATA, 'fin_store.json')     # 받아 둔 재무 (다시 안 받으려고)
CORPMAP = os.path.join(DATA, 'corpmap.json')     # 종목코드 → DART 고유번호

MAX_CODES = int(os.environ.get('FIN_MAX', '250'))
QUARTERS = 12
FRESH_DAYS = 45          # 이만큼 지나면 새 분기가 나왔을 수 있으니 다시 봅니다


def log(m):
    print(f'[{dt.datetime.now():%H:%M:%S}] {m}', flush=True)


# ─────────────────────── 대상 고르기 ───────────────────────
def read_codes() -> list[str]:
    codes, why = [], {}

    wl = os.path.join(OUT, 'watchlist.csv')
    if os.path.exists(wl):
        try:
            with open(wl, encoding='utf-8-sig') as f:
                for r in csv.DictReader(f):
                    c = re.sub(r'\D', '', str(r.get('코드') or ''))
                    if len(c) == 6 and c not in why:
                        codes.append(c); why[c] = '워치리스트'
        except Exception as e:
            log(f'워치리스트를 읽지 못했습니다({e})')

    rs = os.path.join(OUT, 'result.csv')
    if os.path.exists(rs):
        try:
            with open(rs, encoding='utf-8-sig') as f:
                for r in csv.DictReader(f):
                    try:
                        n = int(float(r.get('통과개수') or 0))
                    except ValueError:
                        n = 0
                    if n < 7:
                        continue
                    c = re.sub(r'\D', '', str(r.get('코드') or ''))
                    if len(c) == 6 and c not in why:
                        codes.append(c); why[c] = f'{n}조건'
        except Exception as e:
            log(f'스크리너 결과를 읽지 못했습니다({e})')

    log(f'대상 {len(codes)}종목 '
        f'(워치리스트 {sum(1 for v in why.values() if v == "워치리스트")} · '
        f'스크리너 {sum(1 for v in why.values() if v != "워치리스트")})')
    return codes[:MAX_CODES]


# ─────────────────────── 회사 대응표 ───────────────────────
def corp_map() -> dict:
    if os.path.exists(CORPMAP) and \
            time.time() - os.path.getmtime(CORPMAP) < 7 * 86400:
        try:
            with open(CORPMAP, encoding='utf-8') as f:
                m = json.load(f)
            if len(m) > 1000:
                return m
        except Exception:
            pass
    log('회사 대응표를 새로 받습니다')
    from tools.push_corpmap import fetch_map          # noqa: E402
    m = fetch_map()
    os.makedirs(DATA, exist_ok=True)
    with open(CORPMAP, 'w', encoding='utf-8') as f:
        json.dump(m, f)
    return m


# ─────────────────────── 저장해 둔 것 ───────────────────────
def load_store() -> dict:
    if os.path.exists(STORE):
        try:
            with open(STORE, encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def save_store(s: dict):
    os.makedirs(DATA, exist_ok=True)
    tmp = STORE + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(s, f, ensure_ascii=False)
    os.replace(tmp, STORE)


def main() -> int:
    if not SITE or not KEY:
        sys.exit('[오류] SITE_URL / SCREENER_KEY 환경변수가 필요합니다.')
    dartfin.key()          # DART_KEY 확인 (없으면 여기서 멈춥니다)

    codes = read_codes()
    if not codes:
        log('대상이 없습니다. 스크리너를 한 번 돌린 뒤 다시 실행하세요.')
        return 1

    cmap = corp_map()
    store = load_store()
    today = dt.date.today().isoformat()
    fresh_until = (dt.date.today() - dt.timedelta(days=FRESH_DAYS)).isoformat()

    todo = [c for c in codes
            if c not in store or str(store[c].get('받은날') or '') < fresh_until]
    log(f'새로 받을 회사 {len(todo)}개 (이미 있는 것 {len(codes) - len(todo)}개)')

    t0 = time.time()
    got = 0
    for i, code in enumerate(todo, 1):
        cc = cmap.get(code)
        if not cc:
            store[code] = {'받은날': today, '오류': '전자공시에 등록되지 않은 종목'}
            continue
        try:
            d = dartfin.company(cc, QUARTERS)
        except Exception as e:
            log(f'   {code} 실패 {e}')
            continue
        d['받은날'] = today
        d['코드'] = code
        store[code] = d
        if d.get('분기'):
            got += 1
        if i % 20 == 0 or i == len(todo):
            save_store(store)
            eta = (time.time() - t0) / i * (len(todo) - i) / 60
            log(f'   ... {i}/{len(todo)} (남은 시간 약 {eta:.0f}분) · 재무 확보 {got}개')

    save_store(store)

    # ── 사이트로 보내기 — 이번에 대상이 된 종목만
    send = {c: store[c] for c in codes if c in store}
    body = json.dumps({'fin': send}, ensure_ascii=False).encode('utf-8')
    log(f'전송 {len(send)}종목 / {len(body) / 1024:.0f}KB')
    req = urllib.request.Request(
        f'{SITE}/api/fin/push', data=body, method='POST',
        headers={'Content-Type': 'application/json; charset=utf-8',
                 'x-screener-key': KEY})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            log('전송 완료 — ' + r.read().decode()[:300])
    except urllib.error.HTTPError as e:
        log(f'전송 실패 HTTP {e.code} — {e.read().decode()[:300]}')
        return 1
    except Exception as e:
        log(f'전송 실패 — {e}')
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
