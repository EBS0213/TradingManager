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
import json
import os
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

SITE = "http://127.0.0.1:8766"
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
    준비 = 부르기(f"/api/brief?run={슬롯}&prepare=1")
    if not 준비.get("ok"):
        raise SystemExit(f"재료를 받지 못했습니다: {준비.get('error')}")
    지시 = (준비["system"] + "\n\n" + 준비["prompt"]
            + "\n\n---\n출력 규칙: 브리핑 본문만 출력하십시오. 머리말·설명·코드블록 없이 "
              "<b>소제목</b> 으로 시작하는 본문만 씁니다. 도구는 쓰지 마십시오.")
    r = codex_run(지시, role="analysis", model=MODEL, timeout=900)
    if r.returncode == 75:
        print("Codex 사용량 한도 — 제작과 발송을 멈춥니다")
        sys.exit(75)
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
    결과 = 부르기(f"/api/brief?run={슬롯}&save=1", {"text": 글})
    if not 결과.get("ok"):
        raise SystemExit(f"저장하지 못했습니다: {결과.get('error')}")
    print(f"{준비['day']} {슬롯} 브리핑을 이 맥에서 썼습니다 ({len(글)}자, {MODEL})")


if __name__ == "__main__":
    main()
