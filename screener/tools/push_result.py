#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""스크리닝 결과(output/payload.json)를 웹사이트로 전송합니다."""
import os, sys, json, gzip, urllib.request

SITE = os.environ.get('SITE_URL', '').rstrip('/')
KEY = os.environ.get('SCREENER_KEY', '')
SRC = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   'output', 'payload.json')

if not SITE or not KEY:
    sys.exit('[전송] SITE_URL / SCREENER_KEY 환경변수가 필요합니다.')
if not os.path.exists(SRC):
    sys.exit(f'[전송] {SRC} 가 없습니다. 스크리닝이 실패했는지 확인하세요.')

with open(SRC, encoding='utf-8') as f:
    payload = json.load(f)
payload['source'] = os.environ.get('RUN_SOURCE', 'github')

body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
print(f'[전송] {len(payload.get("result", [])):,}종목 / {len(body)/1024/1024:.2f} MB')

req = urllib.request.Request(
    f'{SITE}/api/screener/upload', data=gzip.compress(body), method='POST',
    headers={'Content-Type': 'application/json; charset=utf-8',
             'Content-Encoding': 'gzip', 'x-screener-key': KEY})
try:
    with urllib.request.urlopen(req, timeout=120) as r:
        print('[전송] 완료 —', r.read().decode()[:300])
except Exception as e:
    # gzip 을 못 받는 환경이면 그냥 보냅니다
    print(f'[전송] gzip 실패({e}) — 압축 없이 재시도')
    req = urllib.request.Request(
        f'{SITE}/api/screener/upload', data=body, method='POST',
        headers={'Content-Type': 'application/json; charset=utf-8',
                 'x-screener-key': KEY})
    with urllib.request.urlopen(req, timeout=180) as r:
        print('[전송] 완료 —', r.read().decode()[:300])
