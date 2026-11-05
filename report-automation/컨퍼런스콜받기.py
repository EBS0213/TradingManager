#!/usr/bin/env python3
"""미국 종목의 컨퍼런스콜 스크립트를 받아 온다 (API Ninjas).

  python3 컨퍼런스콜받기.py NVDA                 가장 가까운 최근 분기를 찾아 받는다
  python3 컨퍼런스콜받기.py NVDA 2026 2          연도·분기를 직접
  python3 컨퍼런스콜받기.py --계정               API 키를 넣는다 (맥 키체인)
  python3 컨퍼런스콜받기.py --확인               키가 살아 있는지만 본다

받은 것은 `캐시/콜_<티커>_<연도>Q<분기>.json` 에 담아 둡니다 —
같은 분기를 두 번 받지 않으려는 것입니다 (무료 등급은 한 달 호출 수가 정해져 있습니다).

★ 이 원문을 그대로 옮겨 올리지 마십시오. 받아 적은 곳의 저작물입니다.
  **읽고 우리 말로 요약**하는 데만 씁니다 (지시문/컨퍼런스콜.md 참고).
"""
import datetime as dt
import json
import pathlib
import re
import subprocess
import sys
import urllib.error
import urllib.request

뿌리 = pathlib.Path(__file__).resolve().parent
서비스 = "tm26-apininjas"
계정칸 = "apininjas"
주소 = "https://api.api-ninjas.com/v1/earningstranscript"


def _as글(s): return json.dumps(s, ensure_ascii=False)


def 키읽기() -> str:
    try:
        r = subprocess.run(["security", "find-generic-password",
                            "-s", 서비스, "-a", 계정칸, "-w"],
                           capture_output=True, text=True, timeout=20)
        return r.stdout.strip() if r.returncode == 0 else ""
    except Exception:
        return ""


def 키넣기() -> int:
    본 = ('tell application "System Events"\n  activate\n'
          f'  display dialog {_as글("api-ninjas.com 에서 받은 API 키를 붙여 넣어 주세요.")} '
          f'with title {_as글("컨퍼런스콜 API 키")} default answer "" '
          'buttons {"취소","확인"} default button "확인"\nend tell')
    r = subprocess.run(["osascript", "-e", 본], capture_output=True, text=True)
    if r.returncode != 0:
        print("취소했습니다."); return 1
    m = re.search(r"text returned:(.*)$", r.stdout.strip())
    키 = (m.group(1).strip() if m else "")
    if not 키:
        print("빈 값이라 넣지 않았습니다."); return 1
    p = subprocess.run(["security", "add-generic-password", "-U",
                        "-s", 서비스, "-a", 계정칸,
                        "-l", "TM26 컨퍼런스콜(API Ninjas)", "-w", 키],
                       capture_output=True, text=True)
    if p.returncode != 0:
        print("키체인에 넣지 못했습니다:", p.stderr.strip()[:200]); return 1
    print(f"넣었습니다 (앞 4글자 {키[:4]}…). 이제 컨퍼런스콜 요약이 스크립트를 읽습니다.")
    return 0


def 받기(티커: str, 연도: int, 분기: int, 키: str):
    """(글, 까닭). 없으면 글이 빈 글자."""
    u = f"{주소}?ticker={티커}&year={연도}&quarter={분기}"
    요청 = urllib.request.Request(u, headers={"X-Api-Key": 키})
    try:
        with urllib.request.urlopen(요청, timeout=60) as r:
            d = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        몸 = e.read().decode("utf-8", "ignore")[:160]
        if e.code == 429:
            return None, "이 달 호출 수를 다 썼습니다 (무료 등급 한도)"
        if e.code in (401, 400):
            return None, f"키 문제입니다 — {몸}"
        return None, f"HTTP {e.code} {몸}"
    except Exception as e:
        return None, str(e)[:120]
    if not d or not str(d.get("transcript") or "").strip():
        return None, "그 분기 스크립트가 없습니다"
    return d, ""


def main() -> int:
    인자 = [a for a in sys.argv[1:] if not a.startswith("--")]
    if "--계정" in sys.argv:
        return 키넣기()

    키 = 키읽기()
    if "--확인" in sys.argv:
        if not 키:
            print("키가 없습니다. python3 컨퍼런스콜받기.py --계정 으로 넣으십시오."); return 2
        d, 까닭 = 받기("AAPL", dt.date.today().year - 1, 1, 키)
        print("키가 살아 있습니다." if d else f"키로 받지 못했습니다: {까닭}")
        return 0 if d else 1

    if not 인자:
        print(__doc__); return 2
    if not 키:
        print("API 키가 없습니다. TM26 메뉴의 「컨퍼런스콜 API 키 넣기」 를 먼저 하시거나"
              " python3 컨퍼런스콜받기.py --계정 을 돌리십시오."); return 2

    티커 = 인자[0].upper()
    캐시 = 뿌리 / "캐시"
    캐시.mkdir(parents=True, exist_ok=True)

    if len(인자) >= 3:
        후보 = [(int(인자[1]), int(인자[2]))]
    else:
        # 최근 분기부터 거슬러 여섯 번 찾아봅니다 (회계연도가 어긋나는 회사가 많습니다)
        오늘 = dt.date.today()
        후보 = []
        y, q = 오늘.year, (오늘.month - 1) // 3 + 1
        for _ in range(6):
            후보.append((y, q))
            q -= 1
            if q == 0:
                q, y = 4, y - 1

    for 연도, 분기 in 후보:
        담을곳 = 캐시 / f"콜_{티커}_{연도}Q{분기}.json"
        if 담을곳.exists():
            d = json.loads(담을곳.read_text(encoding="utf-8"))
            print(f"이미 받아 둔 것입니다 — {담을곳}")
            print(f"  {티커} {연도}Q{분기} · {len(d.get('transcript','')):,}자"
                  f" · 날짜 {d.get('date','?')}")
            return 0
        d, 까닭 = 받기(티커, 연도, 분기, 키)
        if d:
            담을곳.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
            print(f"받았습니다 — {담을곳}")
            print(f"  {티커} {연도}Q{분기} · {len(d.get('transcript','')):,}자"
                  f" · 날짜 {d.get('date','?')}")
            return 0
        if "호출 수" in 까닭 or "키 문제" in 까닭:
            print(까닭); return 1
    print(f"{티커} — 최근 여섯 분기 안에서 스크립트를 찾지 못했습니다.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
