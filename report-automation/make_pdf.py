#!/usr/bin/env python3
"""
보고서 HTML → PDF 변환기

  python3 make_pdf.py out/119850_지엔씨에너지/보고서.html
  python3 make_pdf.py out                      (폴더를 주면 안에 있는 html 전부)

두 가지 방법을 순서대로 시도합니다.
  1) playwright (pip install playwright && playwright install chromium)
  2) 컴퓨터에 이미 깔린 크롬을 headless 로 호출  ← 크롬만 있으면 설치가 필요 없습니다
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "google-chrome", "chromium", "chromium-browser", "microsoft-edge",
]


def via_playwright(html: Path, pdf: Path) -> bool:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return False
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch()
            page = browser.new_page()
            page.goto(html.resolve().as_uri(), wait_until="networkidle")
            page.emulate_media(media="print")
            page.pdf(path=str(pdf), prefer_css_page_size=True,
                     print_background=True, format="A4")
            browser.close()
        return True
    except Exception as e:                       # noqa: BLE001
        print(f"   playwright 실패: {e}")
        return False


def via_chrome(html: Path, pdf: Path) -> bool:
    exe = next((c for c in CHROME_CANDIDATES
                if Path(c).exists() or shutil.which(c)), None)
    if not exe:
        return False
    exe = exe if Path(exe).exists() else shutil.which(exe)
    with tempfile.TemporaryDirectory() as tmp:
        cmd = [exe, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
               f"--user-data-dir={tmp}", f"--print-to-pdf={pdf.resolve()}",
               html.resolve().as_uri()]
        try:
            subprocess.run(cmd, check=True, timeout=180,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            return pdf.exists()
        except Exception as e:                   # noqa: BLE001
            print(f"   크롬 호출 실패: {e}")
            return False


def _report_폴더에도(pdf: Path) -> None:
    """완성된 PDF 를 프로젝트 루트의 `report/` 에도 한 부 둔다.

    2026-08-24 추가 — 종목 폴더(`out/<코드>_<이름>/`)를 하나씩 열지 않고
    보고서만 한자리에서 보고 싶다는 요청이 있었다. 원본은 그대로 out 에 두고
    **복사본**을 report 에 넣는다. 파일명이 `<회사명>_<코드>_기업분석보고서_날짜.pdf`
    라 한 폴더에 모아도 섞이지 않는다.

    루트는 `out` 폴더를 기준으로 찾는다. out 밖에서 변환했다면 조용히 넘어간다.
    """
    부모 = [q.name for q in pdf.parents]
    if "out" not in 부모:
        return
    # parents[i] 가 곧 "out" 폴더이므로, 그 **부모**인 i+1 이 프로젝트 루트다.
    # 2026-08-26 수정 — 예전에는 i 를 그대로 써서 out/report/ 에 복사됐다.
    루트 = pdf.parents[부모.index("out") + 1]     # …/out/<종목>/x.pdf → …/
    상자 = 루트 / "report"
    try:
        상자.mkdir(exist_ok=True)
        (상자 / pdf.name).write_bytes(pdf.read_bytes())
        print(f"   ✔ report/{pdf.name} 에도 복사")
    except OSError as e:
        # 맥 공유 폴더에서는 덮어쓰기가 막힐 수 있다. 복사는 부가 기능이므로 죽지 않는다.
        print(f"   · report/ 복사 실패(무시하고 진행): {e}")


def convert(html: Path) -> Path | None:
    pdf = html.with_suffix(".pdf")
    print(f"▶ {html.name} → {pdf.name}")
    if via_playwright(html, pdf) or via_chrome(html, pdf):
        print(f"   ✔ {pdf}")
        _report_폴더에도(pdf)
        return pdf
    print("   ✗ 변환 실패: playwright 를 설치하거나 크롬을 설치해 주세요.\n"
          "     pip install playwright && playwright install chromium")
    return None


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    targets: list[Path] = []
    for arg in sys.argv[1:]:
        p = Path(arg)
        targets.extend(sorted(p.glob("**/*.html")) if p.is_dir() else [p])
    if not targets:
        raise SystemExit("변환할 HTML 을 찾지 못했습니다.")
    for t in targets:
        convert(t)


if __name__ == "__main__":
    main()
