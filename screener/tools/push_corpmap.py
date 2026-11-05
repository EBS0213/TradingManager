#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DART 회사 대응표를 만들어 사이트로 보내기 (AWS 서울 서버에서 실행).

무슨 문제를 푸는가
  전자공시는 종목코드(131290)로는 회사를 찾을 수 없습니다.
  DART 가 따로 매기는 '고유번호(8자리)' 로만 조회됩니다.
  그 대응표는 zip 파일 하나로 주는데, 압축을 풀면 20MB 가 넘습니다
  (비상장 포함 11만 개 회사가 들어 있습니다).

  사이트는 미국 서버(Vercel)에서 돌아서 이 파일을 받다가 자주 시간을 넘겼고,
  그래서 워치리스트·검색의 공시 칸이 계속 비어 있었습니다.
  이 서버는 서울에 있고 시간 제한도 없어 몇 초면 끝납니다.

  상장사만 추리면 약 2,800개, 100KB 남짓이라 보내기도 가볍습니다.

얼마나 자주
  회사 고유번호는 거의 바뀌지 않습니다. 새로 상장한 회사만 늘어납니다.
  일주일에 한 번이면 충분합니다.

환경변수
  SITE_URL       http://127.0.0.1:8766
  SCREENER_KEY   사이트와 똑같은 비밀 키
  DART_KEY       전자공시 인증키 (사이트에 넣은 것과 같은 값)
"""
from __future__ import annotations
import io
import os
import re
import sys
import json
import time
import zipfile
import datetime as dt
import urllib.request
import urllib.error

SITE = os.environ.get('SITE_URL', '').rstrip('/')
KEY = os.environ.get('SCREENER_KEY', '')
DART = os.environ.get('DART_KEY', '')

CORP = 'https://opendart.fss.or.kr/api/corpCode.xml'


def log(m):
    print(f'[{dt.datetime.now():%H:%M:%S}] {m}', flush=True)


def fetch_map() -> dict:
    log('대응표를 받습니다 (20MB 가 넘습니다)')
    t0 = time.time()
    req = urllib.request.Request(f'{CORP}?crtfc_key={DART}',
                                 headers={'User-Agent': 'tm2026/1.0'})
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read()
    log(f'   내려받기 {len(raw) / 1024 / 1024:.1f}MB · {time.time() - t0:.0f}초')

    # 키가 잘못되면 zip 대신 짧은 XML 오류가 옵니다
    if len(raw) < 1000:
        sys.exit(f'[오류] 대응표를 받지 못했습니다 — {raw.decode("utf-8", "replace")[:200]}')

    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        name = z.namelist()[0]
        xml = z.read(name).decode('utf-8')
    log(f'   압축 풀기 {len(xml) / 1024 / 1024:.1f}MB')

    # 회사 하나가 <list>...</list> 한 덩어리입니다.
    #  덩어리 단위로 끊어서 읽어야 합니다 — 통째로 훑으면 비상장사(종목코드 빈칸)의
    #  고유번호가 바로 다음 회사의 종목코드와 잘못 짝지어집니다.
    out = {}
    total = 0
    for block in xml.split('<list>'):
        cc = re.search(r'<corp_code>\s*(\d{8})\s*</corp_code>', block)
        if not cc:
            continue
        total += 1
        sc = re.search(r'<stock_code>\s*(\d{6})\s*</stock_code>', block)
        if sc:
            out[sc.group(1)] = cc.group(1)
    log(f'   전체 {total:,}개 회사 중 상장사 {len(out):,}개')
    return out


def main() -> int:
    if not SITE or not KEY:
        sys.exit('[오류] SITE_URL / SCREENER_KEY 환경변수가 필요합니다.')
    if not DART:
        sys.exit('[오류] DART_KEY 환경변수가 필요합니다.\n'
                 '       사이트(Vercel)에 넣은 것과 같은 값을 ~/minervini/.env 에 넣어 주세요.')

    m = fetch_map()
    if len(m) < 1000:
        sys.exit(f'[오류] 상장사가 {len(m)}개뿐입니다. 표가 온전하지 않아 보내지 않습니다.')

    # 확인용 — 삼성전자는 항상 있어야 합니다
    log(f'   삼성전자(005930) → {m.get("005930", "없음")}')

    body = json.dumps({'map': m}, ensure_ascii=False).encode('utf-8')
    log(f'전송 {len(body) / 1024:.0f}KB')
    req = urllib.request.Request(
        f'{SITE}/api/screener/corpmap', data=body, method='POST',
        headers={'Content-Type': 'application/json; charset=utf-8',
                 'x-screener-key': KEY})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
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
