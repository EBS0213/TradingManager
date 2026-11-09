#!/usr/bin/env python3
"""장전·장중·장마감·해외 브리핑을 **이 맥의 Claude Code 로** 씁니다. (2026-10-05 신설)

    python3 브리핑쓰기.py am|mid|close|pm

전에는 홈페이지 서버가 Anthropic API 로 썼는데, 그 크레딧이 떨어져 10/5 해외 브리핑이
숫자만 나열한 예비 틀로 나갔습니다. 이제는
  ① 사이트에서 재료와 지시문을 받고 (/api/brief?run=X&prepare=1)
  ② 여기서 claude -p 로 쓰고
  ③ 사이트에 저장만 시킵니다 (POST /api/brief?run=X&save=1)
지시문·재료·휴장일 처리는 사이트(lib/newsbrief.js) 것을 그대로 씁니다 — 규칙을 바꿀 때도 거기만 고칩니다.
"""
from 로컬설정 import 사이트주소
import json
import datetime as dt
from zoneinfo import ZoneInfo
import os
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

SITE = 사이트주소()
from 코덱스실행 import run as codex_run
MODEL = os.environ.get("CODEX_BRIEF_MODEL", "gpt-6.1-sol")     # 2026-10-05 사용자 지시 — Opus 5.5 로 씁니다


def 열쇠() -> str:
    from 올리기 import 키찾기
    return 키찾기()


def 부르기(경로: str, 몸=None, timeout=290) -> dict:
    요청 = urllib.request.Request(SITE + 경로, data=None if 몸 is None else json.dumps(몸).encode(),
                                 headers={"x-screener-key": 열쇠(), "content-type": "application/json"},
                                 method="POST" if 몸 is not None else "GET")
    with urllib.request.urlopen(요청, timeout=timeout) as r:
        return json.loads(r.read().decode())


def claude찾기() -> str:
    for c in (os.environ.get("CLAUDE", ""), str(Path.home() / ".local/bin/claude"),
              "/opt/homebrew/bin/claude", "/usr/local/bin/claude"):
        if c and os.path.exists(c):
            return c
    raise SystemExit("claude 를 찾지 못했습니다")


def 다듬기(글: str) -> str:
    글 = re.sub(r"^```[a-z]*\s*|\s*```$", "", 글.strip())
    i = 글.find("<b>")                       # 본문은 <b>소제목</b> 으로 시작합니다. 앞의 군말은 버립니다
    return 글[i:].strip() if i > 0 else 글


def main():
    슬롯 = sys.argv[1] if len(sys.argv) > 1 else ""
    if 슬롯 not in ("am", "mid", "close", "pm"):
        raise SystemExit("사용법: 브리핑쓰기.py am|mid|close|pm")
    오늘 = dt.datetime.now(ZoneInfo('Asia/Seoul')).date().isoformat()
    기존 = 부르기('/api/brief')
    if any(x.get('day') == 오늘 and x.get('slot') == 슬롯 and x.get('writer') == 'ai'
           for x in 기존.get('items', [])):
        print(f'{오늘} {슬롯}: 이미 저장되어 있습니다')
        return
    준비 = 부르기(f"/api/brief?run={슬롯}&prepare=1")
    if not 준비.get("ok"):
        raise SystemExit(f"재료를 받지 못했습니다: {준비.get('error')}")
    수집시각 = dt.datetime.now(ZoneInfo('Asia/Seoul')).strftime('%Y-%m-%d %H:%M KST')
    시점주의 = (f'\n실제 자료 수집 시각은 {수집시각}입니다. 예약 회차명은 관측시각이 아닙니다. '
                '지연 작성 시 현재 수치를 정오·예약시각의 수치라고 쓰지 마십시오. '
                '본문 첫머리에 실제 자료 수집 시각을 밝히십시오.\n')
    지시 = (시점주의 + 준비["system"] + "\n\n" + 준비["prompt"]
            + "\n\n---\n출력 규칙: 브리핑 본문만 출력하십시오. 머리말·설명·코드블록 없이 "
              "<b>소제목</b> 으로 시작하는 본문만 씁니다. 도구는 쓰지 마십시오.")
    r = codex_run(지시, role="analysis", model=MODEL, timeout=900)
    if r.returncode == 75:
        print("Codex 사용량 한도 — 제작과 발송을 멈춥니다")
        sys.exit(75)
    if r.returncode == 78:
        print("선택한 AI의 본인 계정 로그인이 필요합니다")
        sys.exit(78)
    if r.returncode:
        raise SystemExit(f"Codex 작성 실패({r.returncode}): {r.stderr[-300:]}")

    # 사용량이 바닥났거나 거의 다 쓴 신호가 보이면 **그 즉시 멈춥니다** (2026-10-05 사용자 지시).
    #  사이트에도 저장하지 않고, 채널에도 보내지 않고, 실패 알림도 내지 않습니다 — 종료코드 75 로 알립니다.
    #  Claude Code 는 남은 %를 숫자로 알려 주지 않으므로 한도 도달·임박 문구로 판단합니다.
    #  본문에 「외국인 보유 한도에 도달」 같은 문장이 있을 수 있어, 본문은 글이 제대로 안 나왔을 때만 봅니다.
    전부 = (r.stderr or "") + ("\n" + (r.stdout or "") if r.returncode != 0 or len((r.stdout or "").strip()) < 400 else "")
    if re.search(r"usage limit|limit reached|hit your (?:usage |session )?limit|session limit|rate.?limit"
                 r"|out of (?:usage|credits)|approaching (?:your )?(?:usage )?limit|resets? (?:at|in) \d"
                 r"|사용량 한도|한도에 (?:도달|가까)", 전부, re.I):
        print(f"{준비['day']} {슬롯}: Claude 사용량 한도 신호 — 제작과 발송을 멈춥니다")
        sys.exit(75)
    글 = 다듬기(r.stdout)
    if len(글) < 400:
        raise SystemExit(f"글이 비었거나 너무 짧습니다 ({len(글)}자): {r.stderr[-300:]}")
    if dt.datetime.now(ZoneInfo('Asia/Seoul')).date().isoformat() != 준비['day']:
        raise SystemExit('작성 중 날짜가 바뀌어 저장하지 않습니다')
    결과 = 부르기(f"/api/brief?run={슬롯}&save=1", {"text": 글})
    if not 결과.get("ok") or 결과.get("saved") is not True:
        raise SystemExit(f"저장하지 못했습니다: {결과.get('error')}")
    print(f"{준비['day']} {슬롯} 브리핑을 이 맥에서 썼습니다 ({len(글)}자, {MODEL})")


if __name__ == "__main__":
    main()
