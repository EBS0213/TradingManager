#!/usr/bin/env python3
"""홈페이지 「내 기록」을 맥으로 받아 온다.

  python3 내기록받기.py                오늘 기록을 매매로그/ 에 저장하고 요약을 찍는다
  python3 내기록받기.py --워치 미국     워치리스트의 미국 종목을 "코드,이름" 으로 찍는다
  python3 내기록받기.py --워치 한국     한국 종목
  python3 내기록받기.py --워치 전체     전부
  python3 내기록받기.py --기록 2026-09-05   그날 전략·심리 기록만 찍는다

받아 오는 것 — 매매기록(log) · 보유(holdings) · 워치리스트 · 현금 · 베팅설정
              · 전략·심리 기록(mind) — 홈페이지 「내 기록 → 전략·심리」 탭에 날마다 적는 것
저장하는 곳 — 매매로그/사이트기록_<날짜>.json  (원본 그대로)
              매매로그/사이트기록_<날짜>.md    (사람이 읽는 요약)

한국 종목과 미국 종목은 **코드 모양**으로 가릅니다 — 여섯 자리 숫자면 한국,
알파벳이 섞여 있으면 미국. 보유 목록의 market('국내'/'해외') 도 함께 봅니다.
"""
import datetime as dt
import json
import os
import pathlib
import re
import sys
import urllib.error
import urllib.request

뿌리 = pathlib.Path(__file__).resolve().parent
사이트 = os.environ.get("TM26_URL", "http://127.0.0.1:8766").rstrip("/")

# 홈페이지 「내 기록 → 전략·심리」 탭의 네 물음. 화면(app.html 의 MIND_Q)과 같은 이름을 씁니다.
#  화면에서 물음을 더하거나 고치면 여기도 함께 고쳐야 요약에 제대로 나옵니다.
마음질문 = [
    ("plan", "1. 오늘 매매에 전략 수립이 되었나. 전략 내용은?"),
    ("mistake", "2. 오늘 가장 하기 쉬운 실수는 무엇으로 생각되는가. 그리고 오늘 그 실수를 했나?"),
    ("mood", "3. 오늘 심리상태"),
    ("watch", "4. 오늘의 관심종목은? (이슈, 피벗 정리)"),
]


def 키찾기():
    k = os.environ.get("SCREENER_KEY", "").strip()
    if k:
        return k
    env = 뿌리 / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8", errors="ignore").splitlines():
            if line.strip().startswith("SCREENER_KEY"):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    p = pathlib.Path.home() / ".tm26_key"
    if p.exists():
        return p.read_text(encoding="utf-8").strip()
    return ""


def 받아오기() -> dict:
    키 = 키찾기()
    if not 키 or len(키) < 20:
        raise SystemExit("SCREENER_KEY 를 찾지 못했습니다 (~/.tm26_key).")
    요청 = urllib.request.Request(사이트 + "/api/screener/journal",
                                headers={"x-screener-key": 키})
    try:
        with urllib.request.urlopen(요청, timeout=60) as r:
            답 = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise SystemExit(f"내 기록을 못 읽었습니다 (HTTP {e.code}).")
    if not 답.get("ok"):
        raise SystemExit("내 기록을 못 읽었습니다: " + str(답.get("error")))
    return 답


def 한국인가(코드: str) -> bool:
    return bool(re.fullmatch(r"\d{6}", str(코드 or "").strip()))


def 워치찍기(어느: str, 자료: dict) -> int:
    본 = (자료.get("data") or {}).get("watchlist") or []
    for x in 본:
        코드 = str(x.get("코드") or x.get("code") or "").strip()
        이름 = str(x.get("종목명") or x.get("name") or "").strip()
        if not 코드:
            continue
        국내 = 한국인가(코드)
        if 어느 == "한국" and not 국내:
            continue
        if 어느 == "미국" and 국내:
            continue
        print(f"{코드},{이름}")
    return 0


def 요약글(자료: dict, 날짜: str) -> str:
    d = 자료.get("data") or {}
    로그 = d.get("log") or []
    보유 = d.get("holdings") or []
    관심 = d.get("watchlist") or []
    베팅 = d.get("bet") or {}

    오늘것 = [x for x in 로그 if str(x.get("date") or "")[:10] == 날짜]
    줄 = [f"# 내 기록 — {날짜}", "",
          f"홈페이지에서 받아 온 것입니다 (받은 때 {dt.datetime.now():%Y-%m-%d %H:%M}).", ""]

    줄 += [f"## 오늘 매매 {len(오늘것)}건", ""]
    if 오늘것:
        줄 += ["| 종목 | 코드 | 매수 | 매도 | 수량 | 규칙 | 메모 |",
              "|---|---|---|---|---|---|---|"]
        for x in 오늘것:
            줄.append("| {} | {} | {} | {} | {} | {} | {} |".format(
                x.get("name", ""), x.get("code", ""), x.get("buy", ""), x.get("sell", ""),
                x.get("qty", ""), x.get("rule", ""), str(x.get("memo", "")).replace("|", "/")))
    else:
        줄 += ["오늘 적힌 매매가 없습니다.", ""]

    마음 = (d.get("mind") or {}).get(날짜) or {}
    줄 += ["", "## 그날 전략·심리 기록", ""]
    if isinstance(마음, str):
        # 예전에 글 한 덩어리로 적어 둔 날
        줄 += (["```", 마음.strip(), "```"] if 마음.strip() else ["(적어 두신 것이 없습니다)"])
    elif 마음:
        적은게있나 = False
        for 열쇠, 물음 in 마음질문:
            글 = str(마음.get(열쇠) or "").strip()
            줄 += [f"**{물음}**", ""]
            줄 += ([글, ""] if 글 else ["(안 적으셨습니다)", ""])
            적은게있나 = 적은게있나 or bool(글)
        if not 적은게있나:
            줄 += ["(네 칸 모두 비어 있습니다 — 계획 대조 항목은 비워 두십시오)"]
    else:
        줄 += ["(적어 두신 것이 없습니다 — 계획 대조 항목은 비워 두십시오)"]

    줄 += ["", f"## 보유 {len(보유)}종목", ""]
    if 보유:
        줄 += ["| 종목 | 코드 | 시장 | 평단 | 현재 | 수량 | 산 까닭 |",
              "|---|---|---|---|---|---|---|"]
        for x in 보유:
            줄.append("| {} | {} | {} | {} | {} | {} | {} |".format(
                x.get("name", ""), x.get("code", ""), x.get("market", ""),
                x.get("avg", ""), x.get("price", ""), x.get("qty", ""),
                str(x.get("why", "")).replace("|", "/")[:80]))

    줄 += ["", f"## 워치리스트 {len(관심)}종목", ""]
    한, 미 = [], []
    for x in 관심:
        코드 = str(x.get("코드") or x.get("code") or "")
        이름 = str(x.get("종목명") or x.get("name") or "")
        (한 if 한국인가(코드) else 미).append(f"{이름}({코드})")
    줄 += [f"· 한국 {len(한)} — " + ", ".join(한), "", f"· 미국 {len(미)} — " + ", ".join(미)]

    if 베팅:
        줄 += ["", "## 베팅 설정", "",
              "```json", json.dumps(베팅, ensure_ascii=False, indent=1), "```"]
    if d.get("cash") is not None:
        줄 += ["", f"현금: {d.get('cash')}"]

    # 지난 이레 매매도 함께 — 오늘 매매를 흐름 속에서 보게
    최근 = [x for x in 로그
          if 날짜 >= str(x.get("date") or "")[:10] >
          (dt.date.fromisoformat(날짜) - dt.timedelta(days=7)).isoformat()]
    줄 += ["", f"## 지난 이레 매매 {len(최근)}건", "", "```json",
          json.dumps(최근, ensure_ascii=False, indent=1)[:12000], "```"]
    return "\n".join(줄) + "\n"


def main() -> int:
    인자 = sys.argv[1:]
    if "--기록" in 인자:
        i = 인자.index("--기록")
        날 = 인자[i + 1] if i + 1 < len(인자) else dt.date.today().isoformat()
        마음 = ((받아오기().get("data") or {}).get("mind") or {}).get(날) or {}
        if isinstance(마음, str):
            print(마음.rstrip())
        else:
            for 열쇠, 물음 in 마음질문:
                글 = str(마음.get(열쇠) or "").strip()
                print(f"{물음}\n{글 or '(안 적으셨습니다)'}\n")
        return 0

    if "--워치" in 인자:
        i = 인자.index("--워치")
        어느 = 인자[i + 1] if i + 1 < len(인자) else "전체"
        return 워치찍기(어느, 받아오기())

    날짜 = next((a for a in 인자 if re.fullmatch(r"20\d\d-\d\d-\d\d", a)),
              dt.date.today().isoformat())
    자료 = 받아오기()
    폴더 = 뿌리 / "매매로그"
    폴더.mkdir(parents=True, exist_ok=True)
    (폴더 / f"사이트기록_{날짜}.json").write_text(
        json.dumps(자료.get("data") or {}, ensure_ascii=False, indent=1), encoding="utf-8")
    글 = 요약글(자료, 날짜)
    (폴더 / f"사이트기록_{날짜}.md").write_text(글, encoding="utf-8")

    d = 자료.get("data") or {}
    오늘것 = [x for x in (d.get("log") or []) if str(x.get("date") or "")[:10] == 날짜]
    print(f"받았습니다 — 매매로그/사이트기록_{날짜}.md")
    그날마음 = (d.get("mind") or {}).get(날짜) or {}
    적은칸 = (1 if isinstance(그날마음, str) and 그날마음.strip()
            else sum(1 for k, _ in 마음질문 if str((그날마음 or {}).get(k) or "").strip())
            if isinstance(그날마음, dict) else 0)
    마음있나 = f"{적은칸}/{len(마음질문)}칸" if 적은칸 else "없음"
    print(f"  오늘 매매 {len(오늘것)}건 · 보유 {len(d.get('holdings') or [])}종목 "
          f"· 워치리스트 {len(d.get('watchlist') or [])}종목 · 전략·심리 기록 {마음있나}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
