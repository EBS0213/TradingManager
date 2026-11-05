#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""전날 게시된 기업분석 리포트 카드뉴스를 아침 08:00 에 한꺼번에 보냅니다. (2026-10-13 사용자 지시)

    python3 카드뉴스아침발송.py            어제까지 대기표에 오른 것을 종목마다 따로 보냄
    python3 카드뉴스아침발송.py --확인     보낼 목록만 보여 줌
    python3 카드뉴스아침발송.py --대상 -5437418963   시험방으로 (대기표·receipt 는 그대로 둠)

· 대기표는 `캐시/카드뉴스대기.json` — `자동검토.py` 카드뉴스발송() 이 게시 직후 올립니다.
· 「1일에 만든 리포트 → 2일 08:00」. 오늘 올라온 것은 내일 아침으로 넘깁니다.
· 국내 셋업 종목이 없어 국내 리포트가 안 만들어진 날은 해외만 나갑니다(따로 채우지 않음).
· 종목마다 앨범 하나씩, 사이에 20초를 둡니다(채널 발송 한도). 실패한 건은 세 번까지 다음 날 다시.
· 예약: launchd com.jun.stockreport.cardnews (매일 08:00)
"""
import argparse, datetime as dt, json, subprocess, sys, time
from pathlib import Path

뿌리 = Path(__file__).resolve().parent
대기 = 뿌리 / "캐시" / "카드뉴스대기.json"
KST = dt.timezone(dt.timedelta(hours=9))


def 지금():
    return dt.datetime.now(KST).isoformat(timespec="seconds")


def 저장(길, 값):
    임시 = 길.with_suffix(".tmp")
    임시.write_text(json.dumps(값, ensure_ascii=False, indent=2) + "\n")
    임시.replace(길)


def main():
    ㅍ = argparse.ArgumentParser()
    ㅍ.add_argument("--확인", action="store_true")
    ㅍ.add_argument("--대상")
    a = ㅍ.parse_args()

    목록 = json.loads(대기.read_text()) if 대기.exists() else []
    오늘 = dt.datetime.now(KST).date().isoformat()
    보낼것 = [x for x in 목록 if x["queued_at"][:10] < 오늘]
    print(f"[{지금()}] 대기 {len(목록)}건 · 오늘 보낼 것 {len(보낼것)}건")
    for x in 보낼것:
        print("   ", x["queued_at"][:16], x["body"])
    if a.확인 or not 보낼것:
        return

    py = 뿌리 / ".venv/bin/python3"
    남김 = [x for x in 목록 if x not in 보낼것]
    for i, x in enumerate(보낼것):
        if i:
            time.sleep(20)
        명령 = [str(py if py.exists() else sys.executable), "카드뉴스.py", x["body"], "--보내기"]
        if a.대상:
            명령 += ["--대상", a.대상]
        rc = subprocess.run(명령, cwd=뿌리, timeout=900).returncode
        if a.대상:
            continue                                    # 시험 — 기록을 건드리지 않습니다
        영수 = 뿌리 / x["receipt"]
        r = json.loads(영수.read_text()) if 영수.exists() else {}
        if rc == 0:
            r["cardnews_at"] = 지금(); r.pop("cardnews_error", None)
        else:
            x["tries"] = x.get("tries", 0) + 1
            r["cardnews_error"] = f"카드뉴스.py 종료코드 {rc} ({x['tries']}번째, 로그/카드뉴스.log)"
            if x["tries"] < 3:
                남김.append(x)
        if 영수.exists():
            저장(영수, r)
    if not a.대상:
        저장(대기, 남김)


if __name__ == "__main__":
    main()
