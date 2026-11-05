# -*- coding: utf-8 -*-
"""
작은 로컬 서버.

`대시보드 열기.command` 를 더블클릭하면 이 서버가 뜨고 브라우저가 열립니다.
파일을 올릴 필요가 없어지고, 워치리스트를 브라우저에서 바로 맥에 저장할 수 있습니다.

  GET  /                → output/dashboard.html
  GET  /result.csv      → 최신 스크리닝 결과 (페이지가 알아서 읽습니다)
  GET  /watchlist.csv   → 워치리스트
  GET  /api/ping        → 서버가 살아 있는지 확인
  POST /api/watchlist   → 브라우저에서 편집한 워치리스트를 파일로 저장
  POST /api/run         → 지금 다시 스크리닝 (백그라운드)

바깥에서는 접속할 수 없습니다(127.0.0.1 전용).
"""
from __future__ import annotations
import os
import sys
import json
import threading
import subprocess
import webbrowser
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

from . import config

PORT = int(os.environ.get('MINERVINI_PORT', '8765'))
_running = {'busy': False, 'log': ''}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=config.OUT_DIR, **kw)

    def log_message(self, *a):
        pass                                  # 터미널을 조용히

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith('/api/ping'):
            return self._json({'ok': True, 'busy': _running['busy']})
        if self.path.startswith('/api/status'):
            return self._json(_running)
        if self.path in ('/', '/index.html'):
            self.path = '/dashboard.html'
        return super().do_GET()

    def do_POST(self):
        n = int(self.headers.get('Content-Length', 0) or 0)
        body = self.rfile.read(n).decode('utf-8', 'replace') if n else ''

        if self.path.startswith('/api/watchlist'):
            path = os.path.join(config.OUT_DIR, 'watchlist.csv')
            try:
                with open(path, 'w', encoding='utf-8-sig') as f:
                    f.write(body.lstrip('﻿'))
                print(f'[서버] 워치리스트 저장 — {path}')
                return self._json({'ok': True, 'path': path})
            except Exception as e:
                return self._json({'ok': False, 'error': str(e)}, 500)

        if self.path.startswith('/api/run'):
            if _running['busy']:
                return self._json({'ok': False, 'error': '이미 실행 중입니다'}, 409)
            threading.Thread(target=_run_once, daemon=True).start()
            return self._json({'ok': True})

        return self._json({'ok': False, 'error': 'unknown'}, 404)


def _run_once():
    _running['busy'] = True
    try:
        print('[서버] 스크리닝을 다시 실행합니다...')
        r = subprocess.run([sys.executable,
                            os.path.join(config.BASE_DIR, 'run.py')],
                           capture_output=True, text=True)
        _running['log'] = (r.stdout or '')[-4000:]
        print('[서버] 완료')
    except Exception as e:
        _running['log'] = str(e)
    finally:
        _running['busy'] = False


def serve(open_browser: bool = True, port: int = PORT):
    for p in range(port, port + 20):
        try:
            httpd = ThreadingHTTPServer(('127.0.0.1', p), Handler)
        except OSError:
            continue
        url = f'http://127.0.0.1:{p}/'
        print('═' * 54)
        print('  미너비니 대시보드가 열렸습니다')
        print(f'  {url}')
        print('  이 창을 닫으면 서버가 꺼집니다. (Ctrl+C 로도 종료)')
        print('═' * 54)
        if open_browser:
            threading.Timer(0.7, lambda: webbrowser.open(url)).start()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\n서버를 종료합니다.')
        return
    print(f'[오류] {port}~{port+19} 포트가 모두 사용 중입니다.')
