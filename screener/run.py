#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
미너비니 SEPA 스크리너 — 실행 파일

터미널에서:
    python3 run.py            평소 실행 (2시간마다 자동 실행되는 것도 이 명령)
    python3 run.py --open     끝나고 대시보드를 브라우저로 바로 열기
    python3 run.py --test     인터넷 없이 가짜 데이터로 동작만 확인
    python3 run.py --serve    스크리닝 후 로컬 서버로 대시보드 열기 (파일 올릴 필요 없음)
    python3 run.py --serve-only  스크리닝 없이 서버만 켜기
"""
from __future__ import annotations
import sys
import os
import time
import traceback
import datetime as dt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from screener import config, data, rules, fundamentals, supply, watchlist, report   # noqa: E402


def log(msg: str):
    line = f'[{dt.datetime.now():%H:%M:%S}] {msg}'
    print(line, flush=True)
    try:
        with open(os.path.join(config.LOG_DIR,
                               f'{dt.date.today():%Y%m}.log'), 'a',
                  encoding='utf-8') as f:
            f.write(f'{dt.datetime.now():%Y-%m-%d %H:%M:%S} {msg}\n')
    except Exception:
        pass


def is_market_time(s) -> bool:
    now = dt.datetime.now()
    if now.weekday() >= 5:
        return False
    o = dt.datetime.strptime(s.market_open, '%H:%M').time()
    c = dt.datetime.strptime(s.market_close, '%H:%M').time()
    return o <= now.time() <= c


def main(argv) -> int:
    t0 = time.time()
    s = config.load()

    if '--serve-only' in argv:
        from screener.server import serve
        serve()
        return 0

    if '--test' in argv:
        from tests.fake import build
        log('가짜 데이터로 동작 확인 중...')
        ohlcv, tickers, sectors = build()
        s.use_fundamentals = False
        s.use_supply = False
    else:
        if s.only_during_market and not is_market_time(s):
            log('장 시간이 아니라 그냥 종료합니다.')
            return 0
        log('시작 — 종목 목록을 확인합니다.')
        tickers = data.load_tickers(s)
        log(f'대상 {len(tickers):,}종목')
        if len(tickers) == 0:
            log('종목 목록이 비어 있습니다. 진단.command 를 실행해 주세요.')
            return 1
        sectors = data.load_sectors(s)
        log(f'업종 정보 {len(sectors):,}건')
        ohlcv = data.update_ohlcv(s, tickers=tickers)
        ohlcv = data.apply_intraday(ohlcv, s)

    log('8개 조건을 판정합니다.')
    df = rules.screen(ohlcv, tickers, sectors, s)
    stats = rules.summarize(df)
    log(f'8조건 통과 {stats["통과"]}종목 / 7개 통과 {stats["7개통과"]}종목')

    df = fundamentals.apply(df, s)
    df = supply.apply(df, s)
    df = watchlist.attach(df)
    df = report.mark_new(df)
    stats = rules.summarize(df)

    path = report.write_html(df, stats, s)
    report.write_csv(df, s)
    txt = report.write_summary(df, stats)

    print()
    print(txt)
    print()
    log(f'완료 ({time.time() - t0:.0f}초) → {path}')

    if '--serve' in argv:
        from screener.server import serve
        serve()
    elif '--open' in argv:
        os.system(f'open "{path}"')
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main(sys.argv[1:]))
    except SystemExit:
        raise
    except KeyboardInterrupt:
        print('\n중단했습니다.')
        sys.exit(1)
    except Exception:
        traceback.print_exc()
        log('오류로 중단되었습니다. 위 메시지를 그대로 복사해서 물어보시면 됩니다.')
        sys.exit(1)
