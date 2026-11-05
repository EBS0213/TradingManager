#!/usr/bin/env python3
"""관심종목 CSV 를 읽고 쓰는 공용 도구."""
import csv, pathlib, unicodedata as u

ROOT = pathlib.Path(".")
이름후보 = {"워치리스트", "watchlist", "관심종목", "관심목록"}
코드키 = ("종목코드","코드","code","Code","CODE","티커","ticker","Ticker","심볼","symbol")
이름키 = ("종목명","이름","회사명","name","Name","종목")

def nfc(x): return u.normalize("NFC", x or "")

def csv파일들():
    나온것 = []
    for d in sorted(ROOT.iterdir()):
        if d.is_dir() and nfc(d.name).lower() in 이름후보:
            나온것 += sorted(x for x in d.glob("*.csv")
                            if not x.name.startswith(("_", "~$", ".")))
    if (ROOT / "watchlist.csv").exists():
        나온것.append(ROOT / "watchlist.csv")
    return 나온것

def 읽기():
    """{코드대문자: 이름} 을 돌려준다."""
    본 = {}
    for f in csv파일들():
        try:
            with f.open(encoding="utf-8-sig") as fp:
                for row in csv.DictReader(fp):
                    c = next((str(row[k]).strip().strip('"') for k in 코드키 if row.get(k)), "")
                    n = next((str(row[k]).strip().strip('"') for k in 이름키 if row.get(k)), "") or c
                    if c and not c.startswith("#"):
                        본.setdefault(c.upper(), n)
        except Exception:
            pass
    return 본

def 주파일():
    """새로 쓸 때 쓰는 파일. 이미 있는 것 중 가장 최근 것, 없으면 Watchlist/watchlist.csv"""
    fs = csv파일들()
    if fs:
        return max(fs, key=lambda p: p.stat().st_mtime)
    d = ROOT / "Watchlist"
    d.mkdir(exist_ok=True)
    return d / "watchlist.csv"

def 쓰기(항목, 파일=None):
    """항목 = [(코드, 이름, 메모, 추가일), ...]"""
    파일 = 파일 or 주파일()
    파일.parent.mkdir(parents=True, exist_ok=True)
    with 파일.open("w", encoding="utf-8-sig", newline="") as fp:
        w = csv.writer(fp, quoting=csv.QUOTE_ALL)
        w.writerow(["코드", "종목명", "메모", "추가일"])
        for row in 항목:
            w.writerow(list(row) + [""] * (4 - len(row)))
    return 파일
