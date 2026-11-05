#!/usr/bin/env python3
"""복사해 둔 관심종목 목록을 읽어 CSV 에 넣는다.

  pbpaste | python3 관심종목_붙여넣기.py --merge     기존 목록에 더한다
  pbpaste | python3 관심종목_붙여넣기.py --replace   기존 목록을 갈아엎는다
  pbpaste | python3 관심종목_붙여넣기.py --preview   무엇으로 읽었는지만 보여준다

어떤 모양이든 알아본다 — 엑셀에서 복사한 탭 구분, 쉼표, 「삼성전자 005930」,
「005930 삼성전자」, HTS 목록, 티커만 있는 줄 모두.
"""
import sys, re, io, datetime, pathlib, unicodedata as u
sys.path.insert(0, ".")
import 워치리스트도구 as W

인자 = sys.argv[1:]
모드 = "merge"
for a in 인자:
    if a in ("--merge", "--replace", "--preview"):
        모드 = a.lstrip("-")

글 = sys.stdin.read()
if not 글.strip():
    print("붙여넣은 내용이 비어 있습니다.")
    sys.exit(9)

코드패턴 = re.compile(r"\b(\d{6})\b")                  # 국내 6자리
티커패턴 = re.compile(r"\b([A-Z][A-Z0-9.\-]{0,5})\b")   # 해외 티커
버릴말 = {"CODE","NAME","TICKER","SYMBOL","N/A","NA","USD","KRW","BUY","SELL",
        "PE","PER","PBR","ROE","EPS","ETF","INC","CORP","LTD","CO","THE","AND",
        "COMMON","STOCK","SHARES","CLASS","HOLDINGS","GROUP","PLC"}

읽은것, 못읽은줄 = [], []
본것 = set()
for 줄 in 글.splitlines():
    원문 = 줄.strip()
    if not 원문 or 원문.startswith("#"):
        continue
    # 탭·쉼표·여러 칸을 모두 구분자로 본다
    칸 = [c.strip().strip('"').strip("'") for c in re.split(r"[\t,;|]+|\s{2,}", 원문) if c.strip()]
    합침 = " ".join(칸) if 칸 else 원문

    m = 코드패턴.search(합침)
    코드 = m.group(1) if m else ""
    if 코드:
        남은 = 코드패턴.sub(" ", 합침)
        # 숫자·기호만 남은 조각(시세·등락률 등)은 버린다
        조각 = [c for c in re.split(r"\s{1,}", 남은)
              if c and not re.fullmatch(r"[\d,.\-+%원▲▼△▽()]+", c)]
        이름 = " ".join(조각).strip() or 코드
    else:
        후보 = [t for t in 티커패턴.findall(합침.upper())
              if t not in 버릴말 and not t.isdigit()]
        if not 후보:
            못읽은줄.append(원문)
            continue
        코드 = 후보[0]
        이름 = 합침.replace(코드, " ").strip(" ,\t-") or 코드
    코드 = 코드.upper()
    if 코드 in 본것:
        continue
    본것.add(코드)
    읽은것.append((코드, u.normalize("NFC", 이름)[:60]))

if not 읽은것:
    print("종목을 하나도 알아보지 못했습니다.")
    if 못읽은줄:
        print("\n못 읽은 줄:")
        for x in 못읽은줄[:10]:
            print("   " + x[:70])
    sys.exit(9)

기존 = W.읽기()
새것 = [c for c, _ in 읽은것 if c not in 기존]
겹침 = [c for c, _ in 읽은것 if c in 기존]

print(f"■ 읽어낸 종목 {len(읽은것)}개")
for c, n in 읽은것:
    표 = "새로" if c in 새것 else "이미"
    print(f"   [{표}]  {c:<8s} {n}")
if 못읽은줄:
    print(f"\n■ 못 읽은 줄 {len(못읽은줄)}개 (그냥 넘어갑니다)")
    for x in 못읽은줄[:8]:
        print("   " + x[:70])

if 모드 == "preview":
    print(f"\n(미리보기입니다. 아직 저장하지 않았습니다)")
    sys.exit(0)

오늘 = datetime.date.today().isoformat()
if 모드 == "replace":
    최종 = [(c, n, "", 오늘) for c, n in 읽은것]
else:
    최종 = [(c, n, "", "") for c, n in
          [(c, 기존[c]) for c in 기존]]                    # 기존 먼저
    있는코드 = {c for c, *_ in 최종}
    for c, n in 읽은것:
        if c not in 있는코드:
            최종.append((c, n, "", 오늘))

# 덮어쓰기 전에 백업
파일 = W.주파일()
if 파일.exists():
    백업 = pathlib.Path("백업"); 백업.mkdir(exist_ok=True)
    스탬프 = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    (백업 / f"{파일.stem}_{스탬프}.csv").write_bytes(파일.read_bytes())

W.쓰기(최종, 파일)
말 = "갈아끼웠습니다" if 모드 == "replace" else "더했습니다"
print(f"\n✔ {파일} 에 {말}. 지금 관심종목 {len(최종)}개 (새로 {len(새것)}개)")
print("   바꾸기 전 파일은 '백업' 폴더에 남겨 뒀습니다.")
