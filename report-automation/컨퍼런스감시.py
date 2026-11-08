#!/usr/bin/env python3
"""새로 나온 미국 실적 발표(컨퍼런스콜)를 찾아 대기열에 쌓는다. (2026-09-14 신설)

    "$PY3" 컨퍼런스감시.py --새것         새 발표를 찾아 대기열에 적고, 새것만 찍는다
    "$PY3" 컨퍼런스감시.py --목록         지금 대기열을 보여 준다
    "$PY3" 컨퍼런스감시.py --적기 NVDA…   그 종목을 처리했다고 표시한다 (대기열에서 뺀다)
    "$PY3" 컨퍼런스감시.py --새것 --날수 30

왜 필요한가
    컨퍼런스콜 요약 대상이 워치리스트·보유 종목뿐이었다. 시총 상위 기업의 실적 발표는
    업종 전체의 방향을 정하므로 우리 계좌에 없어도 읽어야 한다 (2026-09-14 사용자 지시).
    사람이 실적 일정을 좇을 수는 없으니, **공시가 올라온 것을 보고** 대기열에 쌓는다.

무엇을 새 발표로 보는가
    SEC 8-K 가운데 **항목 2.02(Results of Operations and Financial Condition)** 가 달린 것.
    실적 보도자료(EX-99.1)가 붙는 공시가 이것이고, 컨퍼런스콜은 같은 날 열린다.
    한국 기업은 이 방식이 통하지 않는다 — 콜 스크립트도 공시도 형식이 다르다.
    (국내는 DART 실적공시를 봐야 하며 이 파일에서 다루지 않는다.)

대상
    ① `캐시/미국시총상위.json` 의 상위 100 (없으면 도구/미국시총상위.py --만들기)
    ② `관심종목/watchlist.csv` 의 미국 종목 — 계좌에 있는 것은 언제나 먼저다.

파일
    대기열 `컨퍼런스대기.txt`     티커,회사,발표일,공시주소   (사람도 읽는다)
    기록   `캐시/컨퍼런스상태.json`  종목별로 어디까지 다뤘는지
"""
from __future__ import annotations

import csv
import json
import pathlib
import re
import sys
import unicodedata
from datetime import date, timedelta

뿌리 = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(뿌리))

상위목록 = 뿌리 / "캐시" / "미국시총상위.json"
워치파일 = 뿌리 / "관심종목" / "watchlist.csv"
상태파일 = 뿌리 / "캐시" / "컨퍼런스상태.json"
대기열 = 뿌리 / "컨퍼런스대기.txt"


def _사용자표시() -> str:
    import os
    if os.environ.get('SEC_USER_AGENT'): return os.environ['SEC_USER_AGENT']
    본문 = (뿌리 / "config.yaml").read_text(encoding="utf-8", errors="ignore")
    m = re.search(r"sec_user_agent:\s*[\"']?([^\"'\n]+)", 본문)
    if not m:
        raise SystemExit("config.yaml 에 sec_user_agent 가 없습니다. SEC 는 연락처를 요구합니다.")
    return m.group(1).strip()


def 해외인가(코드: str) -> bool:
    코드 = (코드 or "").strip()
    return bool(코드) and not (len(코드) == 6 and 코드.isdigit())


def 대상() -> list[tuple[str, str, str]]:
    """[(티커, 이름, 갈래)] — 워치리스트가 앞, 그다음 시총 상위."""
    나온것: dict[str, tuple[str, str]] = {}

    if 워치파일.exists():
        본문 = 워치파일.read_text(encoding="utf-8-sig", errors="ignore")
        for 줄 in csv.DictReader(본문.splitlines()):
            코드 = unicodedata.normalize("NFC", (줄.get("코드") or "").strip())
            if 해외인가(코드):
                나온것[코드.upper()] = ((줄.get("종목명") or 코드).strip(), "워치리스트")

    if 상위목록.exists():
        d = json.loads(상위목록.read_text(encoding="utf-8"))
        for r in d.get("종목", []):
            t = str(r.get("티커", "")).upper()
            if t and t not in 나온것:
                나온것[t] = (r.get("이름") or t, f"시총 {r.get('순위') or '—'}위")
    else:
        print("  (캐시/미국시총상위.json 이 없습니다 — 도구/미국시총상위.py --만들기 를 먼저 하십시오)",
              file=sys.stderr)

    return [(t, 이름, 갈래) for t, (이름, 갈래) in 나온것.items()]


def 상태읽기() -> dict:
    if 상태파일.exists():
        try:
            return json.loads(상태파일.read_text(encoding="utf-8"))
        except Exception:                          # noqa: BLE001
            pass
    return {}


def 상태쓰기(d: dict) -> None:
    상태파일.parent.mkdir(parents=True, exist_ok=True)
    상태파일.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")


def 실적공시(ec, 티커: str, 날수: int) -> dict | None:
    """그 종목의 가장 최근 실적 발표 8-K. 없으면 None."""
    자른날 = (date.today() - timedelta(days=날수)).isoformat()
    try:
        prof = ec.profile(ec.cik(티커))
    except Exception:                              # noqa: BLE001
        return None
    for f in prof.get("filings") or []:
        if f.get("form") != "8-K":
            continue
        if "2.02" not in str(f.get("items") or ""):
            continue
        if str(f.get("filed") or "") < 자른날:
            break                                  # 최신순이므로 더 볼 것 없다
        return {"발표일": f.get("filed"), "공시": f.get("accn"),
                "주소": f.get("url"), "기간": f.get("period")}
    return None


def 대기열쓰기(줄들: list[str]) -> None:
    머리 = ("# 컨퍼런스콜 대기열 — 컨퍼런스감시.py 가 적습니다. 손으로 고치지 마십시오.\n"
            "# 티커,회사,발표일,공시주소\n")
    대기열.write_text(머리 + "".join(줄들), encoding="utf-8")


def 대기열읽기() -> list[str]:
    if not 대기열.exists():
        return []
    return [l for l in 대기열.read_text(encoding="utf-8").splitlines()
            if l.strip() and not l.startswith("#")]


def 새것찾기(날수: int = 90, 조용히: bool = False) -> list[dict]:
    from src.edgar import EdgarClient
    ec = EdgarClient(_사용자표시(), 뿌리 / "캐시")
    종목들 = 대상()
    상태 = 상태읽기()
    새것: list[dict] = []

    if not 조용히:
        print(f"  {len(종목들)}곳을 봅니다 (최근 {날수}일 안의 실적 발표 8-K).", flush=True)
    for n, (티커, 이름, 갈래) in enumerate(종목들, 1):
        공시 = 실적공시(ec, 티커, 날수)
        if not 공시:
            continue
        앞 = 상태.get(티커) or {}
        if 앞.get("공시") == 공시["공시"]:
            continue                               # 이미 다뤘거나 이미 대기열에 있다
        새것.append({"티커": 티커, "이름": 이름, "갈래": 갈래, **공시})
        if not 조용히 and n % 25 == 0:
            print(f"    {n}/{len(종목들)}", flush=True)

    # 대기열은 '처리 안 된 것' 만 담는다. 새로 찾은 것을 기존 대기열에 합친다.
    이미 = {l.split(",")[0] for l in 대기열읽기()}
    줄들 = [l + "\n" for l in 대기열읽기()]
    for r in sorted(새것, key=lambda r: r["발표일"], reverse=True):
        if r["티커"] in 이미:
            continue
        줄들.append(f"{r['티커']},{r['이름']},{r['발표일']},{r['주소']}\n")
    대기열쓰기(줄들)

    # 찾았다는 사실은 바로 기록한다 — 같은 발표를 두 번 큐에 넣지 않기 위해서다.
    for r in 새것:
        상태[r["티커"]] = {"공시": r["공시"], "발표일": r["발표일"], "상태": "대기"}
    상태쓰기(상태)
    return 새것


def main() -> int:
    인자 = sys.argv[1:]
    날수 = 90
    if "--날수" in 인자:
        날수 = int(인자[인자.index("--날수") + 1])

    if "--적기" in 인자:
        티커들 = [a.upper() for a in 인자[인자.index("--적기") + 1:] if not a.startswith("--")]
        if not 티커들:
            print("어느 종목을 적을지 알려 주십시오: --적기 NVDA MSFT"); return 2
        상태 = 상태읽기()
        남길것 = []
        for l in 대기열읽기():
            if l.split(",")[0].upper() not in 티커들:
                남길것.append(l + "\n")
        대기열쓰기(남길것)
        for t in 티커들:
            상태.setdefault(t, {})["상태"] = "끝"
            상태[t]["끝낸날"] = date.today().isoformat()
        상태쓰기(상태)
        print(f"  {len(티커들)}곳을 처리 완료로 적었습니다. 대기열 {len(남길것)}건 남음.")
        return 0

    if "--목록" in 인자:
        줄들 = 대기열읽기()
        if not 줄들:
            print("대기열이 비어 있습니다."); return 0
        print(f"대기열 {len(줄들)}건 (발표일 최신순)")
        for l in 줄들:
            칸 = l.split(",")
            print(f"  {칸[0]:<6} {칸[2] if len(칸) > 2 else '':<12} {칸[1] if len(칸) > 1 else ''}")
        return 0

    if "--새것" in 인자:
        새것 = 새것찾기(날수)
        if not 새것:
            print("새 실적 발표가 없습니다.")
            return 0
        print(f"\n새 실적 발표 {len(새것)}건:")
        for r in sorted(새것, key=lambda r: r["발표일"], reverse=True):
            print(f"  {r['발표일']}  {r['티커']:<6} {r['갈래']:<10} {r['이름']}")
        print(f"\n대기열: {대기열}")
        return 0

    print(__doc__)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
