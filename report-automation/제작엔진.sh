#!/bin/bash
[ -f ./파이썬고르기.sh ] && . ./파이썬고르기.sh
# 종목 LISTFILE을 받아 여러 개를 JOBS에 만든다. 버튼과 자동실행이 함께 쓴다.
#   사용:  . 제작엔진.sh   후   run_all <LISTFILE파일> <JOBS개수>
# 종목 하나 = claude 세션 하나. 세션끼리는 서로 모른다.

DEFAULT_JOBS=2

count_pdf() {                       # 이 종목의 PDF 가 report 에 몇 개 있나
  ls -1 report/*.pdf 2>/dev/null | grep -c -- "$1"
}

# 2026-08-26 고침 — 개수로 성공을 판정하면, 이미 보고서가 있는 종목을 다시 만들 때
# 개수가 그대로라 '실패'로 찍힌다(같은 이름을 덮어쓰므로). 그래서 **만들어진 시각**을 본다.
# 시각이 새로워졌으면 성공이다.
claude찾기() { # 기존 호출자 호환 이름, 실제 실행기는 Codex입니다.
  export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin"
  CLAUDE="$(command -v "${TM26_REPORT_PROVIDER:-codex}" 2>/dev/null)"
  [ -n "$CLAUDE" ] && [ -f ./코덱스실행.py ]
}

살아있는일() {   # 아직 도는 우리 작업 개수
  local n=0 k
  for k in $1; do kill -0 "$k" 2>/dev/null && n=$((n+1)); done
  echo "$n"
}

pdf_stamp() {
  "$PY3" - "$1" <<'PYEOF'
import sys, glob, os, unicodedata as u
code = u.normalize("NFC", sys.argv[1]).upper()
best = 0
for p in glob.glob("report/*.pdf"):
    if code in u.normalize("NFC", os.path.basename(p)).upper():
        best = max(best, os.path.getmtime(p))
print(int(best))
PYEOF
}

run_one() {
  local IDX="$1" LINE="$2" TOTAL="$3" TMPD="$4"
  local CODE="${LINE%%,*}"
  local LOG="로그/종목_${CODE}.log"
  local TRY=0 BEFORE AFTER RC SAY HIT SLEPT HANDOFF

  # 이번 세션이 만들 종목을 지시문 끝에 붙여 넘긴다. 파일을 돌려쓰지 않으므로 충돌이 없다.
  local PROMPT
  PROMPT="$(cat 제작지시.md)

## 이번에 만들 종목 (이 한 종목만 만드세요)

    ${LINE}
$([ -f 지시문/_공통_문체기준.md ] && cat 지시문/_공통_문체기준.md)

---

## 지금 할 일

위 제작지시대로 **${LINE} 이 한 종목의 기업분석보고서를 지금 만드십시오.**
PDF 와 \`협업/검토대기/\` 인계 파일까지 만들어야 끝난 것입니다.
이것은 launchd 무인 자동 실행입니다 — **되물어도 답할 사람이 없습니다.**
무엇을 할지 묻지 말고, 확인을 구하지 말고, 바로 시작하십시오.

(2026-09-14 추가 — 이 줄이 없던 동안 세션이 \"I'm ready. What would you like me to
work on?\" 한 줄만 뱉고 3초 만에 끝나는 일이 있었습니다. ANET 이 그렇게 통째로 빠졌습니다.)"

  while : ; do
    echo "[$(date '+%H:%M:%S')] ▶ [$IDX/$TOTAL] $LINE  (try=$TRY)"
    {
      echo ""
      echo "===== [$IDX/$TOTAL] $LINE  try=$TRY  $(date '+%F %T') ====="
    } >> "$LOG"

    BEFORE=$(pdf_stamp "$CODE")
    SAY="$(mktemp)"
    # 모델을 정해 둡니다 (2026-10-05 사용자 지시). 지정하지 않으면 계정 기본값(Fable)으로 돌아
    #  리포트 한 건에 약 1억 토큰을 썼습니다. 바꾸려면 REPORT_MODEL 환경변수를 주십시오.
    TM26_REPORT_CODE="$CODE" "$PY3" 코덱스실행.py --role analysis --mode agent --timeout 10800 \
      --model "${CODEX_REPORT_MODEL:-gpt-6.1-sol}" <<< "$PROMPT" >>"$LOG" 2>&1
    RC=$?
    if [ "$RC" -eq 75 ]; then echo "Codex 사용량 한도 — 다음 예약까지 중지"; echo "FAIL" > "$TMPD/$IDX"; return; fi
    tail -40 "$LOG" > "$SAY"
    AFTER=$(pdf_stamp "$CODE")

    HIT=0; SLEPT=0
    if [ "$AFTER" -le "$BEFORE" ]; then
      if grep -qiE "session limit|usage limit|rate limit|too many requests|quota|resets? [0-9]" "$SAY"; then HIT=1
      elif grep -qiE "went to sleep|network error|connection error|ECONNRESET|ETIMEDOUT|fetch failed" "$SAY"; then SLEPT=1
      fi
    fi
    rm -f "$SAY"

    if [ "$HIT" -eq 1 ]; then
      TRY=$((TRY+1))
      if [ "$TRY" -gt 72 ]; then
        echo "[$(date '+%H:%M:%S')] ✗ [$IDX/$TOTAL] $CODE — 12시간 기다려도 한도가 안 풀림"
        echo "FAIL" > "$TMPD/$IDX"; return
      fi
      echo "[$(date '+%H:%M:%S')] ⏸ [$IDX/$TOTAL] $CODE — 사용량 한도. 10분 뒤 다시."
      sleep 600; continue
    fi
    if [ "$SLEPT" -eq 1 ]; then
      TRY=$((TRY+1))
      if [ "$TRY" -le 2 ]; then
        echo "[$(date '+%H:%M:%S')] ↻ [$IDX/$TOTAL] $CODE — 잠자기·통신 끊김. 30초 뒤 다시."
        sleep 30; continue
      fi
      echo "[$(date '+%H:%M:%S')] ✗ [$IDX/$TOTAL] $CODE — 계속 끊깁니다."
      echo "FAIL" > "$TMPD/$IDX"; return
    fi

    if [ "$AFTER" -gt "$BEFORE" ]; then
      echo "[$(date '+%H:%M:%S')] ✔ [$IDX/$TOTAL] $CODE 완료 → $(ls -1t report/*.pdf | grep -- "$CODE" | head -1 | sed 's|^report/||')"
      # 2026-09-08 사용자 지시 — 게재는 Codex 검토 뒤 직접 수행하므로 미게시를 실패로 보지 않는다.
      # 다만 **인계 파일이 없으면** Codex 가 그 보고서를 영영 못 찾는다. 미게시와 다른 문제다.
      # PDF 만 만들고 인계를 빠뜨리면 아무 데도 안 간 채 조용히 묻힌다. 그래서 따로 센다.
      if ls 협업/검토대기/*_"${CODE}".md >/dev/null 2>&1; then
        echo "[$(date '+%H:%M:%S')] 자체 점검 완료 — 자동 게시를 시작합니다."
        HANDOFF="$(ls -1t 협업/검토대기/*_"${CODE}".md | head -1)"
        if [ "$RC" -eq 0 ] && [ -n "$HANDOFF" ]; then
          "$PY3" -B -u 자동검토.py --파일 "${HANDOFF##*/}" --완성 --한번 >>"$LOG" 2>&1 \
            || echo "[$(date '+%H:%M:%S')] 게시 실패 — $LOG 확인. 같은 파일로 반복하지 않습니다."
        fi
        echo "OK" > "$TMPD/$IDX"
      else
        echo "[$(date '+%H:%M:%S')] ⚠ [$IDX/$TOTAL] $CODE — 보고서는 나왔는데 **인계 파일이 없습니다**."
        echo "                  '협업/검토대기/<날짜>_${CODE}.md' 가 있어야 Codex 가 검토합니다."
        echo "                  '로그/종목_${CODE}.log' 를 보세요."
        echo "NOHAND" > "$TMPD/$IDX"
      fi
    elif [ "$BEFORE" -gt 0 ] \
         && [ $(( ($(date +%s) - BEFORE) / 86400 )) -lt "${REMAKE_DAYS:-20}" ]; then
      echo "[$(date '+%H:%M:%S')] = [$IDX/$TOTAL] $CODE — 이미 보고서가 있어 그대로 둡니다" \
           "($(( ($(date +%s) - BEFORE) / 86400 ))일 전)."
      echo "SKIP" > "$TMPD/$IDX"
    elif [ "$BEFORE" -gt 0 ]; then
      # 2026-09-14 — 예전에는 PDF 가 하나라도 있으면 나이를 안 보고 「이미 있음」으로 넘겼다.
      #  ANET 은 8/29 자 보고서(16일 전)가 있다는 이유로 새로 만들지 않고 통과했고,
      #  정작 이번 세션은 빈손으로 3초 만에 끝나 있었다. 낡은 것은 없는 것으로 본다.
      echo "[$(date '+%H:%M:%S')] ⚠ [$IDX/$TOTAL] $CODE — 보고서가" \
           "$(( ($(date +%s) - BEFORE) / 86400 ))일 지났는데 새로 만들어지지 않았습니다."
      echo "                  세션이 빈손으로 끝났을 수 있습니다. '로그/종목_${CODE}.log' 를 보세요."
      echo "FAIL" > "$TMPD/$IDX"
    else
      echo "[$(date '+%H:%M:%S')] ⚠ [$IDX/$TOTAL] $CODE — PDF 가 안 생겼습니다 (종료코드 $RC). '로그/종목_${CODE}.log' 를 보세요."
      echo "FAIL" > "$TMPD/$IDX"
    fi
    return
  done
}

run_all() {
  local LISTFILE="$1"
  local JOBS="${2:-$DEFAULT_JOBS}"
  local TOTAL IDX=0 TMPD DONE=0 FAIL=0 SKIP=0 f
  TOTAL=$(grep -c . "$LISTFILE")
  [ "$TOTAL" -eq 0 ] && { echo "만들 종목이 없습니다."; return 9; }
  if ! claude찾기; then
    echo "  ✗ 이 맥에서 Codex CLI 를 찾지 못했습니다."
    echo "    터미널에서  npm install -g @openai/codex  로 설치한 뒤 한 번 실행해 로그인하세요."
    ./알림.sh "제작을 시작하지 못했습니다" "Codex CLI 를 찾지 못했습니다" Basso 2>/dev/null
    return 1
  fi
  echo "  Codex CLI: $CLAUDE"
  # 2026-08-26 추가 — 제작을 두 번 겹쳐 돌리면 같은 종목을 둘이 동시에 만든다.
  # 실제로 삼화콘덴서가 두 번 만들어졌다(삼화콘덴서 / 삼화콘덴서공업).
  # 이미 돌고 있으면 새로 시작하지 않는다.
  if [ -f 제작중.lock ]; then
    local OLDPID
    OLDPID=$(cat 제작중.lock 2>/dev/null)
    # 번호만 보면 안 된다 — 맥이 그 번호를 다른 프로그램에 물려주면 착각한다.
    if [ -n "$OLDPID" ] && kill -0 "$OLDPID" 2>/dev/null \
       && ps -p "$OLDPID" -o command= 2>/dev/null | grep -qE "제작엔진|run_all|자동제작|claude"; then
      echo
      echo "  ✗ 이미 제작이 돌고 있습니다 (프로세스 $OLDPID)."
      echo "    창을 두 개 띄우면 같은 종목을 두 번 만들게 됩니다."
      echo "    돌고 있는 창을 확인하시고, 멈추려면 메뉴에서 3) 일시정지 를 누르세요."
      echo
      return 1
    fi
    rm -f 제작중.lock          # 죽은 흔적만 남은 경우
  fi
  echo $$ > 제작중.lock
  trap 'rm -f 제작중.lock' EXIT INT TERM

  TMPD="$(mktemp -d)"
  mkdir -p 로그

  # 돌고 있는 동안 다른 곳이 목록 파일을 다시 쓰면 읽던 자리가 어긋난다.
  # 그래서 복사해 두고 복사본만 읽는다.
  mkdir -p "$TMPD/결과"; cp -f "$LISTFILE" "$TMPD/목록" 2>/dev/null || { echo "  ✗ 목록을 복사하지 못했습니다: $LISTFILE"; rm -f 제작중.lock; return 1; }
  LISTFILE="$TMPD/목록"
  echo "  목록: $(grep -c . "$LISTFILE")줄 · 동시 ${JOBS}개"

  echo "  종목 ${TOTAL}개를 ${JOBS}개씩 나란히 만듭니다."
  echo "  종목별 진행 내용은 '로그/종목_<코드>.log' 에 따로 쌓입니다."
  echo "────────────────────────────────────────────────────────"

  local PAUSED=0 KIDS=""
  # 마지막 줄이 줄바꿈 없이 끝나면 read 가 실패로 끝나 그 줄을 놓친다.
  # (종목이 하나뿐일 때 반복문이 아예 안 돌던 원인)  || [ -n "$LINE" ] 로 건진다.
  while IFS= read -r LINE <&3 || [ -n "$LINE" ]; do
    [ -z "$LINE" ] && continue
    # 일시정지 — '7_일시정지' 를 누르면 이 표시가 생긴다.
    # 돌고 있던 종목은 끝까지 만들고, 새 종목은 시작하지 않는다.
    # 남은 종목은 report 에 PDF 가 없으므로 다음 실행에서 자동으로 이어진다.
    if [ -f 일시정지.flag ]; then
      echo
      echo "  ⏸ 일시정지 표시가 있어 새 종목을 시작하지 않습니다."
      echo "     돌고 있던 종목은 끝까지 만듭니다."
      PAUSED=1
      break
    fi
    IDX=$((IDX+1))
    echo "[$(date '+%H:%M:%S')] · 줄을 읽었습니다: $LINE"
    # 자리가 날 때까지 기다린다 (bash 3.2 에는 wait -n 이 없어 이렇게 센다)
    WAITED=0
    while [ "$(살아있는일 "$KIDS")" -ge "$JOBS" ]; do
      sleep 5
      WAITED=$((WAITED+5))
      if [ "$WAITED" -ge 300 ] && [ $((WAITED % 300)) -eq 0 ]; then
        echo "[$(date '+%H:%M:%S')] · 자리 기다리는 중 (${WAITED}초, 도는 작업 $(살아있는일 "$KIDS")개)"
      fi
    done
    run_one "$IDX" "$LINE" "$TOTAL" "$TMPD/결과" &
    KIDS="$KIDS $!"
  done 3< "$LISTFILE"
  # 2026-08-28 고침 — 예전에는 그냥 `wait` 였다.
  # 그러면 잠자기 방지용 caffeinate 까지 기다리는데, 그것은 이 스크립트가 끝나야 끝나므로
  # 서로 기다리며 영영 안 끝났다. 프로세스가 남아 자물쇠를 계속 쥐고 있던 원인이다.
  for kid in $KIDS; do wait "$kid" 2>/dev/null; done

  local NOHAND=0
  for f in "$TMPD"/결과/*; do
    [ -e "$f" ] || continue
    case "$(cat "$f")" in
      OK)     DONE=$((DONE+1)) ;;
      SKIP)   SKIP=$((SKIP+1)) ;;
      NOHAND) DONE=$((DONE+1)); NOHAND=$((NOHAND+1)) ;;
      *)      FAIL=$((FAIL+1)) ;;
    esac
  done
  rm -rf "$TMPD"
  rm -f 제작중.lock

  # 끝났다고 알린다 — 화면 오른쪽 위 알림으로 뜬다
  if [ "$FAIL" -gt 0 ] || [ "$NOHAND" -gt 0 ]; then
    ./알림.sh "보고서 제작이 끝났습니다" \
      "검토대기 ${DONE} · 이미 있음 ${SKIP} · 실패 ${FAIL}${NOHAND:+ · 인계 안 됨 ${NOHAND}}" Basso
  else
    ./알림.sh "보고서 제작이 끝났습니다" "검토대기 ${DONE}건 · 이미 있음 ${SKIP}건 — Codex 검토를 기다립니다" Glass
  fi

  echo "────────────────────────────────────────────────────────"
  if [ "$PAUSED" = "1" ]; then
    echo "  ⏸ 일시정지로 멈췄습니다. 시작한 ${IDX}종목 중 성공 ${DONE} · 이미 있음 ${SKIP} · 실패 ${FAIL}"
    echo "     남은 종목은 다음에 다시 실행하면 이어서 만듭니다."
    echo "     ('8_이어서_제작' 을 누르거나 '4_지금_보고서_만들기' 를 다시 누르세요)"
  else
    echo "  전체 ${TOTAL}종목 · 검토대기 ${DONE} · 이미 있음 ${SKIP} · 실패 ${FAIL}"
    [ "$NOHAND" -gt 0 ] && echo "  ⚠ 그 가운데 ${NOHAND}종목은 인계 파일이 없습니다 — Codex 가 못 찾습니다."

  fi
  [ "$DONE" -gt 0 ] && ls -1t report/*.pdf 2>/dev/null | head -"$DONE" | sed "s|^report/|      |"
  return 0
}
