#!/usr/bin/env python3
"""보고서 HTML 에서 **한 절만** 꺼내고 되돌려 넣는다. (2026-09-16 신설)

    "$PY3" 도구/절.py 목록 <보고서.html>
    "$PY3" 도구/절.py 꺼내기 <보고서.html> <절번호> [> 작업파일]
    "$PY3" 도구/절.py 넣기   <보고서.html> <절번호> <고친파일>

왜 필요한가 — 2026-09-16 실측
    RF머트리얼즈 보고서 HTML 은 735,282자인데 그 가운데 **87.3%가 차트 SVG**다.
    matplotlib 이 벡터 좌표를 통째로 박아 넣기 때문이다. 사람이 고치는 글은 78,131자,
    전체의 10.6%뿐이다. 그런데 수정 세션은 절 하나를 고치려고 73만자를 통째로 읽었다.
    여기에 회차마다 반복되니 토큰이 열 배로 샜다.

    이 도구는 **SVG 를 자리표시자로 바꿔** 꺼낸다. 되돌려 넣을 때 원래 SVG 를 그대로
    복원하므로 차트는 손실되지 않는다. 절 하나가 보통 5,000~20,000자로 줄어든다.

규칙
    · 절 경계는 `<h2>` 다. `목록` 으로 번호와 크기를 먼저 본다.
    · 꺼낸 글 안의 `⟦그림N⟧` 표시는 **지우거나 옮기지 마십시오.** 그 자리에 차트가 돌아온다.
    · `넣기` 는 원본을 `<보고서>.bak_<시각>` 으로 백업한 뒤 제자리에 쓴다.
"""
from __future__ import annotations

import pathlib
import re
import sys
from datetime import datetime

표시 = "⟦그림{}⟧"
찾기 = re.compile(r"<svg.*?</svg>", re.S)


def 절나누기(s: str) -> list[tuple[str, int, int]]:
    """[(제목, 시작, 끝)]. 첫 <h2> 앞은 「머리」로 0번."""
    자리 = [m.start() for m in re.finditer(r"<h2[^>]*>", s)]
    제목 = [re.sub(r"<[^>]+>", "", m.group(1)).strip()
           for m in re.finditer(r"<h2[^>]*>(.*?)</h2>", s, re.S)]
    칸 = [("머리(표지·요약)", 0, 자리[0] if 자리 else len(s))]
    for i, 시 in enumerate(자리):
        끝 = 자리[i + 1] if i + 1 < len(자리) else len(s)
        칸.append((제목[i] if i < len(제목) else f"h2 {i+1}", 시, 끝))
    return 칸


def 목록(경로: pathlib.Path) -> int:
    s = 경로.read_text(encoding="utf-8")
    칸 = 절나누기(s)
    print(f"{경로.name} · 전체 {len(s):,}자")
    print(f"{'번호':>4} {'글자':>9} {'SVG뺀글자':>10}  제목")
    for i, (제목, a, b) in enumerate(칸):
        덩이 = s[a:b]
        민글 = 찾기.sub("", 덩이)
        print(f"{i:>4} {len(덩이):>9,} {len(민글):>10,}  {제목[:46]}")
    return 0


def 꺼내기(경로: pathlib.Path, 번호: int) -> int:
    s = 경로.read_text(encoding="utf-8")
    칸 = 절나누기(s)
    if not 0 <= 번호 < len(칸):
        print(f"절 번호는 0~{len(칸)-1} 입니다. `목록` 으로 확인하십시오.", file=sys.stderr)
        return 2
    제목, a, b = 칸[번호]
    덩이 = s[a:b]
    n = 0

    def 바꾸기(m):
        nonlocal n
        n += 1
        return 표시.format(n)

    민글 = 찾기.sub(바꾸기, 덩이)
    print(f"<!-- 절 {번호} · {제목} · 원본 {len(덩이):,}자 → {len(민글):,}자 · "
          f"그림 {n}장은 ⟦그림N⟧ 으로 접었습니다. 그 표시를 지우지 마십시오. -->")
    print(민글, end="")
    return 0


def 넣기(경로: pathlib.Path, 번호: int, 새파일: pathlib.Path) -> int:
    s = 경로.read_text(encoding="utf-8")
    칸 = 절나누기(s)
    if not 0 <= 번호 < len(칸):
        print(f"절 번호는 0~{len(칸)-1} 입니다.", file=sys.stderr)
        return 2
    제목, a, b = 칸[번호]
    원래그림 = 찾기.findall(s[a:b])
    새글 = 새파일.read_text(encoding="utf-8")
    새글 = re.sub(r"^<!--.*?-->\n", "", 새글, count=1, flags=re.S)   # 꺼낼 때 붙인 머리말 제거

    쓴것 = sorted(int(m.group(1)) for m in re.finditer(r"⟦그림(\d+)⟧", 새글))
    if 쓴것 != list(range(1, len(원래그림) + 1)):
        print(f"✗ 그림 표시가 맞지 않습니다. 원본 {len(원래그림)}장인데 글에는 {쓴것} 입니다.\n"
              f"  ⟦그림N⟧ 을 지웠거나 번호가 바뀌었습니다. 되돌려 놓고 다시 하십시오.",
              file=sys.stderr)
        return 1

    def 되돌리기(m):
        return 원래그림[int(m.group(1)) - 1]

    복원 = re.sub(r"⟦그림(\d+)⟧", 되돌리기, 새글)
    백업 = 경로.with_suffix(f".bak_{datetime.now():%m%d_%H%M%S}.html")
    백업.write_text(s, encoding="utf-8")
    경로.write_text(s[:a] + 복원 + s[b:], encoding="utf-8")
    print(f"✓ 절 {번호}({제목}) 을 바꿨습니다. {len(s):,}자 → "
          f"{len(s[:a] + 복원 + s[b:]):,}자 · 그림 {len(원래그림)}장 복원 · 백업 {백업.name}")
    return 0


def main() -> int:
    인자 = sys.argv[1:]
    if len(인자) < 2:
        print(__doc__)
        return 0
    할일, 파일 = 인자[0], pathlib.Path(인자[1])
    if not 파일.exists():
        print(f"그런 파일이 없습니다: {파일}", file=sys.stderr)
        return 2
    if 할일 == "목록":
        return 목록(파일)
    if 할일 == "꺼내기" and len(인자) >= 3:
        return 꺼내기(파일, int(인자[2]))
    if 할일 == "넣기" and len(인자) >= 4:
        return 넣기(파일, int(인자[2]), pathlib.Path(인자[3]))
    print(__doc__)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
