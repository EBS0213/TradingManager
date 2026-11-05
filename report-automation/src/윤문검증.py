# -*- coding: utf-8 -*-
"""윤문검증 — AI 티 제거 윤문이 「문체만 고치고 내용은 그대로」였는지 실측한다.

    python3 src/윤문검증.py <윤문전.html> <윤문후.html>
    python3 src/윤문검증.py <윤문전.txt>  <윤문후.txt>    # .md 도 받는다

왜 필요한가
-----------
윤문은 LLM 이 한다. 문장을 다듬다 보면 숫자를 바꾸거나, 인용을 고치거나,
각주를 옮기거나, 표를 건드리는 일이 실제로 일어난다. 보고서는 숫자가 틀리면
그 자체로 폐기다. 그래서 윤문 전후를 기계로 대조해 **한 글자라도 사실이
바뀌었으면 막는다.** 통과하기 전에는 PDF 로 넘어가지 않는다.

무엇을 보는가
-------------
1) 표·차트 불변      <table>·<svg> 안의 글자는 단 한 글자도 달라지면 안 된다
2) 충실도 게이트     im-not-ai 의 checks.py — 수치 주입·인용 변조·각주 이탈·제목 소실
3) 원문 수치 보존    윤문 전에 있던 숫자가 윤문 후에 사라졌는지 (경고)
4) 변경률            너무 안 고쳤거나(무의미) 너무 고쳤는지(내용 훼손 위험)
5) AI 티 점수        metrics.py 위험 점수가 실제로 내려갔는지

판정: 1·2 는 게이트(실패하면 exit 1). 3·4·5 는 참고 수치로만 찍는다.
"""
from __future__ import annotations

import html as _html
import os
import re
import sys
from pathlib import Path

# im-not-ai 설치 위치 — 환경변수로 덮어쓸 수 있다.
IMNOTAI = Path(os.environ.get("IMNOTAI_HOME", Path.home() / "im-not-ai"))
_SCRIPTS = IMNOTAI / "scripts"
_REFS = IMNOTAI / "skills" / "humanize-korean" / "references"
for _p in (_SCRIPTS, _REFS):
    if _p.is_dir() and str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

try:
    from checks import run_checks, dropped_numbers  # type: ignore
except Exception as e:  # noqa: BLE001
    print(f"✗ im-not-ai 를 찾지 못했습니다: {IMNOTAI}\n  ({e})", file=sys.stderr)
    print("  git clone https://github.com/epoko77-ai/im-not-ai.git ~/im-not-ai", file=sys.stderr)
    sys.exit(2)

try:
    import metrics_v2 as _m2  # type: ignore
except Exception:  # noqa: BLE001
    _m2 = None


# ── 추출 ────────────────────────────────────────────────────────────────
def _텍스트(s: str) -> str:
    """태그를 걷고 공백을 고른다. 비교용 정규형."""
    s = re.sub(r"<[^>]+>", " ", s)
    s = _html.unescape(s)
    return re.sub(r"\s+", " ", s).strip()


def 고정영역(html: str) -> str:
    """윤문이 절대 건드리면 안 되는 곳 — 표와 도해 안의 글자."""
    조각 = re.findall(r"<table.*?</table>", html, flags=re.S)
    조각 += re.findall(r"<svg.*?</svg>", html, flags=re.S)
    return "\n".join(_텍스트(x) for x in 조각)


def 산문(html: str) -> str:
    """윤문 대상이 되는 산문 — 표·도해·스타일·스크립트를 뺀 본문."""
    h = re.sub(r"<svg.*?</svg>", " ", html, flags=re.S)
    h = re.sub(r"<style.*?</style>", " ", h, flags=re.S)
    h = re.sub(r"<script.*?</script>", " ", h, flags=re.S)
    h = re.sub(r"<table.*?</table>", " ", h, flags=re.S)
    덩어리 = re.findall(r"<(p|li|h[1-6])[^>]*>(.*?)</\1>", h, flags=re.S)
    줄 = [_텍스트(t) for _, t in 덩어리]
    return "\n\n".join(x for x in 줄 if x)


def 변경률(전: str, 후: str) -> float:
    import difflib
    return 1.0 - difflib.SequenceMatcher(None, 전, 후).ratio()


# 윤문이 실제로 먹혔는지 보는 축.
#  v1 의 risk_score 는 이 보고서들을 전부 「low」로 찍어서 쓸모가 없었다
#  (삼성전자 보고서 실측 1.0/low — 대구 48회짜리 글인데도). v2 축을 직접 본다.
_축 = [
    ("대구 A가 아니라 B", "antithesis_count",        "낮을수록"),
    ("종결 다양성",       "ending_diversity",         "높을수록"),
    ("같은 어미 3연속",   "da_streak_rate",           "낮을수록"),
    ("관형절 중첩",       "relative_clause_nesting",  "낮을수록"),
    ("어휘 다양성",       "lexical_diversity_ttr",    "높을수록"),
]


def _티지표(text: str) -> dict[str, float] | None:
    if _m2 is None:
        return None
    try:
        return _m2.compute_all_v2(text, genre="report").get("v2_metrics") or None
    except Exception:  # noqa: BLE001
        return None


# ── 판정 ────────────────────────────────────────────────────────────────
def _is_html(path: Path) -> bool:
    return path.suffix.lower() in (".html", ".htm")


def 검증(전_path: Path, 후_path: Path) -> int:
    전html = 전_path.read_text(encoding="utf-8", errors="ignore")
    후html = 후_path.read_text(encoding="utf-8", errors="ignore")
    html모드 = _is_html(전_path) and _is_html(후_path)

    if html모드:
        전산문, 후산문 = 산문(전html), 산문(후html)
    else:
        # .txt · .md — 표(마크다운 파이프 줄)만 빼고 전부 산문으로 본다.
        def 텍스트산문(t: str) -> str:
            줄 = [x for x in t.splitlines() if not re.match(r"^\s*\|", x)]
            return "\n".join(줄).strip()
        전산문, 후산문 = 텍스트산문(전html), 텍스트산문(후html)
    if not 전산문 or not 후산문:
        print("✗ 본문을 찾지 못했습니다. HTML 경로를 확인하세요.")
        return 1

    실패: list[str] = []

    # 1) 표·차트 불변 (게이트) — HTML 에만 있다
    전고정, 후고정 = (고정영역(전html), 고정영역(후html)) if html모드 else ("", "")
    if not html모드:
        print("  · 표·도해 — (HTML 이 아니라 건너뜁니다)")
    elif 전고정 != 후고정:
        실패.append("표·도해 변경 — <table>/<svg> 안의 글자는 윤문 대상이 아닙니다")
        print("  · 표·도해 ✗ 달라짐")
        for a, b in zip(전고정.split("\n"), 후고정.split("\n")):
            if a != b:
                print(f"      전: {a[:90]}")
                print(f"      후: {b[:90]}")
                break
    else:
        if html모드:
            print("  · 표·도해 ✔ 그대로")

    # 2) 충실도 게이트 (게이트)
    #
    # checks.py 는 마크다운 산문을 전제로 만들어졌다. HTML 에서 뽑아낸 본문에는
    # 각주 앵커 판정이 원래부터 걸리는 자리가 있다(날짜 「2026.07」을 각주 옆
    # 수치로 읽는 식). 그래서 **원문을 자기 자신과 비교한 결과를 기준선으로 삼고,
    # 윤문 때문에 새로 생긴 것만** 실패로 센다. 원래 있던 오탐은 세지 않는다.
    기준선: list[str] = [str(f) for f in run_checks(전산문, 전산문)]
    코드 = []
    for f in run_checks(전산문, 후산문):
        키 = str(f)
        if 키 in 기준선:
            기준선.remove(키)   # 원래 있던 것 — 상쇄
            continue
        코드.append(f)
    설명 = {
        "number_injected": "원문에 없던 숫자가 들어갔습니다 (수치 주입)",
        "quote_altered": "직접 인용이 원문과 달라졌습니다",
        "footnote_count": "각주 표시 개수가 줄었습니다",
        "footnote_numbers": "각주 번호 집합이 달라졌습니다",
        "footnote_def": "각주 정의 줄이 사라지거나 바뀌었습니다",
        "footnote_anchor": "각주가 다른 문장으로 옮겨 붙었습니다",
        "heading_lost": "소제목이 사라졌습니다",
        "heading_absorbed": "소제목이 본문에 녹아 없어졌습니다",
        "empty_output": "윤문본이 비었습니다",
        "hayeot_injection": "'하였~' 이 늘었습니다 (문어투 역주입)",
        "cliche_injection": "상투구가 새로 들어갔습니다",
        "colloquial_erased": "구어체 어미가 통째로 지워졌습니다",
    }
    if 코드:
        for f in 코드:
            말 = 설명.get(f.code) or f.message
            실패.append(f"{f.code} — {말}")
            print(f"  · 충실도 ✗ {f.code} — {말}")
            print(f"      {f.message}")
    else:
        print("  · 충실도 ✔ 수치·인용·각주·제목 이상 없음")

    # 3) 원문 수치 소실 (참고)
    try:
        소실 = dropped_numbers(전산문, 후산문)
    except Exception:  # noqa: BLE001
        소실 = []
    if 소실:
        print(f"  · 수치 소실 △ {len(소실)}개 — {', '.join(map(str, 소실[:8]))}"
              + (" …" if len(소실) > 8 else ""))
        print("      (문장 병합의 정상 부산물일 수 있습니다. 사라진 값이 논지에 쓰이던 것이면 되살리세요.)")
    else:
        print("  · 수치 소실 ✔ 없음")

    # 4) 변경률 (참고)
    률 = 변경률(전산문, 후산문)
    표시 = "✔"
    말 = ""
    if 률 < 0.03:
        표시, 말 = "△", "거의 안 고쳤습니다 — 윤문이 실제로 돌았는지 확인하세요"
    elif 률 > 0.35:
        표시, 말 = "△", "많이 고쳤습니다 — 내용이 밀렸는지 눈으로 확인하세요"
    print(f"  · 변경률 {표시} {률:.1%} {말}")

    # 5) AI 티 지표 전후 (참고) — 윤문이 실제로 먹혔는지 본다
    전티, 후티 = _티지표(전산문), _티지표(후산문)
    if 전티 and 후티:
        print("  · AI 티 지표")
        나빠짐 = 0
        for 이름, 키, 방향 in _축:
            a, b = 전티.get(키), 후티.get(키)
            if a is None or b is None:
                continue
            좋아짐 = (b < a) if 방향 == "낮을수록" else (b > a)
            같음 = abs(b - a) < 1e-9
            표시 = "=" if 같음 else ("✔" if 좋아짐 else "△")
            if not 좋아짐 and not 같음:
                나빠짐 += 1
            # 소수 축은 넷째 자리까지 — 셋째에서 반올림하면 화살표와 숫자가 어긋나 보인다
            fmt = (lambda x: f"{x:.4f}") if isinstance(a, float) and a < 10 else (lambda x: f"{x:.0f}")
            print(f"      {표시} {이름:<16} {fmt(a):>7} → {fmt(b):>7}  ({방향} 좋음)")
        if 나빠짐 >= 3:
            print("      △ 다섯 축 중 셋 이상이 나빠졌습니다. 윤문이 헛돌았는지 보세요.")

    print("─" * 60)
    if 실패:
        print(f"✗ 윤문검증 실패 {len(실패)}건 — 고친 뒤 다시 돌리세요. PDF 로 넘어가지 마세요.")
        for x in 실패:
            print(f"    - {x}")
        return 1
    print("✔ 윤문검증 통과 — 내용은 그대로입니다. PDF 로 넘어가세요.")
    return 0


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("사용: python3 src/윤문검증.py <윤문전.html|.txt|.md> <윤문후.같은형식>", file=sys.stderr)
        return 2
    전, 후 = Path(argv[1]), Path(argv[2])
    for p in (전, 후):
        if not p.is_file():
            print(f"✗ 파일이 없습니다: {p}", file=sys.stderr)
            return 2
    print(f"윤문검증 — {전.name} → {후.name}")
    print("─" * 60)
    return 검증(전, 후)


if __name__ == "__main__":
    sys.exit(main(sys.argv))
