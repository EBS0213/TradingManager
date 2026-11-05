#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
뉴스 모아서 사이트로 보내기 (AWS 서울 서버에서 실행).

왜 서버가 이 일을 하나
  뉴스1 · 한국경제 같은 곳은 해외 데이터센터에서 오는 요청을 403 으로 막습니다.
  사이트는 미국 서버(Vercel)에서 돌기 때문에 직접은 못 받습니다.
  이 서버는 서울에 있고 IP 도 고정이라 막히지 않습니다.
  받아서 사이트로 넘겨 주면 됩니다 — 스크리닝 결과를 넘기는 것과 같은 방식입니다.

무엇을 보내나
  제목과 원문 링크, 언론사 이름, 시각. 그게 전부입니다.
  본문은 받지도 저장하지도 보내지도 않습니다 (저작권).

환경변수
  SITE_URL       http://127.0.0.1:8766
  SCREENER_KEY   사이트와 똑같은 비밀 키
"""
from __future__ import annotations
import os
import re
import sys
import json
import datetime as dt
import urllib.request
import urllib.error
from email.utils import parsedate_to_datetime
from concurrent.futures import ThreadPoolExecutor

SITE = os.environ.get('SITE_URL', '').rstrip('/')
KEY = os.environ.get('SCREENER_KEY', '')

UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/124 Safari/537.36')

# 사이트가 직접 못 받는 곳만 여기서 받습니다.
#  (연합뉴스·매일경제·뉴시스는 사이트가 직접 받고 있어서 뺐습니다 — 두 번 받을 이유가 없습니다)
FEEDS = [
    # 뉴스1 — 자체 RSS 는 접었습니다.
    #  2026-08-18 재확인: rss.news1.kr / www.news1.kr/rss/*.xml 모두 404 입니다.
    #  대신 구글 뉴스에서 news1.kr 기사만 뽑아 옵니다. 제목과 링크만 쓰므로
    #  우리 쓰임(제목 + 원문 링크)에는 모자람이 없습니다.
    #  when:1d = 최근 하루치. 옛 주소도 남겨 둡니다 — 되살아나면 자동으로 잡힙니다.
    ('뉴스1', [
        'https://news.google.com/rss/search?q=site:news1.kr+when:1d&hl=ko&gl=KR&ceid=KR:ko',
        'https://www.news1.kr/rss/S1N1.xml',
    ]),
    # 아래는 사이트(미국 서버)가 직접 못 받는 곳들입니다.
    #  이 서버는 서울에 있어 막히지 않습니다.
    # 연합인포맥스 — 채권·외환·금리 쪽이 강해 브리핑 재료로 값어치가 큽니다.
    #  이 회사 사이트는 흔한 한국 언론 CMS 를 쓰고 있어 주소 규칙이 몇 가지입니다.
    #  어느 것이 살아 있는지 서버가 돌려 보고 알려 줍니다.
    ('인포맥스', [
        'https://news.einfomax.co.kr/rss/allArticle.xml',
        'https://news.einfomax.co.kr/rss/S1N1.xml',
        'https://news.einfomax.co.kr/rss/S1N2.xml',
        'https://news.einfomax.co.kr/rss/clickTop.xml',
        'http://news.einfomax.co.kr/rss/allArticle.xml',
    ]),
    ('한국경제', [
        'https://www.hankyung.com/feed/economy',
        'https://www.hankyung.com/feed/finance',
    ]),
    ('이데일리', [
        'https://rss.edaily.co.kr/stock_news.xml',
        'https://rss.edaily.co.kr/edaily_news.xml',
    ]),
    ('서울경제', [
        'https://www.sedaily.com/RSSFeed.xml',
        'https://www.sedaily.com/rss/Stock.xml',
    ]),
    # 머니투데이 — 2026-08-23 뺐습니다.
    #  경제 RSS 주소인데도 [포토]·연예·스포츠가 대부분이고, 한 시간에 수십 건씩
    #  들어와 목록을 덮었습니다. 낱말로 걸러도 남는 것이 주제와 겉돌아 아예 안 받습니다.
    #  (사이트 쪽 lib/newsfilter.js 의 DROP_SOURCE 에도 같은 이름이 있습니다 —
    #   여기서 안 보내고, 혹시 남아 있던 것도 거기서 한 번 더 걸러 냅니다)
    ('파이낸셜뉴스', [
        'https://www.fnnews.com/rss/fn_realnews_all.xml',
        'https://www.fnnews.com/rss/r_realnews_stock.xml',
    ]),
]

PER_FEED = 30


def log(m):
    print(f'[{dt.datetime.now():%H:%M:%S}] {m}', flush=True)


def strip(s: str) -> str:
    s = re.sub(r'<!\[CDATA\[([\s\S]*?)\]\]>', r'\1', s or '')
    s = re.sub(r'<[^>]*>', '', s)
    for a, b in (('&lt;', '<'), ('&gt;', '>'), ('&quot;', '"'),
                 ('&#39;', "'"), ('&apos;', "'"), ('&amp;', '&')):
        s = s.replace(a, b)
    return re.sub(r'\s+', ' ', s).strip()


def pick(block: str, tag: str) -> str:
    m = re.search(rf'<{tag}[^>]*>([\s\S]*?)</{tag}>', block, re.I)
    return strip(m.group(1)) if m else ''


def when_ms(s: str):
    if not s:
        return None
    try:
        return int(parsedate_to_datetime(s).timestamp() * 1000)
    except Exception:
        pass
    # <dc:date>2026-08-17T09:12:00+09:00</dc:date> 형태
    try:
        return int(dt.datetime.fromisoformat(s.replace('Z', '+00:00')).timestamp() * 1000)
    except Exception:
        return None


def one(url: str, name: str) -> list:
    req = urllib.request.Request(url, headers={
        'User-Agent': UA,
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'ko-KR,ko;q=0.9',
    })
    with urllib.request.urlopen(req, timeout=12) as r:
        raw = r.read()
    try:
        xml = raw.decode('utf-8')
    except UnicodeDecodeError:
        xml = raw.decode('euc-kr', 'replace')

    blocks = re.split(r'<item[\s>]', xml, flags=re.I)[1:]
    out = []
    for b in blocks[:PER_FEED]:
        title = pick(b, 'title')
        link = pick(b, 'link')
        if not title or not link.startswith('http'):
            continue
        out.append({'source': name, 'title': title, 'url': link,
                    'ms': when_ms(pick(b, 'pubDate') or pick(b, 'dc:date'))})
    if not out:
        raise RuntimeError('기사가 없습니다')
    return out


def gather() -> list:
    def go(item):
        name, urls = item
        for u in urls:
            try:
                rows = one(u, name)
                log(f'  {name}: {len(rows)}건  ({u})')
                return rows
            except Exception as e:
                log(f'  {name}: 실패 {u} → {e}')
        return []

    with ThreadPoolExecutor(max_workers=6) as ex:
        lists = list(ex.map(go, FEEDS))

    ok = [FEEDS[i][0] for i, l in enumerate(lists) if l]
    bad = [FEEDS[i][0] for i, l in enumerate(lists) if not l]
    log(f'되는 곳: {", ".join(ok) or "없음"}')
    if bad:
        log(f'안 되는 곳: {", ".join(bad)}')

    seen, items = set(), []
    for x in [r for lst in lists for r in lst]:
        k = re.sub(r'\s', '', x['title'])
        if k in seen:
            continue
        seen.add(k)
        items.append(x)
    items.sort(key=lambda x: x['ms'] or 0, reverse=True)
    return items


def main() -> int:
    if not SITE or not KEY:
        sys.exit('[오류] SITE_URL / SCREENER_KEY 환경변수가 필요합니다.')

    log('뉴스를 받습니다')
    items = gather()
    if not items:
        log('받은 기사가 없습니다. 보내지 않습니다.')
        return 1

    body = json.dumps({'items': items}, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(
        f'{SITE}/api/news/push', data=body, method='POST',
        headers={'Content-Type': 'application/json; charset=utf-8',
                 'x-screener-key': KEY})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
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
