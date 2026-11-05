#!/bin/bash
# Codex 에게 낼 운영 점검 보고서를 만듭니다. (2026-09-14 신설)
#
#   ./코덱스보고.sh             협업/보고/<날짜>_운영점검.md 를 만들고 경로를 찍습니다
#   ./코덱스보고.sh --화면      파일을 만들지 않고 화면에만 찍습니다
#   ./코덱스보고.sh --날수 14   최근 14일을 봅니다 (기본 7일)
#
# 왜 필요한가
#   예약이 깨어나도 10초 만에 빈손으로 끝나는 실패가 있습니다(2026-09-08 ~).
#   그런데 종료코드가 0 이라 알림도 안 울리고 .err 도 비어 있어, 사람이 로그를
#   하나씩 펴 보기 전에는 모릅니다. 그 확인을 한 번에 하고 문서로 남깁니다.
#
#   판정 기준은 로그가 아니라 **산출물이 실제로 있는가** 입니다. 로그는 "왜"를 댈 때만 봅니다.
#   비밀값은 절대 찍지 않습니다 — `.env` 는 '있음/없음' 만 봅니다.
#
# ※ 셸 변수는 영문으로 씁니다 — 맥 기본 bash 3.2 가 한글 변수를 못 알아듣습니다.
set -u
cd "$(dirname "$0")" || exit 1

DAYS=7
TO_SCREEN=0
while [ $# -gt 0 ]; do
  case "$1" in
    --화면) TO_SCREEN=1; shift ;;
    --날수) DAYS="${2:-7}"; shift 2 ;;
    -h|--도움말) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "모르는 옵션입니다: $1"; exit 2 ;;
  esac
done

TODAY="$(TZ=Asia/Seoul date '+%Y-%m-%d')"
NOW="$(TZ=Asia/Seoul date '+%Y-%m-%d %H:%M')"
OUTDIR="협업/보고"
OUTFILE="$OUTDIR/${TODAY}_운영점검.md"

# 작업 이름 → 산출물 파일 앞머리. 이름이 서로 달라서 표를 만들려면 이 대조가 필요합니다.
out_prefix() {
  case "$1" in
    장전브리핑)   echo "장전브리핑" ;;
    시황전략)     echo "시황전략" ;;
    미국종목종합) echo "미국종합" ;;
    한국종목종합) echo "한국종합" ;;
    매매평가)     echo "매매평가" ;;
    컨퍼런스콜)   echo "컨퍼런스콜" ;;
    *) echo "" ;;
  esac
}
JOBS="장전브리핑 시황전략 미국종목종합 컨퍼런스콜 한국종목종합 매매평가"

# 로그에서 "날짜 시작 끝 종료코드 걸린초" 를 뽑습니다.
#   ===== 장전브리핑  2026-09-11 08:40:01 =====
#   끝 08:40:09  (종료코드 0)
runs_of() {
  [ -f "$1" ] || return 0
  awk '
    function secs(t,  a) { split(t, a, ":"); return a[1]*3600 + a[2]*60 + a[3] }
    /^===== / && NF >= 5 { d=$3; s=$4; have=1; next }
    /^끝 / && have {
      rc=$NF; gsub(/[()]/, "", rc)
      dur = secs($2) - secs(s); if (dur < 0) dur += 86400
      print d, s, $2, rc, dur
      have=0
    }
  ' "$1"
}

# 그날 그 작업의 산출물이 실제로 있는가
has_output() {                     # $1=날짜  $2=작업
  local pre; pre="$(out_prefix "$2")"
  [ -z "$pre" ] && return 1
  ls "브리핑/$1/${pre}_"* >/dev/null 2>&1
}

# 최근 DAYS 일 날짜 목록 (오래된 것부터)
dates_list() {
  local i=$DAYS
  while [ "$i" -ge 1 ]; do
    TZ=Asia/Seoul date -v-"$((i-1))"d '+%Y-%m-%d'
    i=$((i-1))
  done
}

보고서() {

echo "# 운영 점검 보고 — $TODAY"
echo
echo "\`./코덱스보고.sh\` 가 $NOW 에 만들었습니다. 최근 ${DAYS}일치입니다."
echo "판정은 로그가 아니라 \`브리핑/<날짜>/\` 에 산출물이 실제로 있는지로 합니다."
echo

# ── 1. 성적표 ────────────────────────────────────────────────
echo "## 1. 정기 작업 성적표"
echo
printf '| 날짜 |'; for j in $JOBS; do printf ' %s |' "$j"; done; echo
printf '|---|'; for j in $JOBS; do printf ':--:|'; done; echo

TOTAL=0; OK=0; EMPTY=0; EMPTY_LIST=""
for d in $(dates_list); do
  dow="$(TZ=Asia/Seoul date -j -f '%Y-%m-%d' "$d" '+%a' 2>/dev/null)"
  printf '| %s(%s) |' "${d#2026-}" "$dow"
  for j in $JOBS; do
    rec="$(runs_of "로그/${j}.log" | awk -v D="$d" '$1==D {print; exit}')"
    if has_output "$d" "$j"; then
      mark="○"; OK=$((OK+1)); TOTAL=$((TOTAL+1))
    elif [ -n "$rec" ]; then
      dur="$(printf '%s\n' "$rec" | awk '{print $5}')"
      TOTAL=$((TOTAL+1))
      if [ "$dur" -lt 90 ]; then
        mark="빈손"; EMPTY=$((EMPTY+1))
        EMPTY_LIST="$EMPTY_LIST
- **$d $j** — $(printf '%s\n' "$rec" | awk '{print $2}') 시작, ${dur}초 만에 종료코드 $(printf '%s\n' "$rec" | awk '{print $4}') 로 끝"
      else
        mark="✗"
      fi
    else
      mark="-"
    fi
    printf ' %s |' "$mark"
  done
  echo
done
echo
echo "○ 산출물 있음 · 빈손 = 90초 안에 끝남(사실상 아무것도 안 함) · ✗ 돌았는데 산출물 없음 · - 실행 기록 없음(휴일 등)"
echo
if [ "$TOTAL" -gt 0 ]; then
  echo "**성공 $OK / 실행 $TOTAL 건 ($((OK * 100 / TOTAL))%) · 빈손 종료 $EMPTY 건**"
else
  echo "**실행 기록이 없습니다.**"
fi
echo

# ── 2. 빈손 종료 ─────────────────────────────────────────────
echo "## 2. 빈손으로 끝난 실행"
echo
if [ -z "$EMPTY_LIST" ]; then
  echo "없습니다."
else
  echo "지시문을 받고도 「무엇을 도와드릴까요」로 끝난 것들입니다. **종료코드가 0 이라 알림이 울리지 않습니다.**"
  printf '%s\n' "$EMPTY_LIST"
fi
echo

# ── 3. 브리핑 발송 ───────────────────────────────────────────
echo "## 3. 브리핑 발송 (TM26_브리핑발송)"
echo
BLOG="$HOME/TM26_브리핑발송/로그/브리핑발송.log"
if [ ! -f "$BLOG" ]; then
  echo "발송 로그가 없습니다: \`$BLOG\`"
else
  echo "| 시각 | 갈래 | HTTP | 채널발송 | 남긴 문제 |"
  echo "|---|:--:|:--:|:--:|---|"
  awk -v N="$DAYS" '
    /^--- / { when=$2" "$3; kind=$4; http=""; errs=""; sent=""; next }
    /HTTP / {
      match($0, /HTTP [0-9]+/); http=substr($0, RSTART+5, RLENGTH-5)
      if (match($0, /"errors":\[[^]]*\]/)) { errs=substr($0, RSTART+10, RLENGTH-11) }
      if ($0 ~ /"sent":true/) sent="보냄"
      next
    }
    /채널 발송 완료/ { sent="보냄" }
    /^$/ && when != "" {
      if (sent == "") sent="저장만"
      gsub(/"/, "", errs); gsub(/\|/, "/", errs)
      if (errs == "") errs="—"
      lines[++n] = "| " when " | " kind " | " http " | " sent " | " errs " |"
      when=""
    }
    END { start = (n > N*5) ? n - N*5 + 1 : 1; for (i=start; i<=n; i++) print lines[i] }
  ' "$BLOG"
  echo
  BAD="$(grep -c "HTTP [^2]" "$BLOG" 2>/dev/null || true)"
  echo "HTTP 200 이 아닌 응답 누적 **${BAD:-0}건**. 마지막 기록 $(TZ=Asia/Seoul date -r "$BLOG" '+%Y-%m-%d %H:%M')."
fi
echo

# ── 4. 예약·설정 ─────────────────────────────────────────────
echo "## 4. 예약과 설정"
echo
# 2026-09-14 — 개수만 세면 **어느 것이 빠졌는지** 모릅니다. 이름까지 찍습니다.
#  이날 `stockreport.make`·`stockreport.watchlist` 둘이 내려간 채 반나절이 갔습니다.
#  수정 세션이 CLAUDE.md 의 「고치기 전에 unload」를 따르고 다시 load 하지 않은 탓입니다.
MISSING=""
NPLIST=0
for PL in ~/Library/LaunchAgents/com.jun*.plist; do
  [ -e "$PL" ] || continue
  NPLIST=$((NPLIST+1))
  LB="$(basename "$PL" .plist)"
  launchctl list 2>/dev/null | grep -q "	${LB}$" || MISSING="$MISSING $LB"
done
if [ -z "$MISSING" ]; then
  echo "- 예약 ${NPLIST}건 전부 launchd 에 올라와 있습니다"
else
  echo "- **예약이 내려가 있습니다:**$MISSING"
  echo "  → \`launchctl load ~/Library/LaunchAgents/<이름>.plist\` 로 올리십시오."
fi

ERRFILES="$(find 로그 "$HOME/TM26_브리핑발송/로그" -name '*.err' -size +0 2>/dev/null)"
if [ -z "$ERRFILES" ]; then
  echo "- \`.err\` 파일 전부 비어 있음 (launchd 단계 오류 없음)"
else
  echo "- **내용이 있는 \`.err\` 파일:** $(printf '%s' "$ERRFILES" | tr '\n' ' ')"
fi

# .env 는 이름만 봅니다. 값은 절대 찍지 않습니다.
for key in DART_API_KEY SCREENER_KEY TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID KIS_APP_KEY KIS_APP_SECRET; do
  if grep -qE "^${key}=." .env 2>/dev/null; then
    echo "- \`$key\` 있음"
  else
    echo "- \`$key\` **없음**"
  fi
done

for lock in 제작중.lock 워치자동.lock 수정중.lock; do
  [ -f "$lock" ] || continue
  pid="$(cat "$lock" 2>/dev/null)"
  if kill -0 "$pid" 2>/dev/null; then
    echo "- \`$lock\` — PID $pid 가 돌고 있습니다"
  else
    echo "- \`$lock\` — **주인 없는 잠금입니다(PID $pid 없음). 지워야 다음 작업이 돕니다.**"
  fi
done
echo

# ── 5. 검토대기 ──────────────────────────────────────────────
echo "## 5. Codex 검토대기 인계 파일"
echo
QUEUE="협업/검토대기"
if [ ! -d "$QUEUE" ]; then
  echo "인계 폴더가 없습니다."
else
  TOTALQ=0
  for st in 검토대기 수정요청 재검토대기 게시완료 "상태없음"; do
    if [ "$st" = "상태없음" ]; then
      c=$(grep -L '^[-*] *상태 *:' "$QUEUE"/*.md 2>/dev/null | wc -l | tr -d ' ')
    else
      c=$(grep -l "^[-*] *상태 *: *${st}" "$QUEUE"/*.md 2>/dev/null | wc -l | tr -d ' ')
    fi
    [ "${c:-0}" -gt 0 ] && { echo "- $st **${c}건**"; TOTALQ=$((TOTALQ+c)); }
  done
  echo "- 합계 $(ls -1 "$QUEUE"/*.md 2>/dev/null | wc -l | tr -d ' ')건"
  echo
  echo "가장 오래된 다섯 건:"
  ls -1 "$QUEUE"/*.md 2>/dev/null | head -5 | sed 's|^|  - `|; s|$|`|'
fi
echo

# ── 5-2. Codex 왕복 ──────────────────────────────────────────
echo "## 5-2. Codex 왕복 (검토 → 수정 → 재검토)"
echo
if [ ! -f 자동검토.sh ]; then
  echo "자동검토가 설치되어 있지 않습니다."
else
  echo "| 인계 | 상태 | 수정 회차 | 마지막 결과 |"
  echo "|---|:--:|:--:|---|"
  # 파일이름이 날짜로 시작하므로 이름 역순 = 최신순. 수정 시각으로 세우면 오늘 것이
  # 밀려나는 일이 생깁니다(Codex 가 옛 파일을 만지면 그쪽이 위로 올라옵니다).
  for f in $(ls -1 "$QUEUE"/*.md 2>/dev/null | sort -r | head -12); do
    b="$(basename "$f")"
    [ "$b" = "README.md" ] && continue
    st="$(sed 's/\*\*//g' "$f" | sed -n 's/^[-*] *상태 *: *//p' | head -1 | tr -d ' \r')"
    turns="$(grep -cE '^## Claude 반영 내역 .*회차' "$f" 2>/dev/null)"; turns="${turns:-0}"
    m="캐시/자동검토/corrections/${b%.md}.json"
    last="—"
    [ -f "$m" ] && last="$(sed -n 's/.*\"state\": *\"\([^\"]*\)\".*/\1/p' "$m" | head -1) ($(sed -n 's/.*\"attempts\": *\([0-9]*\).*/\1/p' "$m" | head -1)회)"
    echo "| ${b%.md} | ${st:-?} | $turns | $last |"
  done
  echo
  echo "최근 검토: $(grep -c '검토 시작' 로그/자동검토.log 2>/dev/null || echo 0)건 누적 · "\
       "마지막 $(tail -5 로그/자동검토.log 2>/dev/null | grep -oE '20[0-9-]{8}T[0-9:]{8}' | tail -1)"
  echo
  echo "최근 수정 반영:"
  grep '수정반영' 로그/자동수정.log 2>/dev/null | tail -5 | sed 's/^/  - /'
  grep -c '수정반영' 로그/자동수정.log >/dev/null 2>&1 || echo "  (아직 없습니다)"
fi
echo

# ── 6. 지금 도는 것 ──────────────────────────────────────────
echo "## 6. 지금 도는 것"
echo
# ※ `pgrep -fl` 을 그대로 찍으면 안 됩니다 — 도는 claude 의 인자에 지시문 전문이 들어 있어
#    보고서가 지시문으로 뒤덮입니다. ` -p ` 뒤를 잘라내고 이름만 남깁니다.
PIDS="$(pgrep -f '투자작업\.sh|워치리스트자동\.sh|자동제작\.sh|수정반영\.sh|collect\.py' 2>/dev/null || true)"
if [ -z "$PIDS" ]; then
  echo "없습니다."
else
  for p in $PIDS; do
    cmd="$(ps -p "$p" -o command= 2>/dev/null | tr '\n' ' ' | sed 's/ -p .*//; s|/Users/[^ ]*/||g')"
    et="$(ps -p "$p" -o etime= 2>/dev/null | tr -d ' ')"
    echo "  - PID $p · ${et} 째 · \`${cmd}\`"
  done
fi
CLI="$(pgrep -f '\.local/bin/claude' 2>/dev/null | wc -l | tr -d ' ')"
echo "  - claude 세션 ${CLI}개"
echo
echo "---"
echo "이 보고서는 기계가 셉니다. 판단과 조치는 Codex 몫입니다."

}

if [ "$TO_SCREEN" -eq 1 ]; then
  보고서
else
  mkdir -p "$OUTDIR"
  보고서 > "$OUTFILE"
  echo "만들었습니다: $OUTFILE"
fi
