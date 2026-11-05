#!/bin/bash
# 기업분석리포트 앱의 알맹이. 모든 작업을 앱 대화상자 안에서 한다.
# 오래 걸리는 일(수집·제작)은 뒤에서 돌리고, 진행 상황은 메뉴와 「진행 상황 보기」로 확인한다.
cd "$(dirname "$0")" || exit 1
ROOT="$(pwd)"
mkdir -p 로그 report 백업 2>/dev/null

PY=/usr/bin/env

say() {
  osascript >/dev/null 2>&1 <<AS
tell application "System Events" to activate
display alert "$1" message "$2" as informational
AS
}

ask_yes() {   # 예/아니오 — 예면 0
  osascript >/dev/null 2>&1 <<AS
tell application "System Events" to activate
display alert "$1" message "$2" buttons {"아니오", "예"} default button "예"
if button returned of result is "아니오" then error number -128
AS
}

돌고있나() {   # 제작이 도는 중이면 0
  [ -f 제작중.lock ] && kill -0 "$(cat 제작중.lock 2>/dev/null)" 2>/dev/null
}
수집중인가() {
  [ -f 수집중.lock ] && kill -0 "$(cat 수집중.lock 2>/dev/null)" 2>/dev/null
}

상태줄() {
  local NPDF NLEFT AM AC EXTRA PROG
  NPDF=$(ls -1 report/*.pdf 2>/dev/null | wc -l | tr -d ' ')
  NLEFT=$($PY python3 종목고르기.py --auto 2>/dev/null | grep "만들 종목" | grep -oE '[0-9]+' | head -1)
  [ -z "$NLEFT" ] && NLEFT=0
  launchctl list 2>/dev/null | grep -q com.jun.stockreport.make && AM="켜짐" || AM="꺼짐"
  launchctl list 2>/dev/null | grep -q com.jun.stockreport.collect && AC="켜짐" || AC="꺼짐"
  EXTRA=""
  if 돌고있나; then
    PROG=$(grep -E '^\[[0-9:]+\] (▶|✔|=|⚠|✗|⏸|↻)' 로그/제작진행.log 2>/dev/null | tail -1 | cut -c1-58)
    EXTRA="
▶ 제작 중  ${PROG}"
  fi
  수집중인가 && EXTRA="$EXTRA
▶ 자료 수집 중"
  [ -f 일시정지.flag ] && EXTRA="$EXTRA
⏸ 일시정지 걸려 있음"
  printf '보고서 %s건 · 아직 안 만든 종목 %s개\n자동 제작(평일 12:30) %s · 아침 수집(11:00) %s%s' \
    "$NPDF" "$NLEFT" "$AM" "$AC" "$EXTRA"
}

목록띄우기() {   # $1 제목 / $2 설명 / $3 항목들(줄바꿈) / $4 OK버튼 / $5 다중선택(yes면)
  local ITEMS MULTI
  ITEMS=$(printf '%s' "$3" | grep -v '^$' | sed 's/\\/\\\\/g; s/"/\\"/g; s/.*/"&"/' | paste -sd, -)
  [ -z "$ITEMS" ] && return 1
  if [ "$5" = "yes" ]; then MULTI="with multiple selections allowed"; else MULTI=""; fi
  osascript 2>/dev/null <<AS
tell application "System Events" to activate
set r to choose from list {$ITEMS} with title "$1" with prompt "$2" OK button name "$4" cancel button name "닫기" $MULTI
if r is false then return ""
set out to ""
repeat with x in r
  set out to out & x & linefeed
end repeat
return out
AS
}

# ── 뒤에서 돌리기 ────────────────────────────────────────────────
제작시작() {   # $1 = 목록파일
  nohup /bin/bash -c "
    cd '$ROOT'
    command -v caffeinate >/dev/null 2>&1 && caffeinate -ims -w \$\$ &
    . ./제작엔진.sh
    run_all '$1' \"\${MAKE_JOBS:-2}\"
  " > 로그/제작진행.log 2>&1 &
  disown 2>/dev/null
}

수집시작() {
  nohup /bin/bash -c "
    cd '$ROOT'
    echo \$\$ > 수집중.lock
    command -v caffeinate >/dev/null 2>&1 && caffeinate -ims -w \$\$ &
    $PY python3 -u collect.py
    rm -f 수집중.lock
  " > 로그/수집진행.log 2>&1 &
  disown 2>/dev/null
}

# ── 메뉴 ────────────────────────────────────────────────────────
while : ; do
  ST="$(상태줄)"
  PICK=$(목록띄우기 "기업분석 리포트" "$ST" \
"보고서 보기
보고서 만들기
자료 수집하기
진행 상황 보기
증권사 리포트 넣기
관심종목 보기·고치기
관심종목 파일 넣기
일시정지
이어서 제작
자동 제작 켜기 (평일 12:30)
자동 제작 끄기
아침 수집 자동실행 켜기 (11:00)
아침 수집 자동실행 끄기
보고서 폴더 열기
기록 폴더 열기
문제 진단" "실행")
  PICK="${PICK%$'\n'}"
  [ -z "$PICK" ] && exit 0

  case "$PICK" in

  "보고서 보기")
    ROWS3=$($PY python3 - <<'PYX' 2>&1
import pathlib, re, unicodedata as u
def nfc(x): return u.normalize("NFC", x or "")
파일 = sorted(pathlib.Path("report").glob("*.pdf"),
            key=lambda p: p.stat().st_mtime, reverse=True)
if not 파일:
    print("NONE"); raise SystemExit(0)
본 = {}
for p in 파일:
    조각 = nfc(p.stem).split("_")
    종목 = 조각[0] if 조각 else nfc(p.stem)
    코드 = 조각[1] if len(조각) > 1 else ""
    날짜 = ""
    m = re.search(r"(20\d\d[.\-]\d\d[.\-]\d\d)", nfc(p.stem))
    if m: 날짜 = m.group(1)
    열쇠 = (코드 or 종목).upper()
    if 열쇠 in 본:
        본[열쇠][3] += 1                     # 같은 종목의 옛 판
        continue
    본[열쇠] = [종목, 코드, 날짜, 1]
for 종목, 코드, 날짜, n in 본.values():
    꼬리 = f"  (판 {n}개)" if n > 1 else ""
    print("%-22s %-8s %-11s%s" % (종목[:22], 코드[:8], 날짜, 꼬리))
PYX
)
    if [ "$ROWS3" = "NONE" ] || [ -z "$ROWS3" ]; then
      say "보고서가 없습니다" "「보고서 만들기」로 먼저 만들어 주세요."
      continue
    fi
    NP=$(printf '%s\n' "$ROWS3" | grep -c .)
    SEL3=$(목록띄우기 "보고서 ${NP}건 (최근 순)" "볼 보고서를 고르세요." "$ROWS3" "열기")
    SEL3="${SEL3%$'\n'}"
    [ -z "$SEL3" ] && continue
    KEY=$(printf '%s' "$SEL3" | awk '{print $1}')
    KEY2=$(printf '%s' "$SEL3" | awk '{print $2}')
    HOW3=$(목록띄우기 "$KEY $KEY2" "어떻게 여시겠습니까?" \
"PDF 로 보기
블로그용 낱장 이미지 폴더 열기
웹페이지(HTML)로 보기
이 종목 작업 폴더 열기" "열기")
    HOW3="${HOW3%$'\n'}"
    [ -z "$HOW3" ] && continue
    $PY python3 - "$KEY" "$KEY2" "$HOW3" <<'PYX'
import sys, os, pathlib, subprocess, unicodedata as u
def nfc(x): return u.normalize("NFC", x or "")
종목, 코드, 어떻게 = sys.argv[1], sys.argv[2], sys.argv[3]
찾을말 = [x for x in (코드, 종목) if x]
def 맞나(이름):
    n = nfc(이름).upper()
    return any(nfc(x).upper() in n for x in 찾을말)

pdf = None
for p in sorted(pathlib.Path("report").glob("*.pdf"),
                key=lambda p: p.stat().st_mtime, reverse=True):
    if 맞나(p.stem):
        pdf = p; break

폴더 = None
for d in pathlib.Path("out").iterdir() if pathlib.Path("out").is_dir() else []:
    if d.is_dir() and 맞나(d.name):
        폴더 = d; break

def 열기(x):
    if x and pathlib.Path(x).exists():
        subprocess.run(["open", str(x)]); return True
    return False

if 어떻게.startswith("PDF"):
    열기(pdf)
elif 어떻게.startswith("블로그"):
    이미지 = 폴더 / "이미지" if 폴더 else None
    if not 열기(이미지):
        열기(폴더)
elif 어떻게.startswith("웹페이지"):
    html = None
    if 폴더:
        후보 = sorted(폴더.glob("*.html"), key=lambda p: p.stat().st_mtime, reverse=True)
        후보 = [h for h in 후보 if not h.name.startswith("_")] or 후보
        html = 후보[0] if 후보 else None
    if not 열기(html):
        열기(pdf)
else:
    열기(폴더)
PYX
    ;;

  "보고서 만들기")
    if 돌고있나; then
      say "이미 만드는 중입니다" "「진행 상황 보기」로 어디까지 왔는지 확인하실 수 있습니다."
      continue
    fi
    ROWS=$($PY python3 - <<'PYX' 2>/dev/null
import sys, pathlib, unicodedata as u
sys.path.insert(0, ".")
import 워치리스트도구 as W
def nfc(x): return u.normalize("NFC", x or "")
본 = W.읽기()
만든 = set()
for p in pathlib.Path("report").glob("*.pdf"):
    for x in nfc(p.stem).split("_")[:3]:
        만든.add(x.upper())
def 자료(c):
    return any((d/"datapack.md").exists() for d in pathlib.Path("out").glob(f"{c}_*"))
for c, n in 본.items():
    s = "✔ 있음" if c in 만든 else ("· 만들 것" if 자료(c) else "  자료없음")
    print(f"[{s}]  {c:<8s} {n[:34]}")
PYX
)
    if [ -z "$ROWS" ]; then
      say "관심종목을 읽지 못했습니다" "「문제 진단」을 눌러 무엇이 막혔는지 확인해 주세요."
      continue
    fi
    SEL=$(목록띄우기 "만들 종목 고르기" "여러 개를 고르실 수 있습니다 (Command 키를 누른 채 클릭).
아무것도 안 고르고 「만들기」를 누르면 ‘· 만들 것’ 전부를 만듭니다.
‘✔ 있음’ 을 고르면 그 종목을 다시 만듭니다." "$ROWS" "만들기" "yes")
    [ -z "$SEL" ] && continue
    $PY python3 - "$SEL" <<'PYX'
import sys, re, pathlib, unicodedata as u
sys.path.insert(0, ".")
import 워치리스트도구 as W
def nfc(x): return u.normalize("NFC", x or "")
본 = W.읽기()
줄들 = [x for x in sys.argv[1].splitlines() if x.strip()]
고른 = []
for 줄 in 줄들:
    m = re.search(r"\]\s+(\S+)\s", 줄)
    if m and m.group(1).upper() in 본:
        고른.append(m.group(1).upper())
if not 고른:                       # 아무것도 안 골랐으면 '만들 것' 전부
    만든 = set()
    for p in pathlib.Path("report").glob("*.pdf"):
        for x in nfc(p.stem).split("_")[:3]:
            만든.add(x.upper())
    고른 = [c for c in 본
          if c not in 만든 and any((d/"datapack.md").exists()
                                 for d in pathlib.Path("out").glob(f"{c}_*"))]
pathlib.Path("제작목록.txt").write_text(
    "\n".join(f"{c},{본[c]}" for c in 고른), encoding="utf-8")
print(len(고른))
PYX
    N=$(grep -c . 제작목록.txt 2>/dev/null || echo 0)
    if [ "$N" -eq 0 ]; then say "만들 종목이 없습니다" "관심종목에 새로 넣거나, 먼저 「자료 수집하기」를 돌려 주세요."; continue; fi
    if ask_yes "${N}종목을 만들까요?" "$(head -12 제작목록.txt)

종목당 20~40분, 2개씩 나란히 만듭니다.
앱을 닫아도 계속 진행됩니다. 「진행 상황 보기」로 확인하세요."; then
      rm -f 일시정지.flag
      제작시작 "제작목록.txt"
      sleep 2
      say "시작했습니다" "뒤에서 돌고 있습니다. 메뉴 위쪽에 진행 상황이 표시됩니다."
    fi ;;

  "자료 수집하기")
    if 수집중인가; then say "이미 수집 중입니다" "「진행 상황 보기」로 확인하세요."; continue; fi
    if ask_yes "자료를 수집할까요?" "관심종목 전체의 공시·주가·재무 자료를 받아옵니다. 10~30분 걸립니다.
앱을 닫아도 계속 진행됩니다."; then
      수집시작
      sleep 2
      say "수집을 시작했습니다" "뒤에서 돌고 있습니다."
    fi ;;

  "진행 상황 보기")
    LINES=""
    if 돌고있나 || [ -s 로그/제작진행.log ]; then
      LINES="── 제작 ──
$(grep -E '^\[[0-9:]+\]' 로그/제작진행.log 2>/dev/null | tail -14)"
    fi
    if 수집중인가 || [ -s 로그/수집진행.log ]; then
      LINES="$LINES

── 수집 ──
$(tail -8 로그/수집진행.log 2>/dev/null)"
    fi
    [ -z "$LINES" ] && LINES="아직 돌린 작업이 없습니다."
    say "진행 상황" "$LINES" ;;

  "증권사 리포트 넣기")
    FILES=$(osascript 2>/dev/null <<'AS'
tell application "System Events" to activate
set fs to choose file with prompt "넣을 증권사 리포트 PDF 를 고르세요 (여러 개 가능)" of type {"pdf"} with multiple selections allowed
set out to ""
repeat with f in fs
  set out to out & POSIX path of f & linefeed
end repeat
return out
AS
)
    [ -z "$FILES" ] && continue
    RES=$(printf '%s' "$FILES" | grep -v '^$' | tr '\n' '\0' | xargs -0 $PY python3 리포트넣기.py 2>&1)
    printf '%s\n' "$RES" | grep '^UNMATCHED' | while IFS=$'\t' read -r _ PATHX WHY; do
      ROWS2=$($PY python3 -c "
import sys; sys.path.insert(0,'.')
import 워치리스트도구 as W
for c,n in W.읽기().items(): print(f'{c:<8s} {n}')" 2>/dev/null)
      SEL2=$(목록띄우기 "어느 종목인가요?" "$(basename "$PATHX")
$WHY" "$ROWS2" "넣기")
      [ -z "$SEL2" ] && continue
      CODE=$(printf '%s' "$SEL2" | head -1 | awk '{print $1}')
      $PY python3 리포트넣기.py --to "$CODE" "$PATHX" >/dev/null 2>&1
    done
    OKN=$(printf '%s' "$RES" | grep -c '^OK')
    say "리포트를 넣었습니다" "$(printf '%s' "$RES" | grep '^OK' | sed 's/^OK\t//' | head -12)

넣은 곳 : 입력_리포트PDF/<종목명>/
다음 제작 때 함께 읽습니다." ;;

  "관심종목 보기·고치기")
    INFO=$($PY python3 - <<'PYX' 2>&1
import sys
sys.path.insert(0, ".")
try:
    import 워치리스트도구 as W
    fs = W.csv파일들(); 본 = W.읽기()
except Exception as e:
    print("ERR " + str(e)); raise SystemExit(0)
if not 본:
    print("EMPTY"); raise SystemExit(0)
print("FILE " + str(fs[0]))
국내 = [(c, n) for c, n in 본.items() if c.isdigit()]
해외 = [(c, n) for c, n in 본.items() if not c.isdigit()]
for c, n in 국내 + 해외:
    print("ROW %-8s %s" % (c, n))
PYX
)
    if ! printf '%s' "$INFO" | grep -q '^ROW'; then
      say "관심종목을 읽지 못했습니다" "$INFO

「문제 진단」을 눌러 확인해 주세요."
      continue
    fi
    WF=$(printf '%s' "$INFO" | awk '/^FILE/{ $1=""; sub(/^ /,""); print }')
    NR=$(printf '%s' "$INFO" | grep -c '^ROW')
    RWS=$(printf '%s' "$INFO" | sed -n 's/^ROW //p')
    GO=$(목록띄우기 "관심종목 ${NR}개" "파일 : $WF
고치려면 「고치기」를 누르세요 (텍스트 편집기가 열립니다)." "$RWS" "고치기")
    if [ -n "$GO" ]; then
      open -e "$WF"
      say "편집기로 열었습니다" "한 줄에  \"코드\",\"종목명\",\"메모\",\"추가일\"  형식입니다.
고치고 저장하면 바로 반영됩니다. 지울 종목은 그 줄을 통째로 지우세요.
바꾸기 전 파일은 '백업' 폴더에 있습니다."
    fi ;;

  "관심종목 파일 넣기")
    WLFILE=$(osascript 2>/dev/null <<'AS'
tell application "System Events" to activate
set f to choose file with prompt "관심종목 파일을 고르세요 (csv · txt · xlsx)"
return POSIX path of f
AS
)
    [ -z "$WLFILE" ] && continue
    PREV=$($PY python3 관심종목_넣기.py --preview "$WLFILE" 2>&1)
    if printf '%s' "$PREV" | grep -q "하나도 알아보지"; then
      say "종목을 못 찾았습니다" "$PREV"; continue
    fi
    HOW=$(목록띄우기 "관심종목 파일 넣기" "$PREV" \
"더하기 — 겹치는 종목은 그대로 둔다
더하기 — 겹치는 종목은 새 파일 이름으로 바꾼다
갈아끼우기 — 이 파일에 없는 종목은 목록에서 뺀다" "저장")
    HOW="${HOW%$'\n'}"
    case "$HOW" in
      "더하기 — 겹치는 종목은 그대로 둔다")             OUT=$($PY python3 관심종목_넣기.py --add-keep "$WLFILE" 2>&1) ;;
      "더하기 — 겹치는 종목은 새 파일 이름으로 바꾼다")   OUT=$($PY python3 관심종목_넣기.py --add-update "$WLFILE" 2>&1) ;;
      "갈아끼우기 — 이 파일에 없는 종목은 목록에서 뺀다") OUT=$($PY python3 관심종목_넣기.py --replace "$WLFILE" 2>&1) ;;
      *) continue ;;
    esac
    say "관심종목을 저장했습니다" "$OUT" ;;

  "일시정지")
    touch 일시정지.flag
    say "일시정지했습니다" "지금 만들고 있는 종목은 끝까지 만든 뒤 멈춥니다 (20~40분 걸릴 수 있습니다).
다시 하시려면 「이어서 제작」을 누르세요." ;;

  "이어서 제작")
    rm -f 일시정지.flag
    if 돌고있나; then
      say "일시정지를 풀었습니다" "돌고 있던 제작이 다음 종목부터 이어서 진행합니다."
    else
      $PY python3 종목고르기.py --auto >/dev/null 2>&1
      N=$(grep -c . 제작목록.txt 2>/dev/null || echo 0)
      if [ "$N" -eq 0 ]; then say "만들 종목이 없습니다" "관심종목이 모두 만들어져 있습니다."; continue; fi
      if ask_yes "남은 ${N}종목을 이어서 만들까요?" "$(head -12 제작목록.txt)"; then
        제작시작 "제작목록.txt"; sleep 2
        say "이어서 시작했습니다" "뒤에서 돌고 있습니다."
      fi
    fi ;;

  "자동 제작 켜기 (평일 12:30)")
    PL="$HOME/Library/LaunchAgents/com.jun.stockreport.make.plist"
    mkdir -p "$HOME/Library/LaunchAgents"
    { echo '<?xml version="1.0" encoding="UTF-8"?>'
      echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
      echo '<plist version="1.0"><dict>'
      echo '  <key>Label</key><string>com.jun.stockreport.make</string>'
      echo '  <key>ProgramArguments</key><array><string>/bin/bash</string><string>-lc</string>'
      echo "  <string>cd '$ROOT' &amp;&amp; ./자동제작.sh &gt;&gt; '로그/자동제작.log' 2&gt;&amp;1</string></array>"
      echo '  <key>StartCalendarInterval</key><array>'
      for wd in 1 2 3 4 5; do
        echo "    <dict><key>Weekday</key><integer>$wd</integer><key>Hour</key><integer>12</integer><key>Minute</key><integer>30</integer></dict>"
      done
      echo '  </array><key>RunAtLoad</key><false/>'
      echo "  <key>StandardErrorPath</key><string>$ROOT/로그/자동제작.err</string>"
      echo '</dict></plist>'
    } > "$PL"
    launchctl unload "$PL" 2>/dev/null
    if launchctl load "$PL" 2>/dev/null; then
      say "자동 제작을 켰습니다" "평일 낮 12시 30분에 수집하고 보고서를 만듭니다.
그 시각에 맥이 켜져 있어야 합니다(잠자기는 괜찮습니다)."
    else
      say "등록에 실패했습니다" "「문제 진단」 결과를 보여 주세요."
    fi ;;

  "자동 제작 끄기")
    launchctl unload "$HOME/Library/LaunchAgents/com.jun.stockreport.make.plist" 2>/dev/null
    say "자동 제작을 껐습니다" "손으로 만드는 것은 그대로 쓰실 수 있습니다." ;;

  "아침 수집 자동실행 켜기 (11:00)")
    PL="$HOME/Library/LaunchAgents/com.jun.stockreport.collect.plist"
    mkdir -p "$HOME/Library/LaunchAgents"
    { echo '<?xml version="1.0" encoding="UTF-8"?>'
      echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
      echo '<plist version="1.0"><dict>'
      echo '  <key>Label</key><string>com.jun.stockreport.collect</string>'
      echo '  <key>ProgramArguments</key><array><string>/bin/bash</string><string>-lc</string>'
      echo "  <string>cd '$ROOT' &amp;&amp; /usr/bin/env python3 -u collect.py &gt;&gt; '로그/collect.log' 2&gt;&amp;1</string></array>"
      echo '  <key>StartCalendarInterval</key><array>'
      for wd in 1 2 3 4 5; do
        echo "    <dict><key>Weekday</key><integer>$wd</integer><key>Hour</key><integer>11</integer><key>Minute</key><integer>0</integer></dict>"
      done
      echo '  </array><key>RunAtLoad</key><false/>'
      echo "  <key>StandardErrorPath</key><string>$ROOT/로그/launchd.err</string>"
      echo '</dict></plist>'
    } > "$PL"
    launchctl unload "$PL" 2>/dev/null
    launchctl load "$PL" 2>/dev/null \
      && say "아침 수집을 켰습니다" "평일 오전 11시에 자료를 모읍니다." \
      || say "등록에 실패했습니다" "「문제 진단」 결과를 보여 주세요." ;;

  "아침 수집 자동실행 끄기")
    launchctl unload "$HOME/Library/LaunchAgents/com.jun.stockreport.collect.plist" 2>/dev/null
    say "아침 수집을 껐습니다" "필요하면 「자료 수집하기」로 손수 돌리시면 됩니다." ;;

  "기록 폴더 열기")   open 로그 ;;

  "문제 진단")
    DIAG=$( {
      echo "폴더        : $ROOT"
      echo -n "폴더 읽기   : "; ls -1 >/dev/null 2>&1 && echo "됨" || echo "막힘 → 전체 디스크 접근 권한 필요"
      echo -n "관심종목    : "
      $PY python3 -c "
import sys; sys.path.insert(0,'.')
import 워치리스트도구 as W
fs=W.csv파일들(); print((str(fs[0]) if fs else '못 찾음'), '· 종목', len(W.읽기()), '개')" 2>&1 | head -3
      echo -n "report PDF  : "; ls -1 report/*.pdf 2>/dev/null | wc -l | tr -d ' '
      echo -n "python3     : "; $PY python3 -V 2>&1
      echo -n "claude      : "; command -v claude 2>/dev/null || echo "PATH 에 없음"
      echo -n "제작 중     : "; 돌고있나 && echo "예" || echo "아니오"
    } 2>&1 )
    say "문제 진단" "$DIAG" ;;

  esac
done
