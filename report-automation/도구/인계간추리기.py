#!/usr/bin/env python3
"""인계 파일에서 **머리말과 최신 회차만** 뽑는다. (2026-09-16 신설)

    "$PY3" 도구/인계간추리기.py <인계파일>

왜 필요한가 — 2026-09-16 실측
    `수정반영.sh` 가 인계 파일을 **통째로** 프롬프트에 넣고 있었다. 그런데 이 파일은
    회차마다 불어난다. RF머트리얼즈가 20,522자(1판) → 39,432자(2회차 뒤), 현대건설은
    42,594자였다. 지난 회차의 요청과 반영 내역이 매번 다시 실리는 셈이다.
    3회차면 6만자가 프롬프트에 그대로 들어간다.

    머리말(상태·경로·기준일)과 **가장 최근 Codex 요청**만 넣으면 대개 3분의 1 아래로
    줄어든다. 지난 회차가 필요하면 세션이 파일을 직접 열면 된다 — 그 경로를 끝에 적어 준다.
"""
import pathlib
import re
import sys

표지 = "## Codex 수정 요청"


def main() -> int:
    if len(sys.argv) < 2:
        print("인계 파일을 알려 주십시오.", file=sys.stderr)
        return 2
    p = pathlib.Path(sys.argv[1])
    s = p.read_text(encoding="utf-8")

    자리 = [m.start() for m in re.finditer(rf"^{re.escape(표지)}", s, re.M)]
    if not 자리:
        print(s, end="")                      # 아직 요청이 없으면 그대로
        return 0

    머리 = s[:자리[0]].rstrip()
    최신 = s[자리[-1]:].rstrip()
    뺀회차 = len(자리) - 1

    print(머리)
    if 뺀회차 > 0:
        print(f"\n> **지난 회차 {뺀회차}건은 이 프롬프트에서 뺐습니다** (토큰을 아끼려는 것입니다).")
        print(f"> 지난 요청·반영 내역이 필요하면 `{p}` 를 직접 여십시오.")
        print("> 이번에 답할 것은 **아래 최신 요청 하나**입니다.\n")
    print(최신)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
