#!/usr/bin/env python3
"""
보고서 HTML → 워드(.docx) 변환기  (블로그 붙여넣기용)

  python3 make_docx.py out/010950_S-Oil/보고서.html
  python3 make_docx.py out                      (폴더를 주면 안에 있는 html 전부)

왜 따로 만드나:
  화면·인쇄용 HTML 은 차트를 SVG 로 품고 있는데 워드는 SVG 를 잘 못 다룬다.
  그리고 HTML 에서 예쁘게 보이는 작은 표가 워드·블로그로 넘어가면
  셀 높이가 제멋대로 벌어져 커다란 빈칸이 생긴다.

그래서 이 변환기는 세 가지를 한다.
  1) 인라인 SVG → PNG 이미지
  2) **작은 표는 글로 바꾼다** (표지 요약, 2~3열짜리 항목-값 표)
  3) 진짜 표만 표로 남긴다 (분기 시계열처럼 열이 많은 것)

준비물 (한 번만):  pip3 install cairosvg beautifulsoup4  ·  brew install pandoc
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# 표로 남길 열 수의 범위. 이 밖은 문장·목록으로 바꾼다.
#   3열 이하 → 항목-값 나열이라 표가 필요 없다
#   8열 이상 → 워드에서 셀이 좁아져 글자가 쪼개진다 (예: "113,43 / 5")
표로_유지할_최소_열수 = 4
표로_유지할_최대_열수 = 7


def svg_to_png(svg_text: str, out_png: Path, scale: float = 2.0) -> bool:
    try:
        import cairosvg
    except ImportError:
        print("   cairosvg 가 없습니다. `pip3 install cairosvg` 후 다시 실행하세요.")
        return False
    try:
        cairosvg.svg2png(bytestring=svg_text.encode("utf-8"), write_to=str(out_png), scale=scale)
        return True
    except Exception as e:                        # noqa: BLE001
        print(f"   차트 변환 실패: {e}")
        return False


def _cells(row) -> list[str]:
    return [c.get_text(" ", strip=True) for c in row.find_all(["td", "th"])]


def _table_to_text(soup, table) -> None:
    """작은 표를 문장·목록으로 바꾼다. 열이 많은 표는 그대로 둔다."""
    rows = [r for r in table.find_all("tr") if _cells(r)]
    if not rows:
        table.decompose()
        return
    ncols = max(len(_cells(r)) for r in rows)
    if 표로_유지할_최소_열수 <= ncols <= 표로_유지할_최대_열수:
        return                                    # 진짜 데이터 표 — 그대로 둔다

    header = _cells(rows[0])

    # --- 열이 너무 많은 표: 행마다 "항목 — 머리글 값 · 머리글 값" 으로 편다 ---
    if ncols > 표로_유지할_최대_열수:
        from bs4 import BeautifulSoup
        lines = []
        for r in rows[1:]:
            cs = _cells(r)
            if not cs:
                continue
            pairs = [f"{header[i]} {cs[i]}" for i in range(1, min(len(cs), len(header)))
                     if cs[i] not in ("", "-")]
            lines.append(f"<p><b>{cs[0]}</b> — {' · '.join(pairs)}</p>")
        table.replace_with(BeautifulSoup("".join(lines), "html.parser"))
        return
    body = rows[1:] if len(rows) > 1 else rows
    # 첫 행이 머리글로 보이면(th 사용) 본문에서 뺀다
    is_header = bool(rows[0].find("th"))
    if not is_header:
        body = rows

    out = []
    for r in body:
        cs = [c for c in _cells(r) if c]
        if not cs:
            continue
        if len(cs) == 1:
            out.append(cs[0])
        elif len(cs) == 2:
            out.append(f"<b>{cs[0]}</b> {cs[1]}")
        else:
            out.append(f"<b>{cs[0]}</b> {' · '.join(cs[1:])}")

    frag = ""
    if is_header and len(header) >= 2:
        frag += f"<p><i>{' · '.join(h for h in header if h)}</i></p>"
    frag += "".join(f"<p>{line}</p>" for line in out)
    table.replace_with(__import__("bs4").BeautifulSoup(frag, "html.parser"))


def _cover_side_to_text(soup) -> None:
    """표지 오른쪽 요약 상자를 한 줄짜리 문장들로 바꾼다.
    이 부분이 워드에서 가장 크게 벌어지는 곳이다."""
    from bs4 import BeautifulSoup
    for aside in soup.select(".cov-side"):
        lines = []
        for block in aside.select(".side-block"):
            label = block.select_one(".side-h")
            big = block.select_one(".side-big")
            note = block.select_one(".side-note")
            tbl = block.select_one(".side-tbl")
            label_t = label.get_text(" ", strip=True) if label else ""
            parts = []
            if big:
                parts.append(f"<b>{big.get_text(' ', strip=True)}</b>")
            if tbl:
                pairs = []
                for r in tbl.find_all("tr"):
                    cs = _cells(r)
                    if len(cs) >= 2:
                        pairs.append(f"{cs[0]} {cs[1]}")
                if pairs:
                    parts.append(" · ".join(pairs))
            if note:
                parts.append(note.get_text(" ", strip=True))
            if parts:
                lines.append(f"<p>{label_t + ' ' if label_t else ''}{' · '.join(parts)}</p>")
        aside.replace_with(BeautifulSoup("".join(lines), "html.parser"))


def html_to_word_html(html: str, workdir: Path) -> str:
    workdir.mkdir(parents=True, exist_ok=True)
    idx = 0

    def repl(m: re.Match) -> str:
        nonlocal idx
        idx += 1
        png = workdir / f"fig_{idx:02d}.png"       # 한글 파일명은 pandoc 에서 깨진다
        return f'<p><img src="{png}" width="640"></p>' if svg_to_png(m.group(0), png) else ""

    html = re.sub(r"<svg\b.*?</svg>", repl, html, flags=re.S)
    html = re.sub(r"<style>.*?</style>", "", html, flags=re.S)

    try:
        from bs4 import BeautifulSoup
    except ImportError:
        print("   beautifulsoup4 가 없습니다. `pip3 install beautifulsoup4` 후 다시 실행하세요.")
        return html

    soup = BeautifulSoup(html, "html.parser")
    _cover_side_to_text(soup)
    for t in list(soup.find_all("table")):
        _table_to_text(soup, t)
    # 그림 제목·주석을 문단으로 살린다
    for d in soup.select(".fig-t"):
        d.name = "p"
        d.string = d.get_text(" ", strip=True)
    for d in soup.select(".fig-s, .src"):
        d.name = "p"
    return str(soup)


def convert(html_path: Path) -> Path | None:
    docx = html_path.with_suffix(".docx")
    print(f"▶ {html_path.name} → {docx.name}")
    if not shutil.which("pandoc"):
        print("   pandoc 이 없습니다. 맥이라면 `brew install pandoc` 후 다시 실행하세요.")
        return None
    with tempfile.TemporaryDirectory() as tmp:
        tmpdir = Path(tmp)
        src = html_to_word_html(html_path.read_text(encoding="utf-8"), tmpdir / "charts")
        tmp_html = tmpdir / "word_src.html"
        tmp_html.write_text(src, encoding="utf-8")
        env = {"LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "PATH": "/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin"}
        r = subprocess.run(["pandoc", str(tmp_html), "-f", "html", "-t", "docx", "-o", str(docx)],
                           capture_output=True, text=True, env=env)
        if r.returncode != 0:
            print("   변환 실패:", r.stderr.strip()[:300])
            return None
    print(f"   ✔ {docx}")
    return docx


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    targets: list[Path] = []
    for arg in sys.argv[1:]:
        p = Path(arg)
        targets.extend(sorted(x for x in p.glob("**/*.html") if "워드용" not in x.name)
                       if p.is_dir() else [p])
    if not targets:
        raise SystemExit("변환할 HTML 을 찾지 못했습니다.")
    for t in targets:
        convert(t)


if __name__ == "__main__":
    main()
