#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
서버 작업이 실패했을 때 텔레그램으로 알립니다.

    python3 tools/alert.py <작업이름> <종료코드> <로그파일>

왜 필요한가
  2026-08-18 까지 미국 스크리너는 API 키가 거부당해 몇 주째 아무 자료도
  받지 못하고 있었는데, 로그에는 'rc=0'(정상)으로 찍혀 아무도 몰랐습니다.
  실패가 조용하면 없는 것과 같습니다. 이제는 폰으로 알립니다.

토큰은 이 서버에 두지 않습니다. 사이트(/api/screener/alert)가 대신 보냅니다.
서버가 아는 비밀은 SCREENER_KEY 하나뿐입니다.
"""
from __future__ import annotations
import json
import os
import sys
import urllib.request

MAX_LINES = 4          # 알림에 붙일 로그 줄 수
MAX_CHARS = 3000


def pick_lines(path: str) -> list[str]:
    """[오류] 가 들어간 줄을 우선 보여주고, 없으면 마지막 줄들을 보여줍니다."""
    try:
        with open(path, encoding='utf-8', errors='replace') as f:
            lines = [l.rstrip() for l in f if l.strip()]
    except Exception:
        return []
    bad = [l for l in lines if '[오류]' in l or 'Error' in l or 'Traceback' in l]
    return (bad or lines)[-MAX_LINES:]


def main(argv) -> int:
    task = argv[0] if len(argv) > 0 else '?'
    rc = argv[1] if len(argv) > 1 else '?'
    logp = argv[2] if len(argv) > 2 else ''

    site = os.environ.get('SITE_URL', '').rstrip('/')
    key = os.environ.get('SCREENER_KEY', '')
    if not site or not key:
        print('[알림] SITE_URL / SCREENER_KEY 가 없어 알림을 보내지 못했습니다', flush=True)
        return 1

    tail = '\n'.join(pick_lines(logp)) if logp else ''
    text = (f'⚠️ 미국 스크리너 실패\n'
            f'작업: {task}\n'
            f'종료코드: {rc}\n')
    if tail:
        text += f'\n{tail}'
    text = text[:MAX_CHARS]

    req = urllib.request.Request(
        f'{site}/api/screener/alert',
        data=json.dumps({'text': text}, ensure_ascii=False).encode('utf-8'),
        headers={'Content-Type': 'application/json; charset=utf-8',
                 'x-screener-key': key},
        method='POST')
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            print(f'[알림] 텔레그램으로 알렸습니다 ({r.status})', flush=True)
        return 0
    except Exception as e:
        print(f'[알림] 전송 실패({e})', flush=True)
        return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
