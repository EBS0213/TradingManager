# -*- coding: utf-8 -*-
"""보고서 PDF 를 블로그에 올릴 이미지로 만든다.

    python3 make_images.py <보고서.pdf> [--dpi 150]

2026-08-23 신설. Jun 님이 「워드보다 이미지가 블로그에 올리기 쉽다」고 해서
DOCX 를 대신하는 표준 산출물이 됐다. 두 가지를 함께 만든다.

  1) 낱장 PNG  — 쪽마다 한 장. 블로그 본문에 순서대로 올리는 용도
  2) 2단 전체본 — 14쪽을 2열로 접어 한 장에. 미리보기·썸네일용

**세로로 길게 이어 붙이지 않는다.** 한 줄로 붙이면 14쪽이 25,000px 가 되는데
그 높이는 업로드가 거부된다(실제로 400 을 받았다). 그래서 2단으로 접는다.
"""
from __future__ import annotations
import subprocess, sys, os
from pathlib import Path

DPI기본 = 150          # 쪽당 1240×1754px. 화면에서 읽히고 블로그 폭에도 맞는다
전체본_최대세로 = 6000   # 이보다 길면 축소한다. 업로드 한도를 넘지 않게

def 만들기(pdf: Path, dpi: int = DPI기본) -> Path:
    from PIL import Image
    out = pdf.parent / "이미지"
    out.mkdir(exist_ok=True)
    # 예전 이미지를 지운다. 다만 **지우지 못해도 계속 간다** —
    # 맥의 공유 폴더에서는 삭제가 막혀 있고(Operation not permitted),
    # pdftoppm 이 어차피 같은 이름으로 덮어쓰기 때문에 지우기는 청소일 뿐이다.
    남은쪽 = 0
    for 옛것 in sorted(out.glob("*.png")):
        try:
            옛것.unlink()
        except OSError:
            남은쪽 += 1
    if 남은쪽:
        print(f"   (예전 이미지 {남은쪽}장을 지우지 못해 덮어씁니다 — 삭제 권한 없음)")

    머리 = pdf.stem
    # pdftoppm(poppler)이 먼저다. 없으면 pypdfium2 로 같은 결과를 만든다.
    # 2026-08-24 추가 — 이 맥에는 poppler 가 깔려 있지 않아 FileNotFoundError 로 죽었다.
    # pypdfium2 는 pip 로 들어오는 순수 파이썬 휠이라 별도 설치가 필요 없다.
    쪽수 = 0
    try:
        subprocess.run(["pdftoppm", "-png", "-r", str(dpi), str(pdf), str(out / 머리)],
                       check=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        import pypdfium2 as pdfium
        print("   (pdftoppm 이 없어 pypdfium2 로 렌더합니다)")
        문서 = pdfium.PdfDocument(str(pdf))
        폭 = len(str(len(문서)))
        for i in range(len(문서)):
            # pdfium 의 scale 은 72dpi 기준 배율이다
            문서[i].render(scale=dpi / 72).to_pil().save(out / f"{머리}-{i+1:0{폭}d}.png")
        쪽수 = len(문서)

    낱장 = sorted(out.glob(f"{머리}-*.png"))
    if not 낱장:
        raise SystemExit("PDF 를 이미지로 바꾸지 못했습니다. "
                         "pdftoppm(poppler) 이나 pypdfium2 가 필요합니다.")

    ims = [Image.open(f) for f in 낱장]
    print(f"   낱장 {len(ims)}장 · 쪽당 {ims[0].width}×{ims[0].height}px")

    # 2단 전체본
    배율 = 0.45
    ims2 = [i.resize((int(i.width * 배율), int(i.height * 배율)), Image.LANCZOS) for i in ims]
    열, 틈, 여백 = 2, 14, 14
    w, h = ims2[0].width, ims2[0].height
    행 = (len(ims2) + 열 - 1) // 열
    W = 여백 * 2 + 열 * w + (열 - 1) * 틈
    H = 여백 * 2 + 행 * h + (행 - 1) * 틈
    장 = Image.new("RGB", (W, H), "#d8d8d4")
    for k, i in enumerate(ims2):
        r, q = divmod(k, 열)
        장.paste(i, (여백 + q * (w + 틈), 여백 + r * (h + 틈)))
    if 장.height > 전체본_최대세로:
        s = 전체본_최대세로 / 장.height
        장 = 장.resize((int(장.width * s), 전체본_최대세로), Image.LANCZOS)
    전체 = out / f"{머리}_전체_2단.png"
    장.save(전체, optimize=True)
    print(f"   2단 전체본 {장.width}×{장.height}px · {os.path.getsize(전체)//1024//1024}MB")
    유령 = [f for f in sorted(out.glob(f"{머리}-*.png")) if f not in 낱장]
    if 유령:
        print(f"   ⚠ 이전 판에서 남은 이미지 {len(유령)}장이 섞여 있습니다: "
              + ", ".join(f.name for f in 유령[:3]) + (" …" if len(유령) > 3 else ""))
        print("     쪽수가 줄었을 때 생기는 일이니 직접 지우세요.")
    print(f"   ✔ {out}")
    return out

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("사용법: python3 make_images.py <보고서.pdf> [--dpi 150]"); sys.exit(2)
    p = Path(sys.argv[1])
    d = int(sys.argv[sys.argv.index("--dpi") + 1]) if "--dpi" in sys.argv else DPI기본
    print(f"▶ {p.name} → 이미지 (dpi {d})")
    만들기(p, d)
