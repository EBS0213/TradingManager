#!/usr/bin/env python3
"""만들 종목을 골라 제작목록.txt 에 적는다.

  python3 종목고르기.py            → 화면에 목록을 띄우고 사람이 고른다(수동)
  python3 종목고르기.py --auto     → 묻지 않고 '보고서 없는 종목' 전부(자동실행용)
  python3 종목고르기.py 005930 CDNA → 종목코드를 직접 지정(이미 있어도 다시 만듦)

끝낼 때 종료코드 0 = 만들 것이 있음 / 9 = 없음 / 1 = 취소
"""
from 로컬설정 import 사이트주소
import csv, datetime as dt, json, os, pathlib, re, sys, time, unicodedata as u
import urllib.request
from 보고서기록 import 보고서코드, 보고서날짜

def nfc(x): return u.normalize("NFC", x or "")

ROOT = pathlib.Path(".")
인자 = [a for a in sys.argv[1:]]
자동 = "--auto" in 인자 or "--count" in 인자
세기만 = "--count" in 인자
지정 = [a.upper() for a in 인자 if not a.startswith("-")]

# ── 워치리스트 (폴더 이름이 무엇이든 전부 읽어 합친다)
이름후보 = {"워치리스트", "watchlist", "관심종목", "관심목록"}
파일들 = []
for d in sorted(ROOT.iterdir()):
    if d.is_dir() and nfc(d.name).lower() in 이름후보:
        파일들 += sorted(x for x in d.glob("*.csv")
                        if not x.name.startswith(("_", "~$", ".")))
if (ROOT / "watchlist.csv").exists():
    파일들.append(ROOT / "watchlist.csv")

#  2026-09-28 사용자 지시 — 대상 고르는 법이 바뀌었습니다.
#    「리포트는 **당일 스카우트 목록에서 80점 이상인 종목을 모두** 커버한다.
#     당시 미커버 제외 조건은 2026-10-27 사용자 지시로 폐지했습니다.
#     이미 만든 종목이 **1개월 이내**면 이번에는 취소하고 다음에 한다.」
#  워치리스트는 사람이 고른 목록이라 그대로 두고, 스카우트 80점 이상을 **더합니다**.
#  2026-10-12 사용자 지시 — 점수 문턱 대신 **[셋업] 탭에서 '셋업 있음'인 종목**을 대상으로 합니다.
#    「한국과 미국 자동보고서 제작 대상은 셋업 있음 단계의 종목들. 그 외 기준들은 동일함.」
#  (예전: 한국 종합점수 80점 · 미국 85점 이상) 1개월 재제작·시장별 하루 상한·
#   제작제외·워치리스트는 그대로입니다. 줄 세우기에 쓰는 점수는 셋업 판정의 종합점수입니다.
#  하루에 만들 수 있는 수는 한계가 있습니다 — 한 건에 한 시간 남짓, 동시 두 개.
#  처음 규칙을 켜면 밀린 것이 수십 종목이라, 상한이 없으면 한 번 실행이 열여섯 시간을
#  넘겨 다음 날 예약과 겹칩니다. 점수 높은 것부터 끊어서 며칠에 걸쳐 소화합니다.
#  (1개월 규칙이 있으니 한 바퀴 돌고 나면 하루 몇 개로 잦아듭니다)
#  2026-09-30 — 하루 상한을 **시장마다 따로** 둡니다.
#   전에는 6개를 통째로 두고 점수 순으로 잘랐는데, 미국 문턱(85)이 한국(80)보다
#   높아 **미국이 여섯 자리를 다 차지하고 한국은 한 건도 못 만들었습니다**(9/30).
#   문턱을 시장별로 다르게 둔 것이 그대로 순위 다툼이 된 것입니다.
#   이제 시장마다 자기 몫이 있어 서로를 밀어내지 않습니다.
#  2026-10-05 — 한때 2 로 낮췄다가 사용자 지시로 10 을 유지합니다. 사용량은 건수가 아니라
#   한 건의 문맥 크기(분리 제작 시험 중)와 모델(Opus 5.5 고정)로 줄입니다.
#  2026-10-13 사용자 지시 — 해외 5 · 국내 5 로 줄였습니다.
#  2026-10-16 사용자 정정 — 「줄이라고 한 것은 **텔레그램 채널 발송**이지 웹사이트 리서치가 아니었다.」
#   그래서 웹사이트 제작은 10-12 이전으로 되돌립니다: 스카우트 한국 80 · 미국 85점, 시장별 하루 10.
#   셋업 있음 종목은 텔레그램 카드용으로 **따로** 시장별 하루 5개까지 더 만듭니다(셋업상한).
#   두 정원은 서로를 밀어내지 않습니다. 둘 다에 드는 종목은 셋업 몫으로 칩니다.
#   텔레그램에는 셋업 몫만 나갑니다 — 캐시/텔레그램대상.json, 자동검토.py 카드뉴스발송() 참고.
점수문턱 = {"KR": float(os.environ.get("SCOUT_MIN", "80")),
         "US": float(os.environ.get("SCOUT_MIN_US", "85"))}
시장상한 = {"KR": int(os.environ.get("MAX_KR", "10")),
         "US": int(os.environ.get("MAX_US", "10"))}
셋업상한 = {"KR": int(os.environ.get("MAX_SETUP_KR", "5")),
         "US": int(os.environ.get("MAX_SETUP_US", "5"))}
텔레그램대상파일 = ROOT / "캐시" / "텔레그램대상.json"
대기파일 = ROOT / "캐시" / "제작대기.json"


def 그날뒤집기(날):
    """날짜 문자열을 **최근이 앞**으로 오도록 뒤집어 줍니다 (정렬 열쇠용)."""
    return tuple(-int(x) for x in (날 or "0000-00-00").split("-") if x.isdigit())


def 시장의(코드):
    return "KR" if re.fullmatch(r"\d{6}", str(코드 or "")) else "US"


def 대기표_읽기():
    try:
        return json.loads(대기파일.read_text(encoding="utf-8"))
    except Exception:
        return {}


def 대기표_맞추기(대상):
    """기다리는 줄. **먼저 대기에 들어온 것이 먼저** 만들어지게 날짜를 적어 둡니다.

    2026-09-30 지시 — 「작업이 밀릴 경우 대기중인 순서대로 순차제작」.
    점수만으로 줄을 세우면 어제 밀린 종목이 오늘 더 높은 점수에 또 밀리고,
    그런 날이 이어지면 **영영 차례가 오지 않습니다.** 그래서 대기 시작일을
    적어 두고 그것을 첫 번째 기준으로 씁니다(같은 날이면 점수 높은 순).
    """
    표 = 대기표_읽기()
    오늘글 = str(dt.date.today())
    있는것 = {c for c, _ in 대상}
    for c, nm in 대상:
        칸 = 표.get(c)
        if not 칸:
            표[c] = {"since": 오늘글, "name": nm}
        else:
            칸["name"] = nm
    # 더 이상 대상이 아닌 것(만들어졌거나 빠진 것)은 줄에서 뺍니다
    for c in [c for c in 표 if c not in 있는것]:
        표.pop(c, None)
    try:
        대기파일.parent.mkdir(parents=True, exist_ok=True)
        대기파일.write_text(json.dumps(표, ensure_ascii=False, indent=1), encoding="utf-8")
    except Exception:
        pass
    return 표
스카우트주소 = 사이트주소() + '/api/screener/latest'
셋업주소 = 사이트주소() + '/api/setup'
제외파일 = ROOT / "제작제외.txt"


def 손으로_뺀것():
    """제작제외.txt 에 적힌 종목. 한 줄에 하나, # 뒤는 설명."""
    뺄것 = {}
    if not 제외파일.exists():
        return 뺄것
    for 줄 in 제외파일.read_text(encoding="utf-8").splitlines():
        몸 = 줄.split("#")[0].strip()
        if 몸:
            뺄것[몸.upper()] = 줄.split("#", 1)[1].strip() if "#" in 줄 else ""
    return 뺄것


def _숫자(v):
    try:
        return float(str(v).replace(",", ""))
    except Exception:
        return None


def 스카우트문턱넘은것():
    """오늘 스카우트에서 시장별 문턱을 넘은 종목 {코드: (이름, 점수, 시장)}."""
    뽑음, 때 = {}, {}
    for 시장 in ("KR", "US"):
        주소 = 스카우트주소 + ("?market=US" if 시장 == "US" else "")
        try:
            요청 = urllib.request.Request(주소, headers={"User-Agent": "TM26"})
            with urllib.request.urlopen(요청, timeout=90) as 답:
                자료 = json.loads(답.read().decode())
        except Exception as e:
            print(f"  [오류] {시장} 스카우트 목록을 못 받았습니다({e})")
            continue
        문턱 = 점수문턱[시장]
        for r in 자료.get("result") or []:
            if r.get("제외사유") or r.get("부적합사유"):
                continue
            점 = _숫자(r.get("종합점수"))
            if 점 is None or 점 < 문턱:
                continue
            코드 = str(r.get("코드") or "").strip().upper()
            if 시장 == "KR":
                코드 = 코드.zfill(6)
            뽑음[코드] = (str(r.get("종목명") or "").strip(), 점, 시장)
        때[시장] = 자료.get("stamp")
    return 뽑음, 때


def 셋업있는것():
    """오늘 [셋업] 탭에서 '셋업 있음'(state == setup)인 종목 {코드: (이름, 점수, 시장)}."""
    뽑음, 때 = {}, {}
    for 시장 in ("KR", "US"):
        주소 = 셋업주소 + "?market=" + 시장
        try:
            요청 = urllib.request.Request(주소, headers={"User-Agent": "TM26"})
            with urllib.request.urlopen(요청, timeout=180) as 답:
                자료 = json.loads(답.read().decode())
        except Exception as e:
            # 조용히 비면 그날 그 시장이 통째로 빠집니다. 시끄럽게 알립니다.
            print(f"  [오류] {시장} 셋업 목록을 못 받았습니다({e})")
            continue
        for r in 자료.get("rows") or []:
            if r.get("state") != "setup":
                continue
            코드 = str(r.get("code") or "").strip().upper()
            if not 코드:
                continue
            if 시장 == "KR":
                코드 = 코드.zfill(6)
            뽑음[코드] = (str(r.get("name") or "").strip(), _숫자(r.get("score")) or 0, 시장)
        때[시장] = 자료.get("stamp")
    return 뽑음, 때


요청주소 = 사이트주소() + '/api/research/request'


def _키():
    k = os.environ.get("SCREENER_KEY", "").strip()
    if k:
        return k
    env = ROOT / ".env"
    if env.exists():
        for 줄 in env.read_text(encoding="utf-8", errors="ignore").splitlines():
            if 줄.strip().startswith("SCREENER_KEY"):
                return 줄.split("=", 1)[1].strip().strip('"').strip("'")
    p = pathlib.Path.home() / ".tm26_key"
    return p.read_text(encoding="utf-8").strip() if p.exists() else ""


def 리포트요청():
    """리서치에서 사람이 누른 [리포트 요청] 중 대기 중인 것 {코드: 이름} (2026-10-16).

    정원 밖으로 만들고, 텔레그램에는 보내지 않습니다.
    """
    try:
        요청 = urllib.request.Request(요청주소, headers={"User-Agent": "TM26", "x-screener-key": _키()})
        with urllib.request.urlopen(요청, timeout=60) as 답:
            자료 = json.loads(답.read().decode())
    except Exception as e:
        print(f"  [오류] 리포트 요청 목록을 못 받았습니다({e})")
        return {}
    뽑음 = {}
    for r in 자료.get("requests") or []:
        코드 = str(r.get("code") or "").strip().upper()
        if 코드:
            뽑음[코드] = str(r.get("name") or 코드).strip()
    return 뽑음


def 요청닫기(코드, 상태, 메모=""):
    """요청을 끝냅니다 — done(만들어 둠) / rejected(못 만듦)."""
    try:
        몸 = json.dumps({"code": 코드, "status": 상태, "note": 메모}).encode()
        요청 = urllib.request.Request(요청주소, data=몸, method="PATCH",
                                    headers={"User-Agent": "TM26", "x-screener-key": _키(),
                                             "Content-Type": "application/json"})
        urllib.request.urlopen(요청, timeout=60).read()
    except Exception as e:
        print(f"  [오류] 요청 {코드} 를 닫지 못했습니다({e})")


코드키 = ("종목코드","코드","code","Code","CODE","티커","ticker","Ticker","심볼","symbol")
이름키 = ("종목명","이름","회사명","name","Name","종목")
본 = {}
for f in 파일들:
    with f.open(encoding="utf-8-sig") as fp:
        for row in csv.DictReader(fp):
            c = next((str(row[k]).strip().strip('"') for k in 코드키 if row.get(k)), "")
            n = next((str(row[k]).strip().strip('"') for k in 이름키 if row.get(k)), "") or c
            if c and not c.startswith("#"):
                본.setdefault(c.upper(), n)

워치코드 = set(본)          # 스카우트를 더하기 전의 워치리스트
스카우트, 스카우트때 = 스카우트문턱넘은것()
셋업, 셋업때 = 셋업있는것()
셋업코드 = set(셋업)
for c, v in 셋업.items():          # 둘 다에 들면 셋업 몫 — 점수는 스카우트 쪽을 남깁니다
    스카우트.setdefault(c, v)
점수 = {c: v[1] for c, v in 스카우트.items()}
for c, (n, _, _) in 스카우트.items():
    본.setdefault(c.upper(), n)
요청 = 리포트요청()
요청코드 = set(요청)
for c, n in 요청.items():
    본.setdefault(c, n)

if not 본:
    print("  ⚠ 관심종목 CSV 를 찾지 못했습니다.")
    sys.exit(9)

# ── 이미 만든 것 / 자료가 있는 것
# 2026-09-08 고침 — 예전에는 보고서가 한 번이라도 있으면 영원히 '있음' 이었다.
#  그래서 워치리스트를 한 바퀴 다 돌고 나면 그 뒤로는 자동제작이 늘 '만들 것 0' 으로 끝났다.
#  이제 **만든 날짜**를 본다. 재제작일수(기본 14일)가 지난 보고서는 다시 만든다.
#  2026-09-28 — 14일 → **30일**. 「1개월 이내 제작된 것은 취소하고 다음에」 지시.
재제작일수 = int(os.environ.get("REMAKE_DAYS", "20"))
지금 = time.time()

#  2026-09-21 고침 — 예전에는 PDF 의 **파일 수정시각(mtime)** 으로 나이를 쟀다.
#   그런데 보고서는 만들고 나서도 손이 닿는다 — 수정 요청 반영, 다시 조판, 복사.
#   그때마다 mtime 이 오늘로 되돌아가 **보고서가 저절로 젊어졌다.**
#   실제로 101개 중 24개가 파일명 날짜와 3~9일 어긋나 있었다
#   (CareDx 9/08자가 9/17로, 티에스이 9/08자가 9/17로…).
#   결과 — 14일 갱신 주기가 그만큼 밀린다. 더 나쁜 것은 **수정 왕복을 도는 보고서**다.
#   고칠 때마다 mtime 이 갱신돼 나이가 영영 14일을 못 넘고, 그 종목은
#   자동제작에서 **영구히 빠진다.** 그래서 파일 이름에 적힌 **보고서 날짜**를 본다.
#   (이름에 날짜가 없는 옛 파일만 mtime 으로 물러선다)
오늘 = dt.date.today()
만든날 = {}      # 종목코드 → 가장 최근 '보고서 날짜'

for p in (ROOT / "report").glob("*.pdf"):
    k = 보고서코드(p)
    if k:
        d = 보고서날짜(p)
        만든날[k] = max(만든날.get(k, dt.date(2000, 1, 1)), d)

def 며칠전(코드):
    """이 종목 보고서를 만든 지 며칠 됐나. 없으면 None."""
    d = 만든날.get(코드)
    return None if not d else (오늘 - d).days

def 자료있음(코드):
    return any((d / "datapack.md").exists() for d in (ROOT / "out").glob(f"{코드}_*"))

뺀것 = 손으로_뺀것()
# 2026-10-27 사용자 지시: 국내 미커버 종목을 제외하던 조건 폐지.
# 공시·IR 수집 여부와 기존 중복/제작제외 기준으로만 후보를 판정합니다.

줄 = []          # (코드, 이름, 상태)  상태: 있음 / 갱신 / 준비됨 / 자료없음 / 뺀것
for 코드, 이름 in 본.items():
    나이 = 며칠전(코드)
    if 코드 in 뺀것:
        상태 = "뺀것"
    elif 나이 is not None and 나이 <= 재제작일수:
        상태 = "있음"
    elif 나이 is not None:
        상태 = "갱신" if 자료있음(코드) else "자료없음"
    elif 자료있음(코드):
        상태 = "준비됨"
    else:
        상태 = "자료없음"
    줄.append((코드, 이름, 상태))

기본대상 = [(c, n) for c, n, s in 줄 if s in ("준비됨", "갱신")]

def 텔레그램대상_적기(코드들):
    """이번에 셋업 몫으로 만들 종목을 적어 둡니다. 자동검토.py 가 게시 때 이것만 카드 대기에 올립니다.

    제작은 다음 날로 밀릴 수 있어 14일치를 남깁니다 (2026-10-16).
    """
    try:
        표 = json.loads(텔레그램대상파일.read_text(encoding="utf-8"))
    except Exception:
        표 = {}
    for c in 코드들:
        표[c] = str(dt.date.today())
    끝 = str(dt.date.today() - dt.timedelta(days=14))
    표 = {c: d for c, d in 표.items() if d >= 끝}
    try:
        텔레그램대상파일.parent.mkdir(parents=True, exist_ok=True)
        텔레그램대상파일.write_text(json.dumps(표, ensure_ascii=False, indent=1), encoding="utf-8")
    except Exception as e:
        print(f"  [오류] 텔레그램 대상을 못 적었습니다({e})")


def 저장(대상):
    pathlib.Path("제작목록.txt").write_text(
        "\n".join(f"{c},{n}" for c, n in 대상) + "\n", encoding="utf-8")

# ── 수집이 필요한 종목만 찍는다 (자동제작.sh 가 collect.py 에 넘긴다)
#   2026-09-28 — 스카우트 80점 종목은 워치리스트에 없어 **자료가 없습니다.**
#   자료가 없으면 아무리 대상에 들어도 만들 수 없으니, 제작 전에 먼저 모읍니다.
#   이미 자료가 있거나 뺀 종목은 넘기지 않습니다(헛수고를 줄입니다).
if "--수집대상" in 인자:
    #  자료가 없는 것을 모두 넘기면 한 번에 수십 종목이라 실행이 길어집니다.
    #  제작은 하루 상한이 있으니 수집도 그 두 배까지만 — 점수 높은 것부터.
    #  (오늘 모아 두면 내일 제작 후보가 됩니다. 며칠이면 따라잡습니다)
    #  2026-09-30 — 수집도 **시장별 몫**을 따릅니다. 통째로 점수 순으로 자르면
    #   미국이 수집까지 독차지해 한국은 자료가 없어 또 못 만듭니다(그날 겪은 일).
    #   제작 몫의 두 배까지 모아 둡니다 — 오늘 모으면 내일 후보가 됩니다.
    대기 = 대기표_읽기()
    없는것 = [(c, n) for c, n, st in 줄 if st == "자료없음"]
    for c, n in 없는것:
        if c in 요청코드:
            print(c)             # 리포트 요청은 정원 밖 — 늘 모읍니다
    없는것 = [x for x in 없는것 if x[0] not in 요청코드]
    없는것.sort(key=lambda x: (0 if x[0] in 워치코드 else 1,
                             0 if x[0] in 셋업코드 else 1,
                             (대기.get(x[0]) or {}).get("since", "9999-99-99"),
                             -(점수.get(x[0]) or 0)))
    남은 = {k: (v + 셋업상한.get(k, 0)) * 2 for k, v in 시장상한.items()}
    for c, n in 없는것:
        m = 시장의(c)
        if 남은.get(m, 0) > 0:
            남은[m] -= 1
            print(c)
    sys.exit(0)

# ── 종목코드를 직접 준 경우
if 지정:
    대상 = [(c, 본[c]) for c in 지정 if c in 본]
    없음 = [c for c in 지정 if c not in 본]
    if 없음:
        print("  ⚠ 워치리스트에 없는 코드:", ", ".join(없음))
    if not 대상:
        print("  만들 종목이 없습니다.")
        sys.exit(9)
    print(f"  직접 고른 {len(대상)}종목을 만듭니다 (이미 있어도 다시 만듭니다)")
    for c, n in 대상:
        print(f"       {c:<8s} {n}")
    저장(대상)
    sys.exit(0)

# ── 자동 실행
if 자동:
    새것 = sum(1 for *_, s in 줄 if s == "준비됨")
    낡음 = sum(1 for *_, s in 줄 if s == "갱신")
    for 시장 in ("KR", "US"):
        if 스카우트때.get(시장):
            몇 = sum(1 for c, v in 스카우트.items() if v[2] == 시장 and c not in 셋업코드)
            print(f"  스카우트 {시장} {스카우트때[시장]} · {점수문턱[시장]:.0f}점 이상 {몇}종목")
        if 셋업때.get(시장):
            몇 = sum(1 for v in 셋업.values() if v[2] == 시장)
            print(f"  셋업 {시장} {셋업때[시장]} · 셋업 있음 {몇}종목 (텔레그램용)")
    if 요청코드:
        print(f"  리포트 요청 {len(요청코드)}종목: " + ", ".join(sorted(요청코드)))
    print(f"  후보 {len(본)}종목 (워치리스트 + 스카우트 + 셋업 있음 + 요청) · "
          f"최근 {재제작일수}일 안에 만든 것 {sum(1 for *_, s in 줄 if s=='있음')}종목")
    뺌 = [(c, n) for c, n, s in 줄 if s == "뺀것"]
    if 뺌:
        print(f"  · 손으로 뺀 종목 {len(뺌)}개: "
              + ", ".join(f"{c}({n})" for c, n in 뺌))
    #  줄 세우기 — ① 워치리스트(사람이 고른 것) ② **최근에 올라온 것** ③ 점수 높은 것
    #
    #  2026-10-01 지시로 ②가 뒤집혔습니다. 전에는 먼저 기다린 것을 앞에 뒀는데
    #  (오래 기다린 종목이 영영 차례를 못 받는 것을 막으려던 것), 사용자가
    #  「밀렸으면 이전 것보다 최근 게 더 중요하다」고 정했습니다.
    #  스카우트는 지금 자리를 잡은 종목을 집어내는 것이니, 2주 전에 걸린 신호보다
    #  오늘 걸린 신호가 쓸모 있다는 뜻입니다.
    #  ※ 바뀐 점 — 오래 밀린 종목은 더 밀릴 수 있습니다. 다만 스카우트 목록에서
    #    빠지면 대기표에서도 지워지므로 영원히 쌓이지는 않습니다.
    대기 = 대기표_맞추기(기본대상)
    def 앞자리(항목):
        c, _ = 항목
        return (0 if c in 요청코드 else 1,
                0 if c in 워치코드 else 1,
                0 if c in 셋업코드 else 1,
                그날뒤집기((대기.get(c) or {}).get("since", "0000-00-00")),
                -(점수.get(c) or 0))
    차례 = sorted(기본대상, key=앞자리)
    #  시장마다 제 몫만큼 위에서부터 담습니다
    남은몫 = dict(시장상한)
    남은셋업 = dict(셋업상한)
    오늘치, 밀린것 = [], []
    for c, nm in 차례:
        #  2026-10-01 지시 — **워치리스트는 하루 정원에 넣지 않습니다.**
        #  사람이 직접 고른 목록이라 스카우트가 밀어내서는 안 됩니다.
        #  정원(스카우트 시장별 10 · 셋업 시장별 5)은 따로 셉니다 (2026-10-16).
        if c in 워치코드 or c in 요청코드:      # 리포트 요청도 정원 밖 (2026-10-16)
            오늘치.append((c, nm))
            continue
        m = 시장의(c)
        if c in 셋업코드:
            if 남은셋업.get(m, 0) > 0:
                남은셋업[m] -= 1
                오늘치.append((c, nm))
            else:
                밀린것.append((c, nm))
        elif 남은몫.get(m, 0) > 0:
            남은몫[m] -= 1
            오늘치.append((c, nm))
        else:
            밀린것.append((c, nm))
    print(f"  ▶ 만들 종목 {len(차례)}종목 (새 종목 {새것} · {재제작일수}일 지나 갱신 {낡음})")
    몫글 = " · ".join(f"{k} 스카우트 {v} · 셋업 {셋업상한[k]}개" for k, v in 시장상한.items())
    if 밀린것:
        print(f"  · 하루 상한 {몫글} — 오늘 {len(오늘치)}개를 만들고 "
              f"{len(밀린것)}종목은 다음 실행으로 넘깁니다 (최근 것부터 만듭니다)")
        for c, nm in 밀린것[:8]:
            d = (대기.get(c) or {}).get("since", "")
            print(f"       (대기) {c:<8s} {nm[:22]}{'  ' + d if d else ''}")
        if len(밀린것) > 8:
            print(f"       (대기) … 그 밖 {len(밀린것) - 8}종목")
    for c, n in 오늘치:
        점 = 점수.get(c)
        표 = "  [리포트 요청]" if c in 요청코드 else ("  [셋업·텔레그램]" if c in 셋업코드 else "")
        print(f"       {c:<8s} {n}" + (f"  ({점:.1f}점)" if 점 else "  (워치리스트)") + 표)
    기본대상 = 오늘치
    #  2026-09-21 — 자료없음 종목은 **아무 말 없이** 빠지고 있었다.
    #   사람이 고를 때는 「자료없음」으로 보이는데 자동 실행에서는 한 줄도 안 남아,
    #   수집이 실패한 종목이 조용히 몇 주씩 제작에서 빠져도 알 길이 없었다.
    #   무인 실행에서 조용한 누락이 가장 위험하다 — 이름을 찍는다.
    못만듦 = [(c, n) for c, n, s in 줄 if s == "자료없음"]
    if 못만듦:
        print(f"  ⚠ 자료가 없어 빠지는 종목 {len(못만듦)}개"
              f" — '0_지금_수집하기' 를 먼저 돌리세요")
        for c, n in 못만듦:
            print(f"       {c:<8s} {n}")
    if not 세기만:                 # --count 는 세기만 한다.
        저장(기본대상)
        텔레그램대상_적기([c for c, _ in 기본대상 if c in 셋업코드 and c not in 요청코드])
        #  요청 닫기 — 이미 만들어 둔 것(최근 재제작일수 안)은 done, 제작제외에 적힌 것은 rejected
        for c, n, st in 줄:
            if c in 요청코드 and st == "있음":
                요청닫기(c, "done")
                print(f"  · 리포트 요청 완료 처리: {c}({n})")
            elif c in 요청코드 and st == "뺀것":
                요청닫기(c, "rejected", "제작 제외 목록")
                print(f"  · 리포트 요청 거절(제작 제외): {c}({n})")               # 돌고 있는 제작의 목록을 건드리면 안 된다.
    sys.exit(0 if 기본대상 else 9)

# ── 사람이 고른다
표시 = {"있음": "✔ 있음   ", "준비됨": "· 만들 것", "갱신": "↻ 갱신   ",
        "자료없음": "  자료없음", "뺀것": "  뺀 종목 "}
print()
print("  ── 관심목록 ──────────────────────────────────────────")
for i, (c, n, s) in enumerate(줄, 1):
    print(f"   {i:>2}. [{표시[s]}]  {c:<8s} {n[:34]}")
print("  ──────────────────────────────────────────────────────")
print(f"   ✔ 있음 = 최근 {재제작일수}일 안에 만든 것 · · 만들 것 = 아직 없는 것"
      f" · ↻ 갱신 = {재제작일수}일이 지난 것  (합쳐 {len(기본대상)}종목)")
print("     자료없음 = 수집이 안 돼 지금은 못 만드는 것")
print()
print("   그냥 Enter  →  아직 없는 것 전부")
print("   번호 입력   →  그 종목만 (여러 개는 띄어쓰기·쉼표, 범위는 3-7)")
print("                  이미 만든 종목도 번호로 고르면 다시 만듭니다")
print("   a          →  관심목록 전부 다시")
print("   q          →  취소")
print()
try:
    답 = input("   골라 주세요 : ").strip()
except (EOFError, KeyboardInterrupt):
    print("\n  취소했습니다.")
    sys.exit(1)

if 답.lower() == "q":
    print("  취소했습니다.")
    sys.exit(1)

if 답 == "":
    대상 = 기본대상
elif 답.lower() == "a":
    대상 = [(c, n) for c, n, s in 줄 if s != "자료없음"]
else:
    뽑은 = []
    for 조각 in 답.replace(",", " ").split():
        if "-" in 조각 and not 조각.startswith("-"):
            시, 끝 = 조각.split("-", 1)
            try:
                뽑은 += list(range(int(시), int(끝) + 1))
            except ValueError:
                print(f"  ⚠ 못 알아듣는 입력: {조각}")
        else:
            try:
                뽑은.append(int(조각))
            except ValueError:
                print(f"  ⚠ 못 알아듣는 입력: {조각}")
    본것 = []
    for i in 뽑은:
        if 1 <= i <= len(줄):
            c, n, s = 줄[i - 1]
            if s == "자료없음":
                print(f"  ⚠ {c} {n} — 자료가 없어 건너뜁니다. '0_지금_수집하기' 를 먼저 돌리세요.")
                continue
            if (c, n) not in 본것:
                본것.append((c, n))
        else:
            print(f"  ⚠ 그런 번호는 없습니다: {i}")
    대상 = 본것

if not 대상:
    print("  만들 종목이 없습니다.")
    sys.exit(9)

print()
print(f"  ▶ 만들 종목 {len(대상)}종목")
for c, n in 대상:
    print(f"       {c:<8s} {n}")
저장(대상)
sys.exit(0)
