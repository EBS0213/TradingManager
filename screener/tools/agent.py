#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
로컬 설치에서 계속 실행하는 한국·미국 스크리너.

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
from concurrent.futures import ThreadPoolExecutor
from local_schedule import due_slot, load_state, save_state

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

def finish_job(job, market, success):
    if not job:
        return
    body=json.dumps({'job':job,'market':market,'status':'done' if success else 'failed',
                     'error':'' if success else '수집 또는 결과 저장에 실패했습니다. 스크리너 로그를 확인하세요.'}).encode()
    try:
        api('/api/screener/job', method='POST', data=body)
    except Exception as error:
        log(f'작업 완료 보고 실패: {error}')


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
    r = subprocess.run([sys.executable,os.path.join(os.path.dirname(BASE),'desktop','run-task.py'),'us'], cwd=BASE, capture_output=True, text=True,
                       timeout=60 * 180)
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

    log(f'상주 시작 — 한국 {HOURS}시, 미국 22:30~08:30 두 시간 간격 (KST)')
    state_path=os.path.join(os.path.dirname(BASE),'data','screener-schedule.json')
    state=load_state(state_path)
    running={}; retry_at={}; manual={}
    threading.Thread(target=heartbeat_loop, daemon=True).start()
    with ThreadPoolExecutor(max_workers=2) as pool:
        while True:
            try:
                now=dt.datetime.now(KST)
                for market,(future,slot,job) in list(running.items()):
                    if not future.done():continue
                    try:success=future.result()
                    except Exception as error:
                        log(f'{market} 실행 오류: {error}');success=False
                    del running[market]
                    finish_job(job,market,success)
                    if success:
                        state[market]={'slot':slot,'finishedAt':now.isoformat()}
                        save_state(state_path,state)
                    else:retry_at[market]=time.monotonic()+600
                # Manual polling remains responsive during a lengthy collection.
                got=claim_job()
                if got:
                    job,market=got
                    if market in running:
                        future,slot,current_job=running[market]
                        if not current_job:running[market]=(future,slot,job)
                        else:manual[market]=job
                    else:manual[market]=job
                for market in ('KR','US'):
                    if market in running or (market not in manual and time.monotonic()<retry_at.get(market,0)):continue
                    slot=due_slot(market,now,HOURS,DAYS)
                    previous=state.get(market,{})
                    reason='manual' if market in manual else ('first' if not previous else 'schedule')
                    if reason=='schedule' and (not slot or slot<=previous.get('slot','')):continue
                    job=manual.pop(market,None)
                    # The current slot is recorded only after a successful upload.
                    running[market]=(pool.submit(run_us if market=='US' else run_screening,reason),slot or now.isoformat(),job)
            except Exception as error:
                log(f'루프 오류: {error}')
            time.sleep(POLL)


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        log('종료합니다.')
