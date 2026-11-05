#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
올려둔 증권사 리포트 PDF 읽기 (AWS 서울 서버에서 실행).

흐름
  ① 사이트에 "읽을 것 있나요?" 물어봅니다 (/api/report/job)
  ② PDF 를 받아 글자를 뽑습니다
  ③ 증권사 · 종목 · 목표주가 · 투자의견 · 투자포인트를 찾아냅니다
  ④ 결과만 돌려보냅니다 (/api/report/done). 무거운 PDF 는 사이트에서 지웁니다.

왜 서버가 읽나
  맥에 SSH 키가 없어 파일을 서버로 직접 못 보냅니다. 그래서 사이트가 받아 두고
  서버가 가져갑니다. PDF 에서 글자를 뽑는 일도 라이브러리가 필요해 서버가 편합니다.

무엇을 저장하나
  뽑아낸 글자와 투자포인트를 저장합니다. 이것은 **내 보고서를 쓰기 위한 재료**이지
  남에게 보여주기 위한 것이 아닙니다. 리포트 원문은 공개 게시하지 않습니다.

필요한 것
  pdfplumber  (setup 스크립트가 깔아 줍니다)
환경변수
  SITE_URL · SCREENER_KEY
"""
from __future__ import annotations
import os
import re
import io
import sys
import json
import base64
import datetime as dt
import urllib.request
import urllib.error

SITE = os.environ.get('SITE_URL', '').rstrip('/')
KEY = os.environ.get('SCREENER_KEY', '')

# 자주 나오는 증권사 — 본문에서 찾습니다
BROKERS = [
    '미래에셋증권', '한국투자증권', 'NH투자증권', '삼성증권', 'KB증권', '신한투자증권',
    '하나증권', '키움증권', '메리츠증권', '대신증권', '유안타증권', '한화투자증권',
    '교보증권', 'IBK투자증권', 'SK증권', '현대차증권', '신영증권', '유진투자증권',
    'DB금융투자', 'BNK투자증권', '다올투자증권', '하이투자증권', '흥국증권',
    '상상인증권', 'LS증권', '이베스트투자증권', '부국증권', '카카오페이증권',
]

OPINIONS = ['매수', 'BUY', 'Buy', '적극매수', 'STRONG BUY', '중립', 'HOLD', 'Hold',
            '보유', '비중확대', 'Overweight', '비중축소', 'Underweight',
            '매도', 'SELL', 'Sell', 'Not Rated', 'N/R']


def log(m):
    print(f'[{dt.datetime.now():%H:%M:%S}] {m}', flush=True)


def api(path, data=None, timeout=120):
    req = urllib.request.Request(
        f'{SITE}{path}',
        data=None if data is None else json.dumps(data, ensure_ascii=False).encode('utf-8'),
        method='POST' if data is not None else 'GET',
        headers={'x-screener-key': KEY,
                 'Content-Type': 'application/json; charset=utf-8'})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode() or '{}')


# ─────────────────────── PDF 에서 글자 뽑기 ───────────────────────
def extract(raw: bytes) -> str:
    try:
        import pdfplumber
    except ImportError:
        raise SystemExit(
            '[오류] pdfplumber 가 없습니다.\n'
            '       ~/minervini/.venv/bin/pip install pdfplumber')
    out = []
    with pdfplumber.open(io.BytesIO(raw)) as pdf:
        for page in pdf.pages[:20]:          # 앞 20쪽이면 충분합니다
            t = page.extract_text() or ''
            if t.strip():
                out.append(t)
    return '\n'.join(out)


# ─────────────────────── 항목 찾아내기 ───────────────────────
def find_broker(text: str, filename: str) -> str:
    hay = text[:4000] + ' ' + filename
    for b in BROKERS:
        if b in hay:
            return b
    # '○○증권' 꼴을 통째로 찾아봅니다
    m = re.search(r'([가-힣A-Za-z]{2,10}(?:투자)?증권)', hay)
    return m.group(1) if m else ''


def find_code(text: str) -> str:
    """종목코드 — 'A005930' · '005930.KS' · '(131290)' 같은 꼴"""
    head = text[:3000]
    for pat in (r'\bA(\d{6})\b', r'\b(\d{6})\.(?:KS|KQ)\b',
                r'[(\[]\s*(\d{6})\s*[)\]]', r'\b(\d{6})\s*(?:KS|KQ)\b'):
        m = re.search(pat, head)
        if m:
            return m.group(1)
    return ''


def find_day(text: str, filename: str) -> str:
    for hay in (filename, text[:2000]):
        m = re.search(r'(20\d{2})[.\-/년\s]*(\d{1,2})[.\-/월\s]*(\d{1,2})', hay)
        if m:
            y, mo, d = m.groups()
            return f'{y}{int(mo):02d}{int(d):02d}'
        m = re.search(r'\b(20\d{6})\b', hay)
        if m:
            return m.group(1)
    return ''


def find_target(text: str):
    """목표주가 — 숫자 뒤에 원/KRW 가 붙거나 표에 들어 있습니다."""
    head = text[:6000]
    for pat in (r'목표\s*주가[^0-9]{0,20}([\d,]{3,12})',
                r'목표가[^0-9]{0,20}([\d,]{3,12})',
                r'TP[^0-9]{0,12}([\d,]{3,12})',
                r'Target\s*Price[^0-9]{0,20}([\d,]{3,12})'):
        m = re.search(pat, head, re.I)
        if m:
            try:
                v = float(m.group(1).replace(',', ''))
            except ValueError:
                continue
            if 100 <= v <= 10_000_000:        # 터무니없는 값을 거릅니다
                return v
    return None


def find_opinion(text: str) -> str:
    head = text[:6000]
    m = re.search(r'투자\s*의견[^가-힣A-Za-z]{0,10}([가-힣A-Za-z ]{2,12})', head)
    if m:
        cand = m.group(1).strip()
        for o in OPINIONS:
            if cand.upper().startswith(o.upper()):
                return o
    for o in OPINIONS:
        if re.search(r'(?<![가-힣])' + re.escape(o) + r'(?![가-힣])', head):
            return o
    return ''


def find_points(text: str, n: int = 8) -> list:
    """
    투자포인트 — 리포트가 '왜 사라' 고 말하는 근거들.

    증권사 리포트는 앞쪽에 굵은 소제목이나 글머리표로 요점을 답니다.
    그 줄들을 모읍니다. 완벽하진 않지만, 나중에 AI 가 글을 쓸 때
    '이 리포트는 이런 주장을 했다' 는 실마리로 충분합니다.
    """
    head = text[:9000]
    out, seen = [], set()

    # ① 글머리표로 시작하는 줄
    for line in head.split('\n'):
        t = line.strip()
        if not (8 <= len(t) <= 120):
            continue
        if not re.match(r'^[▶▪■□●○◆◇•·\-–—]\s*', t):
            continue
        t = re.sub(r'^[▶▪■□●○◆◇•·\-–—]\s*', '', t).strip()
        k = re.sub(r'\s', '', t)
        if len(t) < 8 or k in seen:
            continue
        seen.add(k); out.append(t)

    # ② 그래도 부족하면 '투자포인트' 뒤의 몇 줄
    if len(out) < 3:
        m = re.search(r'투자\s*포인트(.{0,900})', head, re.S)
        if m:
            for line in m.group(1).split('\n'):
                t = re.sub(r'^[▶▪■□●○◆◇•·\-\d.)\s]+', '', line).strip()
                k = re.sub(r'\s', '', t)
                if 10 <= len(t) <= 120 and k not in seen:
                    seen.add(k); out.append(t)
                if len(out) >= n:
                    break
    return out[:n]


def parse(raw: bytes, filename: str) -> dict:
    text = extract(raw)
    if len(text.strip()) < 100:
        raise RuntimeError('글자를 뽑지 못했습니다 (그림으로만 된 PDF 일 수 있습니다)')
    return {
        'body': text,
        'code': find_code(text),
        'broker': find_broker(text, filename),
        'day': find_day(text, filename),
        'target': find_target(text),
        'opinion': find_opinion(text),
        'points': {'투자포인트': find_points(text), '글자수': len(text)},
    }


def main() -> int:
    if not SITE or not KEY:
        sys.exit('[오류] SITE_URL / SCREENER_KEY 환경변수가 필요합니다.')

    done = 0
    for _ in range(50):                     # 한 번에 최대 50건
        try:
            r = api('/api/report/job')
        except Exception as e:
            log(f'사이트 확인 실패 {e}')
            return 1
        job = r.get('job')
        if not job:
            break

        name = job.get('filename') or '?'
        log(f"읽는 중 #{job['id']} {name} ({job.get('bytes', 0) // 1024}KB)")
        try:
            raw = base64.b64decode(job['pdf'])
            d = parse(raw, name)
        except SystemExit:
            raise
        except Exception as e:
            log(f'   실패 {e}')
            api('/api/report/done', {'id': job['id'], 'fail': str(e)[:300]})
            continue

        d['id'] = job['id']
        pts = d['points']['투자포인트']
        log(f"   증권사 {d['broker'] or '?'} · 종목 {d['code'] or '?'} · "
            f"목표가 {d['target'] or '?'} · 의견 {d['opinion'] or '?'} · "
            f"포인트 {len(pts)}개")
        for p in pts[:3]:
            log(f'      · {p[:60]}')
        api('/api/report/done', d)
        done += 1

    log(f'끝 — {done}건 읽었습니다' if done else '읽을 것이 없습니다')
    return 0


if __name__ == '__main__':
    sys.exit(main())
