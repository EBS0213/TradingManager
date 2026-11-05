#!/usr/bin/env python3
"""이미 존재하는 글/첨부의 접근만 확인. 글 생성/수정/파일 업로드 없음."""
import importlib.util
import json
from pathlib import Path
import sys
import urllib.request
import urllib.error

root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
from 자동검토 import api, ORIGIN, NoRedirect

spec = importlib.util.spec_from_file_location('publisher', root / '올리기.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
key = module.키찾기()
for post_id in (36, 37):
    for label, value in [('guest', ''), ('key', key)]:
        try:
            d = api('/api/board/' + str(post_id), value)
            print(post_id, label, 'ok', d.get('ok'), 'cat', d.get('post', {}).get('cat'), 'canWrite', d.get('canWrite'))
            if d.get('post', {}).get('cat') == 'review':
                for f in d.get('files', []):
                    for flabel, fkey in [('guest',''),('key',key)]:
                        req = urllib.request.Request(ORIGIN + '/api/files/get?id=' + str(f['id']), headers={'x-screener-key': fkey})
                        try:
                            with urllib.request.build_opener(NoRedirect()).open(req, timeout=20) as r:
                                print('private_attachment', flabel, 'HTTP', r.status)
                        except urllib.error.HTTPError as e:
                            print('private_attachment', flabel, 'HTTP', e.code)
        except urllib.error.HTTPError as e:
            print(post_id, label, 'HTTP', e.code)
