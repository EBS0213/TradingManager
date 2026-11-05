#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""사이트에 저장된 워치리스트를 내려받아 output/watchlist.csv 로 저장합니다."""
import os, sys, csv, json, urllib.request

SITE = os.environ.get('SITE_URL', '').rstrip('/')
KEY = os.environ.get('SCREENER_KEY', '')
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                   'output', 'watchlist.csv')

if not SITE or not KEY:
    print('[워치리스트] SITE_URL / SCREENER_KEY 가 없어 건너뜁니다.')
    sys.exit(0)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
try:
    req = urllib.request.Request(f'{SITE}/api/screener/upload',
                                 headers={'x-screener-key': KEY})
    with urllib.request.urlopen(req, timeout=30) as r:
        data = json.loads(r.read().decode())
    rows = data.get('watchlist') or []
except Exception as e:
    print(f'[워치리스트] 내려받기 실패({e}). 기존 파일을 그대로 씁니다.')
    sys.exit(0)

with open(OUT, 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.writer(f)
    w.writerow(['코드', '종목명', '메모', '추가일'])
    for r in rows:
        w.writerow([r.get('코드', ''), r.get('종목명', ''),
                    r.get('메모', ''), r.get('추가일', '')])
print(f'[워치리스트] {len(rows)}종목을 사이트에서 가져왔습니다.')
