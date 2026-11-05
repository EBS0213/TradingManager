#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
배점이 아직 통하는지 매달 확인합니다 (2026-08-30)
====================================================================
무엇을 하나
  **지금 실제로 쓰고 있는 배점**으로 최근 2년을 되짚어서,
  "점수 상위 20종목" 이 "8조건 통과 종목 전부" 보다 나았는지 봅니다.

  배점을 **다시 찾지 않습니다.** 지금 것이 여전히 값어치가 있는지만 봅니다.
  그래서 과최적화 위험이 없습니다 — 자동으로 돌려도 안전한 유일한 검사입니다.

왜 필요한가
  2026-08-30 검증에서 그때까지 쓰던 배점이 **점수를 아예 안 매기는 것보다
  나빴다**는 것이 드러났습니다(-1.61%p). 몇 달째 그 상태였는데 아무도 몰랐습니다.
  시장이 바뀌면 배점도 낡습니다. 늦게 알아챌수록 손해가 쌓입니다.

  실패가 조용하면 없는 것과 같습니다. 그래서 매달 재고, 나빠지면 알립니다.

어떻게 재나
  · rules.screen() → rules.add_score() 를 그대로 부릅니다.
    **화면에 나오는 그 종합점수**입니다 — 감점까지 포함해서 실제 시스템 그대로입니다.
  · 과거 시점에는 실적·수급 자료를 안 채웁니다. 그러면 EPS·매출·수급 세 항목이
    **모든 종목에서 같은 값(중립)** 이 되어 순위에 아무 영향을 주지 않습니다.
    (실측 확인: 그 셋의 서로 다른 값 개수 = 1)
    덕분에 '오늘 실적으로 과거를 채점하는' 미래 엿보기가 자동으로 없어집니다.
  · 결과를 data/배점_점검.csv 에 한 줄씩 쌓습니다 — 달마다 흐름이 보입니다.

판정
  정상  격차 > +0.5%p 이고 승률 >= 50%
  주의  격차가 -0.5 ~ +0.5%p (배점이 사실상 일을 안 하고 있음)
  경고  격차 < -0.5%p        (배점이 오히려 해가 되고 있음)

  '경고' 면 종료코드 2 로 끝납니다 → tools/alert.py 가 폰으로 알립니다.

쓰는 법
    .venv/bin/python tools/monthly_check.py
    .venv/bin/python tools/monthly_check.py --months 36
"""
from __future__ import annotations
import os
import sys
import csv
import argparse
import warnings
import datetime as dt
import numpy as np
import pandas as pd

warnings.filterwarnings('ignore')
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from screener import config, rules      # noqa: E402

# 점수내역의 차례 — rules.PARTS_KR 과 같습니다.
#  여기서 **과거 값이 없는 항목**을 뺍니다.
LOOKAHEAD = {'EPS', '매출', '수급'}
OUT = os.path.join(config.DATA_DIR, '배점_점검.csv')


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument('--months', type=int, default=24)
    ap.add_argument('--hold', type=int, default=63)
    ap.add_argument('--step', type=int, default=21)
    ap.add_argument('--top', type=int, default=20)
    a = ap.parse_args()

    s = config.load()
    ohlcv = pd.read_parquet(os.path.join(config.DATA_DIR, 'ohlcv.parquet'))
    tickers = pd.read_parquet(os.path.join(config.DATA_DIR, 'tickers.parquet'))
    sp = os.path.join(config.DATA_DIR, 'sectors.parquet')
    sectors = pd.read_parquet(sp) if os.path.exists(sp) else pd.DataFrame()
    ohlcv['date'] = pd.to_datetime(ohlcv['date'])
    days = np.array(sorted(ohlcv['date'].unique()))

    parts = list(getattr(rules, 'PARTS_KR', []))
    W = {k: getattr(rules, v, None) for k, v in
         [('RS', 'W_RS'), ('EPS', 'W_EPS'), ('매출', 'W_SALES'), ('자금', 'W_UD'),
          ('수급', 'W_SUPPLY'), ('고점', 'W_HI'), ('VCP', 'W_VCP'), ('지속', 'W_STAY'),
          ('변동', 'W_ADR'), ('범위', 'W_RNG'), ('고가', 'W_NEAR'), ('마름', 'W_DRY')]}
    print('═' * 62)
    print(' 배점 점검 — 지금 쓰는 배점이 아직 통하나')
    print('═' * 62)
    print(f'  자료 : 거래일 {len(days)}일 ({pd.Timestamp(days[0]):%Y-%m-%d} ~ '
          f'{pd.Timestamp(days[-1]):%Y-%m-%d})')
    print(f'  지금 배점 : ' + ' · '.join(f'{k} {v}' for k, v in W.items() if v))
    print(f'  ※ {sorted(LOOKAHEAD)} 는 과거 자료가 없어 모든 종목이 같은 값이 됩니다')
    print(f'    → 순위에 영향을 주지 않으므로 미래 엿보기가 없습니다')

    last_i = len(days) - 1 - a.hold
    first_i = max(250, last_i - a.months * 21)
    points = list(range(first_i, last_i + 1, a.step))
    if len(points) < 6:
        print('\n  [멈춤] 되짚을 날이 6개도 안 됩니다. 자료가 짧습니다.')
        print('         tools/backfill_ohlcv.py 로 과거를 채우세요.')
        return 1

    close_w = ohlcv.pivot_table(index='date', columns='code', values='close').ffill()
    mine, base, worst = [], [], []

    for n, i in enumerate(points, 1):
        T = pd.Timestamp(days[i])
        try:
            df = rules.screen(ohlcv[ohlcv['date'] <= T], tickers, sectors, s)
            df = rules.add_score(df, s)      # ← 화면에 나오는 그 점수를 만듭니다
        except Exception as e:
            print(f'  [{n}/{len(points)}] {T:%Y-%m-%d} 건너뜀 — {e}')
            continue
        if df is None or df.empty or '종합점수' not in df.columns:
            continue
        d = df[(df['통과개수'] >= 6) & df['부적합사유'].fillna('').eq('')].copy()
        if len(d) < 15:
            continue
        T2 = pd.Timestamp(days[i + a.hold])
        if T not in close_w.index or T2 not in close_w.index:
            continue
        p0, p1 = close_w.loc[T], close_w.loc[T2]
        d['fwd'] = d['코드'].map(p1) / d['코드'].map(p0) - 1
        d = d[d['fwd'].notna()]
        if len(d) < 15:
            continue

        d['_점수'] = pd.to_numeric(d['종합점수'], errors='coerce')
        d = d[d['_점수'].notna()]
        if len(d) < 15:
            continue

        top = d.nlargest(min(a.top, len(d)), '_점수')
        mine.append(top['fwd'].mean())
        base.append(d['fwd'].mean())
        worst.append(top['fwd'].min())
        print(f'  [{n}/{len(points)}] {T:%Y-%m-%d}  상위{a.top} {mine[-1]*100:+6.2f}%  '
              f'통과전체 {base[-1]*100:+6.2f}%', flush=True)

    if len(mine) < 6:
        print('\n  [멈춤] 쓸 만한 시점이 6개도 안 됩니다.')
        return 1

    m = np.array(mine); b = np.array(base)
    edge = float((m - b).mean() * 100)
    win = float((m > b).mean() * 100)
    verdict = '정상' if (edge > 0.5 and win >= 50) else ('경고' if edge < -0.5 else '주의')

    print('═' * 62)
    print(f'  시점 {len(m)}개 · 겹치지 않는 구간 약 {max(1, round(len(m)*a.step/a.hold))}개')
    print(f'  점수 상위 {a.top}종목 평균 : {m.mean()*100:+.2f}%')
    print(f'  8조건 통과 전체  평균 : {b.mean()*100:+.2f}%')
    print(f'  **격차 : {edge:+.2f}%p · 이긴 시점 {win:.0f}% · 최악 {min(worst)*100:+.1f}%**')
    print(f'  판정 : {verdict}')
    if verdict == '경고':
        print('\n  ⚠️ 배점이 오히려 해가 되고 있습니다. 점수를 아예 안 매기고')
        print('     8조건 통과 종목을 그냥 보는 편이 나았다는 뜻입니다.')
        print('     tools/backtest_weights.py 로 항목별 예측력을 다시 재세요.')
    elif verdict == '주의':
        print('\n  배점이 사실상 일을 안 하고 있습니다. 당장 문제는 아니지만')
        print('  두세 달 이어지면 다시 재는 것이 좋습니다.')
    print('═' * 62)

    # 한 줄씩 쌓아 둡니다 — 달마다 흐름이 보입니다
    row = {'날짜': dt.date.today().isoformat(), '시점수': len(m),
           '상위평균': round(m.mean()*100, 2), '전체평균': round(b.mean()*100, 2),
           '격차': round(edge, 2), '승률': round(win, 1),
           '최악': round(min(worst)*100, 1), '판정': verdict}
    try:
        new = not os.path.exists(OUT)
        with open(OUT, 'a', newline='', encoding='utf-8-sig') as f:
            w = csv.DictWriter(f, fieldnames=list(row))
            if new:
                w.writeheader()
            w.writerow(row)
        print(f'  기록해 두었습니다 → {OUT}')
        prev = pd.read_csv(OUT)
        if len(prev) > 1:
            print('\n  지난 기록:')
            for r in prev.tail(6).to_dict('records'):
                print(f"    {r['날짜']}  격차 {r['격차']:+6.2f}%p  승률 {r['승률']:4.0f}%  {r['판정']}")
    except Exception as e:
        print(f'  (기록을 남기지 못했습니다 — {e})')

    return 2 if verdict == '경고' else 0


if __name__ == '__main__':
    sys.exit(main())
