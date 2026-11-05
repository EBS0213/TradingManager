#!/bin/bash
# Codex 의 수정 요청을 보고서에 반영합니다. (2026-09-08 신설)
#
#   ./수정반영.sh              「상태: 수정요청」인 것 전부 (동시 2개)
#   ./수정반영.sh <인계파일…>   지정한 것만 (상태를 따지지 않습니다)
#   ./수정반영.sh --목록        무엇이 대기 중인지 보여주고 끝냅니다
#
# 왜 필요한가
#   2026-09-08 부터 게시는 Codex 가 합니다. Codex 가 보고서를 검토하고
#   `협업/검토대기/<날짜>_<코드>.md` 의 「상태」를 `수정요청` 으로 바꾸면,
#   그 요청을 읽고 고칠 사람이 있어야 왕복이 돕니다. 그것이 없어서
#   요청이 파일에만 쌓이고 아무도 집어 가지 않았습니다.
#
# 한 인계 파일 = claude 세션 하나. 세션끼리는 서로 모릅니다.
# 끝나면 상태가 `재검토대기` 로 바뀌어 있어야 합니다. 그것이 성공 판정입니다.
#
# ※ 셸 변수는 영문으로 씁니다 — 맥 기본 bash 3.2 가 한글 변수를 못 알아듣습니다.
set -u
cd "$(dirname "$0")" || exit 1

QUEUE="${HANDOFF_DIR:-협업/검토대기}"   # 시험할 때만 HANDOFF_DIR 로 바꿉니다
JOBS="${FIX_JOBS:-2}"
LOCKFILE="수정중.lock"

[ -d "$QUEUE" ] || { echo "인계 폴더가 없습니다: $QUEUE"; exit 2; }

status_of() {          # $1 = 인계 파일. 「- 상태: XXX」 의 XXX 를 찍는다.
  sed 's/\*\*//g' "$1" | sed -n 's/^[-*] *상태 *: *//p' 2>/dev/null | head -1 | tr -d ' \r'
}

list_pending() {
  for f in "$QUEUE"/*.md; do
    [ -e "$f" ] || continue
    case "$(basename "$f")" in README.md) continue ;; esac
    [ "$(status_of "$f")" = "수정요청" ] && printf '%s\n' "$f"
  done
}

# ── --목록 : 보여주기만 ────────────────────────────────────
if [ "${1:-}" = "--목록" ]; then
  echo "  ── 인계 파일 상태 ──────────────────────────────"
  FOUND=0
  for f in "$QUEUE"/*.md; do
    [ -e "$f" ] || continue
    case "$(basename "$f")" in README.md) continue ;; esac
    FOUND=1
    printf '   %-14s %s\n' "$(status_of "$f")" "$(basename "$f")"
  done
  [ "$FOUND" = "0" ] && echo "   (인계 파일이 없습니다)"
  echo "  ────────────────────────────────────────────────"
  echo "   이 가운데 「수정요청」이 $(list_pending | grep -c .)건입니다."
  exit 0
fi

# ── 무엇을 고칠지 정하기 ───────────────────────────────────
TMPD="$(mktemp -d)"
KIDS=""; OWN_LOCK=0
# 2026-09-15: TERM 때 결과 폴더부터 지워 자식의 기록과 집계가 사라졌다.
# 시작한 작업이 끝날 때까지 잠금과 결과 폴더를 유지한다.
cleanup() {
  local kid
  trap '' INT TERM
  for kid in $KIDS; do wait "$kid" 2>/dev/null; done
  [ "$OWN_LOCK" = 0 ] || rm -f "$LOCKFILE"
  rm -rf "$TMPD"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
if [ "$#" -gt 0 ]; then
  for f in "$@"; do
    [ -s "$f" ] && printf '%s\n' "$f" >> "$TMPD/목록" \
      || echo "  ⚠ 그런 인계 파일이 없습니다: $f"
  done
else
  list_pending > "$TMPD/목록"
fi
[ -s "$TMPD/목록" ] || { echo "고칠 것이 없습니다. ($QUEUE 에 「상태: 수정요청」이 없습니다)"; exit 9; }
TOTAL=$(grep -c . "$TMPD/목록")

# ── 겹쳐 돌지 않게 ─────────────────────────────────────────
if [ -f "$LOCKFILE" ]; then
  OLDPID="$(cat "$LOCKFILE" 2>/dev/null)"
  if [ -n "$OLDPID" ] && kill -0 "$OLDPID" 2>/dev/null \
     && ps -p "$OLDPID" -o command= 2>/dev/null | grep -qE "수정반영|claude"; then
    echo "  ✗ 이미 수정 반영이 돌고 있습니다 (프로세스 $OLDPID)."
    exit 1
  fi
  rm -f "$LOCKFILE"
fi
# 제작이 돌고 있어도 **다른 종목**이면 비킬 까닭이 없습니다 (2026-09-14 고침).
#  예전에는 `제작중.lock` 만 보고 통째로 미뤘습니다. 워치리스트 제작이 몇 시간씩
#  걸리는 동안 수정 요청이 한 건도 처리되지 않아 열여덟 건이 밀렸습니다.
#  이제 **지금 만들고 있는 종목만** 건너뜁니다. 종목코드는 도는 claude 세션의
#  인자(「이번에 만들 종목」 바로 뒤)에서 읽습니다.
if [ -f 제작중.lock ] && kill -0 "$(cat 제작중.lock 2>/dev/null)" 2>/dev/null; then
  MAKING=""
  for P in $(pgrep -f "local/bin/claude" 2>/dev/null); do
    C="$(ps -p "$P" -o command= 2>/dev/null | grep -A3 '이번에 만들 종목'          | grep -oE '^[[:space:]]*[0-9A-Z]{1,6},' | tr -d ' ,' | head -1)"
    [ -n "$C" ] && MAKING="$MAKING $C"
  done
  # Codex는 프롬프트를 stdin으로 받으므로 실행기 PID별 기록으로 종목을 확인합니다.
  MAKING="$MAKING $(/usr/bin/python3 - <<'PYCODE'
import json, os
from pathlib import Path
for p in Path('캐시/코덱스제작중').glob('*.json'):
    try:
        r=json.loads(p.read_text()); os.kill(r['pid'],0); print(r['code'])
    except (OSError,ValueError,KeyError): pass
PYCODE
)"
  if [ -n "$MAKING" ]; then
    echo "  · 지금 만들고 있는 종목:$MAKING — 그것만 건너뜁니다."
    : > "$TMPD/목록2"
    while read -r F; do
      [ -n "$F" ] || continue
      SKIP=0
      N="$(basename "$F" .md)"; K="${N##*_}"
      for M in $MAKING; do [ "$K" = "$M" ] && SKIP=1; done
      [ "$SKIP" = "0" ] && printf '%s\n' "$F" >> "$TMPD/목록2"
    done < "$TMPD/목록"
    mv "$TMPD/목록2" "$TMPD/목록"
    [ -s "$TMPD/목록" ] || { echo "  · 고칠 것이 지금 만드는 종목뿐입니다. 다음에 부르십시오."; exit 0; }
    TOTAL=$(grep -c . "$TMPD/목록")
  fi
fi
echo $$ > "$LOCKFILE"
OWN_LOCK=1

# ── claude 찾기 — 제작엔진과 같은 방법을 씁니다 ─────────────
CLAUDE=""
. ./제작엔진.sh
if ! claude찾기; then
  echo "  ✗ 이 맥에서 Codex CLI 를 찾지 못했습니다."
  ./알림.sh "수정 반영을 시작하지 못했습니다" "Codex CLI 를 찾지 못했습니다" Basso 2>/dev/null
  exit 1
fi

mkdir -p 로그
command -v caffeinate >/dev/null 2>&1 && caffeinate -ims -w $$ &

echo "════════ 수정 반영 시작 $(date '+%F %T') ════════"
echo "  ${TOTAL}건 · 동시 ${JOBS}개 · Codex CLI: $CLAUDE"

fix_one() {
  local IDX="$1" HANDOFF="$2" TMPRES="$3"
  local NAME CODE LOG TRY PROMPT RC AFTER SAY
  NAME="$(basename "$HANDOFF" .md)"
  CODE="${NAME##*_}"                       # <날짜>_<코드>.md → 코드
  LOG="로그/수정_${CODE}.log"
  TRY=0

  # 사용자 최신 지시: Claude 직접 호출도 두 회차를 넘기지 않는다.
  . ./파이썬고르기.sh
  local NEXT_ACTOR
  NEXT_ACTOR="$("$PY3" -c 'import json,sys; from pathlib import Path; import 자동검토 as w; p=Path(sys.argv[1]).resolve(); m=w.CACHE/"corrections"/(p.stem+".json"); d=json.loads(m.read_text()) if m.exists() else {}; n=w.correction_count(p,d); print(w.correction_actor(max(0,n-1) if d.get("state")=="running" else n))' "$HANDOFF")"
  if [ "$NEXT_ACTOR" != "Claude" ]; then
    echo "  · $NAME — Claude 두 차례 이후의 수정은 Codex가 담당합니다."
    echo "FAIL" > "$TMPRES/$IDX"; return
  fi

  PROMPT="$(cat 제작지시.md)
$([ -f 지시문/_공통_문체기준.md ] && cat 지시문/_공통_문체기준.md)

## 지금 할 일 — 수정 요청 반영 (이 인계 파일 하나만)

인계 파일: \`${HANDOFF}\`

아래는 그 파일의 현재 내용입니다. Codex 가 검토하고 수정을 요청했습니다.

---
$("$PY3" 도구/인계간추리기.py "$HANDOFF")
---

**보고서를 새로 만들지 마십시오.** 이미 있는 산출물을 고치는 일입니다.

**다만 결론은 성역이 아닙니다 (2026-09-14 추가).** 산식과 결론이 어긋나면
**결론을 산식에 맞추십시오.** 목표주가·투자의견·가격대 해석을 바꾸는 것도 수정의 범위입니다.

셋 중 하나를 하십시오. 순서대로 먼저 되는 것을 고릅니다.

  ① 결론 숫자를 산식이 내놓는 값으로 **내리거나 올립니다.**
  ② 산식 밖의 가치를 주장하려면 **금액과 근거를 항목별로 분해해** 표에 적습니다.
     (예: 본업 ○○원 + 파이프라인 ○○원 + 반복수주 ○○원 = 목표가 ○○원)
  ③ 둘 다 못 하면 **그 결론을 빼십시오.**

**설명을 덧붙여 기존 숫자를 정당화하지 마십시오.** 같은 지적이 두 번 살아남은 건 전부
이 방식 때문이었습니다 — 어긋남을 인정하고도 목표가는 그대로 두고 「이렇게 읽으라」는
문장만 고쳤습니다. 그것은 반영이 아닙니다.

1. 「Codex 수정 요청」과 「보완 자료 전달」 항목을 **한 줄도 빠짐없이** 봅니다.
2. **시가총액·PER·PBR 이 「미확인」이거나 비어 있으면 이제 채울 수 있습니다.**
   2026-09-14 02:18 에 한국투자증권 오픈API 키가 들어왔습니다. **그 전에 만들어진 보고서는
   \`pykrx\` 고장으로 이 값들이 통째로 비어 있습니다** — 국내 종목도 그렇습니다.

       . ./파이썬고르기.sh
       \"\$PY3\" -c \"from src.price import fetch_price; p=fetch_price('<코드>'); print(p.출처, p.market_cap, p.per, p.pbr)\"

   · \`출처 KIS\` 로 값이 나오면 **본문·요약의 해당 칸을 채우십시오.** 값이 여러 곳에
     나오면 전부 맞춥니다. 밸류에이션 절의 「미확인」 문장도 함께 고칩니다.
   · 데이터팩까지 다시 만들어야 하면 \`\"\$PY3\" -u collect.py <코드>\` 를 씁니다.
   · **시세 기준일이 바뀌면 인계 파일의 「기준일」도 고치십시오.**
   · 반영 내역에 「시세·밸류에이션 재수집(KIS)」 한 줄을 남깁니다. 무엇이 채워졌는지 적습니다.
   · 그래도 비면 **비었다고 적으십시오. 지어내지 마십시오.**

3. **보고서 HTML 을 통째로 읽지 마십시오 (2026-09-16 추가).** 고칠 절만 꺼내 고칩니다.

       . ./파이썬고르기.sh
       \"\$PY3\" 도구/절.py 목록 <보고서.html>                  # 절 번호와 크기부터 본다
       \"\$PY3\" 도구/절.py 꺼내기 <보고서.html> 4 > /tmp/IV.html  # 그 절만 꺼낸다
       (…/tmp/IV.html 을 고친다…)
       \"\$PY3\" 도구/절.py 넣기 <보고서.html> 4 /tmp/IV.html     # 제자리에 되돌린다

   · 이 보고서는 **글자의 87%가 차트 SVG** 입니다(2026-09-16 실측: 735,282자 중 642,228자).
     통째로 읽으면 고칠 글 7.8만자를 보려고 73만자를 읽게 됩니다. 절로 꺼내면
     IV절이 243,422자 → 11,114자가 됩니다. **스무 배 차이입니다.**
   · 꺼낸 글의 \`⟦그림N⟧\` 은 접어 둔 차트입니다. **지우거나 옮기지 마십시오.**
     \`넣기\` 가 그 자리에 원래 SVG 를 그대로 되돌립니다. 표시가 맞지 않으면 거부합니다.
   · 여러 절을 고쳐야 하면 **한 절씩** 꺼내고 넣기를 되풀이하십시오.
   · 요약본(\`요약_*.html\`)은 5KB 안팎이라 통째로 열어도 됩니다.

4. 인계 파일에 적힌 본문·요약·PDF 경로의 파일을 고칩니다.
   숫자·인용·표를 고쳤으면 \`python3 ../../make_pdf.py <보고서.html>\` 로 **PDF 를 다시 만듭니다.**
   요약본을 고쳤으면 \`python3 src/문체점검.py <요약.html>\` 을 다시 돌립니다.
5. 인계 파일의 「Claude 반영 내역」에 **이번 회차**를 적습니다.
   요청 하나에 한 줄씩, 무엇을 어떻게 고쳤는지. 고치지 않기로 한 것이 있으면
   **고치지 말고 왜 그런지 적으십시오.** 그것도 답입니다. 말없이 넘기지 마십시오.
6. 「작성자·갱신 시각」을 지금으로 고칩니다.
7. **마지막에 「상태」를 \`재검토대기\` 로 바꿉니다.** 이것을 해야 Codex 가 다시 봅니다.

게시하지 마십시오. \`올리기.py\`·\`게시하기.py\` 를 부르지 마십시오. 게시는 Codex 가 합니다.
인계 파일을 다른 폴더로 옮기지 마십시오. 제자리에 두고 「상태」만 바꿉니다."

  while : ; do
    echo "[$(date '+%H:%M:%S')] ▶ [$IDX/$TOTAL] $NAME  (try=$TRY)"
    { echo ""; echo "===== [$IDX/$TOTAL] $NAME  try=$TRY  $(date '+%F %T') ====="; } >> "$LOG"

    # 모델을 정해 둡니다 (2026-10-05 사용자 지시). 지정하지 않으면 계정 기본값(Fable)으로 돌아
    #  리포트 한 건에 약 1억 토큰을 썼습니다. 바꾸려면 REPORT_MODEL 환경변수를 주십시오.
    "$PY3" 코덱스실행.py --role analysis --mode agent --timeout 10800 \
      --model "${CODEX_REPORT_MODEL:-gpt-6.1-sol}" <<< "$PROMPT" >>"$LOG" 2>&1
    RC=$?
    if [ "$RC" -eq 75 ]; then echo "Codex 사용량 한도 — 다음 예약까지 중지"; echo "FAIL" > "$TMPRES/$IDX"; return; fi
    AFTER="$(status_of "$HANDOFF")"

    if [ "$RC" -eq 0 ] && [ "$AFTER" = "재검토대기" ]; then
      echo "[$(date '+%H:%M:%S')] ✔ [$IDX/$TOTAL] $NAME — 재검토대기로 넘겼습니다"
      echo "OK" > "$TMPRES/$IDX"; return
    fi

    SAY="$(mktemp)"; tail -40 "$LOG" > "$SAY"
    if grep -qiE "session limit|usage limit|rate limit|too many requests|quota" "$SAY"; then
      rm -f "$SAY"; TRY=$((TRY+1))
      if [ "$TRY" -gt 2 ]; then
        echo "[$(date '+%H:%M:%S')] ✗ [$IDX/$TOTAL] $NAME — 이번 실행의 한도 재시도 횟수를 넘김"
        echo "FAIL" > "$TMPRES/$IDX"; return
      fi
      echo "[$(date '+%H:%M:%S')] ⏸ [$IDX/$TOTAL] $NAME — 사용량 한도. 10분 뒤 다시."
      sleep 600; continue
    fi
    rm -f "$SAY"

    echo "[$(date '+%H:%M:%S')] ⚠ [$IDX/$TOTAL] $NAME — 상태가 「${AFTER:-비어 있음}」 그대로입니다 (종료코드 $RC)."
    echo "                  '로그/수정_${CODE}.log' 를 보세요."
    echo "FAIL" > "$TMPRES/$IDX"; return
  done
}

alive() { local n=0 k; for k in $1; do kill -0 "$k" 2>/dev/null && n=$((n+1)); done; echo "$n"; }

mkdir -p "$TMPD/결과"
IDX=0; KIDS=""
while IFS= read -r LINE || [ -n "$LINE" ]; do
  [ -z "$LINE" ] && continue
  IDX=$((IDX+1))
  while [ "$(alive "$KIDS")" -ge "$JOBS" ]; do sleep 5; done
  fix_one "$IDX" "$LINE" "$TMPD/결과" &
  KIDS="$KIDS $!"
done < "$TMPD/목록"
for k in $KIDS; do wait "$k" 2>/dev/null; done

DONE=0; FAIL=0
# 결과 파일이 없어도 누락된 건을 실패로 센다. 15건 처리 후 0/0으로 숨기지 않는다.
for ((i=1; i<=TOTAL; i++)); do
  case "$(cat "$TMPD/결과/$i" 2>/dev/null)" in OK) DONE=$((DONE+1)) ;; *) FAIL=$((FAIL+1)) ;; esac
done

echo "────────────────────────────────────────────────────────"
echo "  전체 ${TOTAL}건 · 재검토대기로 넘김 ${DONE} · 실패 ${FAIL}"
if [ "$FAIL" -gt 0 ]; then
  ./알림.sh "수정 반영이 끝났습니다" "재검토대기 ${DONE} · 실패 ${FAIL}" Basso
else
  ./알림.sh "수정 반영이 끝났습니다" "${DONE}건을 재검토대기로 넘겼습니다 — Codex 재검토를 기다립니다" Glass
fi
echo "════════ 끝 $(date '+%F %T') ════════"
[ "$FAIL" -gt 0 ] && exit 1
exit 0
