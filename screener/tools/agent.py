#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
AWS 서버에서 계속 떠 있는 상주 프로그램.

두 가지 일을 합니다.
  1. 정해진 시각(기본: 평일 10·12·14·16시 한국시간)에 스크리닝을 돌립니다.
  2. 30초마다 사이트에 "지금 실행할 일 있나요?" 를 묻고, 있으면 즉시 돌립니다.
     → 사이트의 [지금 다시 스크리닝] 버튼이 이 경로로 동작합니다.

환경변수 (.env 또는 systemd 에서 지정)
  SITE_URL       https://내사이트.com
  SCREENER_KEY   사이트와 똑같은 비밀 키
  RUN_HOURS      10,12,14,16   (한국시간, 쉼표 구분)
  RUN_DAYS       0,1,2,3,4     (0=월 … 6=일)
"""
from __future__ import annotations
import os
import sys
import time
import json
import gzip
import subprocess
import datetime as dt
import urllib.request
import urllib.error
import threading

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)

SITE = os.environ.get('SITE_URL', '').rstrip('/')
KEY = os.environ.get('SCREENER_KEY', '')
HOURS = [int(h) for h in os.environ.get('RUN_HOURS', '16').split(',') if h.strip()]
DAYS = [int(d) for d in os.environ.get('RUN_DAYS', '0,1,2,3,4').split(',') if d.strip()]
POLL = int(os.environ.get('POLL_SECONDS', '30'))
KST = dt.timezone(dt.timedelta(hours=9))


def log(msg):
    print(f'[{dt.datetime.now(KST):%Y-%m-%d %H:%M:%S}] {msg}', flush=True)


def api(path, method='GET', data=None, timeout=30):
    req = urllib.request.Request(f'{SITE}{path}', data=data, method=method,
                                 headers={'x-screener-key': KEY})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode() or '{}')


def heartbeat():
    try:
        api('/api/screener/job', method='POST', data=b'')
    except Exception:
        pass

def heartbeat_loop():
    while True:
        heartbeat()
        time.sleep(60)


def claim_job():
    """사이트에 대기 중인 수동 요청이 있으면 가져옵니다.

    2026-08-19: 미국 스크리너도 [지금 다시 스크리너] 로 돌릴 수 있게 되면서
    '어느 시장인지' 가 함께 옵니다. 예전 사이트는 이 값을 안 보내므로 KR 로 봅니다.
    """
    try:
        r = api('/api/screener/job')
        job = r.get('job')
        if not job:
            return None
        return (job, 'US' if r.get('market') == 'US' else 'KR')
    except Exception as e:
        log(f'· 사이트 확인 실패({e})')
        return None


def pull_watchlist():
    try:
        subprocess.run([sys.executable, os.path.join(BASE, 'tools', 'pull_watchlist.py')],
                       check=False, timeout=120)
    except Exception as e:
        log(f'· 워치리스트 가져오기 건너뜀({e})')


def run_us(reason: str) -> bool:
    """미국 스크리너를 손으로 돌립니다.

    미국은 run_us.py 가 스스로 사이트로 보내므로 push_result.py 를 부르지 않습니다.
    us_night.sh 를 쓰면 로그가 한 곳에 모이고 rc·오류줄 집계도 그대로 따라옵니다.
    """
    log(f'▶ 미국 스크리너 시작 ({reason})')
    t0 = time.time()
    r = subprocess.run([sys.executable,os.path.join(os.path.dirname(BASE),'desktop','run-task.py'),'us-cached'], cwd=BASE, capture_output=True, text=True,
                       timeout=60 * 60)
    if r.returncode != 0:
        log(f'✗ 미국 스크리너 실패 (코드 {r.returncode})')
        log((r.stderr or r.stdout or '')[-1200:])
        return False
    log(f'◀ 미국 끝 ({time.time() - t0:.0f}초)')
    return True


def run_screening(reason: str) -> bool:
    log(f'▶ 스크리닝 시작 ({reason})')
    t0 = time.time()
    pull_watchlist()
    r = subprocess.run([sys.executable, os.path.join(BASE, 'run.py')],
                       cwd=BASE, capture_output=True, text=True, timeout=60 * 90)
    tail = (r.stdout or '')[-1500:]
    if r.returncode != 0:
        log(f'✗ 스크리닝 실패 (코드 {r.returncode})')
        log((r.stderr or '')[-1500:])
        return False
    log(tail.strip().splitlines()[-1] if tail.strip() else '완료')

    p = subprocess.run([sys.executable, os.path.join(BASE, 'tools', 'push_result.py')],
                       cwd=BASE, capture_output=True, text=True, timeout=300,
                       env={**os.environ, 'RUN_SOURCE': reason})
    log((p.stdout or p.stderr or '').strip()[-400:])
    log(f'◀ 끝 ({time.time() - t0:.0f}초)')
    return p.returncode == 0


def main():
    if not SITE or not KEY:
        sys.exit('[오류] SITE_URL / SCREENER_KEY 환경변수가 필요합니다.')

    log(f'상주 시작 — 자동 실행 {HOURS}시(KST), 요일 {DAYS}, 수동 요청 {POLL}초마다 확인')
    log(f'사이트: {SITE}')
    last_auto = None
    last_beat = 0.0
    threading.Thread(target=heartbeat_loop, daemon=True).start()

    # 처음 켰을 때 결과가 없으면 한 번 돌려 둡니다
    if not os.path.exists(os.path.join(BASE, 'output', 'payload.json')):
        run_screening('first')

    while True:
        try:
            now = dt.datetime.now(KST)

            if time.time() - last_beat > 60:
                heartbeat()
                last_beat = time.time()

            # ① 예정된 시각
            slot = (now.date(), now.hour)
            if (now.weekday() in DAYS and now.hour in HOURS
                    and now.minute < 5 and slot != last_auto):
                last_auto = slot
                run_screening('schedule')
                continue

            # ② 사이트에서 온 수동 요청
            got = claim_job()
            if got:
                _, mkt = got
                # 2026-08-23: 수동 실행은 **한국·미국을 둘 다** 돌립니다.
                #  전에는 누른 화면의 시장만 돌아서, 다른 쪽 결과가 낡은 채로 남았습니다.
                #  누른 쪽을 먼저 돌려 화면에 빨리 반영되게 하고, 이어서 나머지를 돕니다.
                #  (한쪽이 실패해도 나머지는 그대로 돕니다 — 각각 로그가 남습니다)
                if mkt == 'US':
                    run_us('manual')
                    run_screening('manual')
                else:
                    run_screening('manual')
                    run_us('manual')
                continue

        except Exception as e:
            log(f'· 루프 오류({e})')
        time.sleep(POLL)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        log('종료합니다.')
