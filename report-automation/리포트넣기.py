#!/usr/bin/env python3
"""증권사 리포트 PDF 를 관심종목 폴더에 알아서 넣는다.

  python3 리포트넣기.py a.pdf b.pdf ...          어느 종목인지 스스로 찾아 넣는다
  python3 리포트넣기.py --to 005930 a.pdf        이 종목으로 넣으라고 지정
  python3 리포트넣기.py --check a.pdf            넣지 않고 어느 종목인지만 알려준다

찾는 순서 — ① 파일 이름(주소 인코딩은 풀어서) ② PDF 첫 두 쪽의 글자
어느 종목인지 못 찾으면 옮기지 않고 'UNMATCHED' 로 알린다. 함부로 넣지 않는다.
"""
import sys, os, re, shutil, pathlib, urllib.parse, unicodedata as u
sys.path.insert(0, ".")
import 워치리스트도구 as W

def nfc(x): return u.normalize("NFC", x or "")

인자 = sys.argv[1:]
지정, 확인만, 파일들 = "", False, []
i = 0
while i < len(인자):
    a = 인자[i]
    if a == "--to" and i + 1 < len(인자):
        지정 = 인자[i+1].upper(); i += 2; continue
    if a == "--check":
        확인만 = True; i += 1; continue
    파일들.append(a); i += 1

if not 파일들:
    print("넣을 PDF 를 지정해 주세요."); sys.exit(2)

본 = W.읽기()
if not 본:
    print("관심종목 목록이 비어 있습니다."); sys.exit(9)

넣을곳 = pathlib.Path("입력_리포트PDF")
넣을곳.mkdir(exist_ok=True)

def 첫글자들(p, 쪽수=2):
    try:
        from pdfminer.high_level import extract_text
        return nfc(extract_text(str(p), maxpages=쪽수) or "")
    except Exception:
        return ""

def 찾기(경로):
    이름 = nfc(urllib.parse.unquote(os.path.basename(경로)))
    풀이름 = 이름 + " " + nfc(os.path.basename(경로))
    # ① 국내 6자리 코드가 파일 이름에 있으면 그게 제일 확실하다
    for c in re.findall(r"\d{6}", 풀이름):
        if c.upper() in 본:
            return c.upper(), "파일이름의 종목코드"
    # ② 종목명이 파일 이름에 있으면
    후보 = sorted(본.items(), key=lambda kv: -len(kv[1]))
    for 코드, 종목명 in 후보:
        if len(종목명) >= 2 and nfc(종목명) in 풀이름:
            return 코드, "파일이름의 종목명"
    # ③ 해외 티커가 대괄호·괄호 안에 있으면
    for t in re.findall(r"[\(\[]([A-Z]{1,5})[\)\]]", 풀이름.upper()):
        if t in 본:
            return t, "파일이름의 티커"
    # ④ PDF 본문
    글 = 첫글자들(경로)
    if 글:
        for c in re.findall(r"\d{6}", 글):
            if c.upper() in 본:
                return c.upper(), "PDF 본문의 종목코드"
        for 코드, 종목명 in 후보:
            if len(종목명) >= 2 and nfc(종목명) in 글:
                return 코드, "PDF 본문의 종목명"
        머리 = 글[:1500].upper()
        for 코드 in 본:
            if not 코드.isdigit() and re.search(rf"\b{re.escape(코드)}\b", 머리):
                return 코드, "PDF 본문의 티커"
    return "", ""

성공 = 0
for f in 파일들:
    p = pathlib.Path(f)
    if not p.exists():
        print(f"NOFILE\t{f}"); continue
    if 지정:
        코드, 근거 = (지정, "직접 지정") if 지정 in 본 else ("", "")
        if not 코드:
            print(f"UNMATCHED\t{p}\t관심종목에 없는 코드입니다: {지정}"); continue
    else:
        코드, 근거 = 찾기(str(p))
    if not 코드:
        print(f"UNMATCHED\t{p}\t어느 종목인지 못 찾았습니다"); continue

    종목명 = 본[코드]
    if 확인만:
        print(f"CHECK\t{p.name}\t{코드}\t{종목명}\t{근거}"); continue

    # 이미 그 종목 이름으로 된 폴더가 있으면 그걸 쓰고, 없으면 새로 만든다
    자리 = None
    for d in 넣을곳.iterdir():
        if d.is_dir() and (nfc(종목명) in nfc(d.name) or 코드.upper() in nfc(d.name).upper()):
            자리 = d; break
    if 자리 is None:
        자리 = 넣을곳 / f"{종목명}"
        자리.mkdir(parents=True, exist_ok=True)

    목적지 = 자리 / p.name
    n = 1
    while 목적지.exists():
        목적지 = 자리 / f"{목적지.stem if n==1 else p.stem}_{n}{p.suffix}"
        n += 1
    try:
        shutil.move(str(p), str(목적지))
    except Exception:
        shutil.copy2(str(p), str(목적지))
    성공 += 1
    print(f"OK\t{p.name}\t{코드} {종목명}\t{근거}")

if not 확인만:
    print(f"DONE\t{성공}")
