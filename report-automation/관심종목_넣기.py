#!/usr/bin/env python3
"""관심종목 파일을 읽어 목록에 넣는다.

  python3 관심종목_넣기.py --preview <파일>          무엇으로 읽었는지만 보여준다
  python3 관심종목_넣기.py --replace <파일>          이 파일 내용으로 갈아끼운다
  python3 관심종목_넣기.py --add-keep <파일>         더하되 중복은 기존 이름을 남긴다
  python3 관심종목_넣기.py --add-update <파일>       더하되 중복은 새 파일 이름으로 바꾼다

csv · tsv · txt · xlsx 를 읽는다. 파일을 안 주면 클립보드(표준입력)를 읽는다.
"""
import sys, re, datetime, pathlib, unicodedata as u
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import 워치리스트도구 as W

모드, 파일 = "preview", None
for a in sys.argv[1:]:
    if a.startswith("--"):
        모드 = a.lstrip("-")
    else:
        파일 = a

def 글읽기():
    if not 파일:
        return sys.stdin.read()
    p = pathlib.Path(파일)
    if p.suffix.lower() in (".xlsx", ".xlsm"):
        try:
            import openpyxl
            wb = openpyxl.load_workbook(p, data_only=True)
            줄들 = []
            for ws in wb.worksheets:
                for row in ws.iter_rows(values_only=True):
                    줄들.append("\t".join("" if c is None else str(c) for c in row))
            return "\n".join(줄들)
        except Exception as e:
            print(f"엑셀 파일을 읽지 못했습니다: {e}")
            sys.exit(9)
    for enc in ("utf-8-sig", "cp949", "euc-kr", "utf-8"):
        try:
            return p.read_text(encoding=enc)
        except UnicodeDecodeError:
            continue
        except Exception as e:
            print(f"파일을 열지 못했습니다: {e}")
            sys.exit(9)
    print("글자 인코딩을 알아보지 못했습니다.")
    sys.exit(9)

글 = 글읽기()
if not 글.strip():
    print("파일이 비어 있습니다.")
    sys.exit(9)

코드패턴 = re.compile(r"\b(\d{6})\b")
티커패턴 = re.compile(r"\b([A-Z][A-Z0-9.\-]{0,5})\b")
버릴말 = {"CODE","NAME","TICKER","SYMBOL","N/A","NA","USD","KRW","BUY","SELL","HOLD",
        "PE","PER","PBR","ROE","EPS","ETF","INC","CORP","LTD","CO","THE","AND",
        "COMMON","STOCK","SHARES","CLASS","HOLDINGS","GROUP","PLC","NYSE","NASDAQ"}

읽은것, 못읽은줄, 본것 = [], [], set()
for 줄 in 글.splitlines():
    원문 = 줄.strip()
    if not 원문 or 원문.startswith("#"):
        continue
    칸 = [c.strip().strip('"').strip("'") for c in re.split(r"[\t,;|]+|\s{2,}", 원문) if c.strip()]
    합침 = " ".join(칸) if 칸 else 원문
    # 날짜·시세 같은 곁가지는 이름에서 뺀다
    합침 = re.sub(r"\b\d{4}[-./]\d{1,2}[-./]\d{1,2}\b", " ", 합침)
    m = 코드패턴.search(합침)
    if m:
        코드 = m.group(1)
        남은 = 코드패턴.sub(" ", 합침)
        조각 = [c for c in re.split(r"\s+", 남은)
              if c and not re.fullmatch(r"[\d,.\-+%원▲▼△▽()]+", c)]
        이름 = " ".join(조각).strip() or 코드
    else:
        후보 = [t for t in 티커패턴.findall(합침.upper())
              if t not in 버릴말 and not t.isdigit()]
        if not 후보:
            못읽은줄.append(원문); continue
        코드 = 후보[0]
        남은2 = 합침.replace(코드, " ")
        조각2 = [c for c in re.split(r"\s+", 남은2)
               if c and not re.fullmatch(r"[\d,.\-+%()]+", c)]
        이름 = " ".join(조각2).strip() or 코드
    코드 = 코드.upper()
    if 코드 in 본것:
        continue
    본것.add(코드)
    읽은것.append((코드, u.normalize("NFC", 이름)[:60]))

if not 읽은것:
    print("종목을 하나도 알아보지 못했습니다.")
    if 못읽은줄:
        print("\n첫 줄들:")
        for x in 못읽은줄[:6]:
            print("   " + x[:70])
    print("\n종목코드(6자리)나 해외 티커가 들어 있는 파일이어야 합니다.")
    sys.exit(9)

기존 = W.읽기()
새것 = [(c, n) for c, n in 읽은것 if c not in 기존]
겹침 = [(c, n) for c, n in 읽은것 if c in 기존]
빠짐 = [c for c in 기존 if c not in 본것]

if 모드 == "preview":
    print(f"파일에서 {len(읽은것)}종목을 읽었습니다.")
    print(f"  · 새로 들어올 종목  {len(새것)}개")
    print(f"  · 이미 있는 종목    {len(겹침)}개")
    print(f"  · 이 파일에 없지만 지금 목록에 있는 종목  {len(빠짐)}개")
    if 새것:
        print("\n[새로]")
        for c, n in 새것[:15]:
            print(f"   {c:<8s} {n}")
        if len(새것) > 15: print(f"   … 외 {len(새것)-15}개")
    if 겹침:
        print("\n[겹침]")
        for c, n in 겹침[:10]:
            현재 = 기존[c]
            표 = f"{c:<8s} {현재}"
            if u.normalize("NFC", 현재) != u.normalize("NFC", n):
                표 += f"   →  새 파일에는 「{n}」"
            print("   " + 표)
        if len(겹침) > 10: print(f"   … 외 {len(겹침)-10}개")
    if 빠짐:
        print("\n[갈아끼우면 사라질 종목]")
        print("   " + ", ".join(f"{c}" for c in 빠짐[:20]) + (" …" if len(빠짐) > 20 else ""))
    if 못읽은줄:
        print(f"\n못 읽고 넘어간 줄 {len(못읽은줄)}개")
    sys.exit(0)

오늘 = datetime.date.today().isoformat()
if 모드 == "replace":
    최종 = [(c, n, "", 오늘) for c, n in 읽은것]
elif 모드 in ("add-keep", "add-update"):
    최종 = []
    새이름 = dict(읽은것)
    for c in 기존:
        이름 = 새이름[c] if (모드 == "add-update" and c in 새이름) else 기존[c]
        최종.append((c, 이름, "", ""))
    for c, n in 새것:
        최종.append((c, n, "", 오늘))
else:
    print(f"모르는 모드입니다: {모드}")
    sys.exit(2)

파일경로 = W.주파일()
if 파일경로.exists():
    백업 = pathlib.Path("백업"); 백업.mkdir(exist_ok=True)
    스탬프 = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    (백업 / f"{파일경로.stem}_{스탬프}.csv").write_bytes(파일경로.read_bytes())

W.쓰기(최종, 파일경로)
말 = {"replace": "갈아끼웠습니다",
     "add-keep": "더했습니다 (겹치는 종목은 그대로 두었습니다)",
     "add-update": "더했습니다 (겹치는 종목은 새 이름으로 바꿨습니다)"}[모드]
print(f"✔ {말}")
print(f"   지금 관심종목 {len(최종)}개 · 새로 들어온 것 {len(새것)}개")
print(f"   파일 : {파일경로}")
print(f"   바꾸기 전 파일은 '백업' 폴더에 있습니다.")
