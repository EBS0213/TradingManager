#!/usr/bin/env python3
"""내 기록 파일을 알맞은 자리에 넣는다.

  python3 기록넣기.py --매매기록 a.csv b.xlsx ...     → 매매로그/ 로
  python3 기록넣기.py --참고자료 x.pdf y.png ...      → 참고자료/ 로
  python3 기록넣기.py --브리핑답변 z.txt              → 브리핑/<오늘 날짜>/ 로

파일 이름에 날짜가 없으면 오늘 날짜를 붙여 준다. 같은 이름이 있으면 뒤에 번호를 붙인다.
원본은 그대로 두고 복사한다 (실수로 지워지는 일이 없도록).
"""
import sys, re, shutil, pathlib, datetime, unicodedata as u

def nfc(x): return u.normalize("NFC", x or "")

자리 = {"매매기록": ("매매로그", "매매로그"),
      "참고자료": ("참고자료", "참고"),
      "브리핑답변": ("브리핑", "브리핑답변"),
      "전략리포트": ("입력_전략리포트PDF", "전략")}

종류, 파일들 = None, []
for a in sys.argv[1:]:
    if a.startswith("--"):
        k = a.lstrip("-")
        if k in 자리: 종류 = k
    else:
        파일들.append(a)

if not 종류 or not 파일들:
    print("쓰는 법: 기록넣기.py --매매기록|--참고자료|--브리핑답변 <파일들>")
    sys.exit(2)

폴더이름, 머리 = 자리[종류]
오늘 = datetime.date.today().isoformat()
if 종류 == "브리핑답변":                          # 브리핑은 일자별 폴더로 들어간다
    폴더이름 = f"브리핑/{오늘}"
폴더 = pathlib.Path(폴더이름); 폴더.mkdir(parents=True, exist_ok=True)
날짜패턴 = re.compile(r"20\d\d[-_.]?\d{2}[-_.]?\d{2}")

성공 = 0
for f in 파일들:
    p = pathlib.Path(f)
    if not p.exists():
        print(f"없는 파일: {f}"); continue
    이름 = nfc(p.name)
    if not 날짜패턴.search(이름):                  # 날짜가 없으면 붙여 준다
        이름 = f"{머리}_{오늘}_{이름}"
    목적지 = 폴더 / 이름
    n = 1
    while 목적지.exists():
        목적지 = 폴더 / f"{pathlib.Path(이름).stem}_{n}{pathlib.Path(이름).suffix}"
        n += 1
    shutil.copy2(str(p), str(목적지))
    성공 += 1
    print(f"OK\t{목적지}")

print(f"DONE\t{성공}\t{폴더이름}")
