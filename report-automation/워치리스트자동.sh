#!/bin/bash
# 관심종목(워치리스트) 파일이 새로 올라오면 —
#   새 종목만 골라 → 자료 수집(DART·SEC·컨퍼런스콜·뉴스·주가·재무)
#   → 증권사 리포트 받기(네이버 + 증권사 계정, 지난 6개월)
#   → 바로 보고서 제작
# launchd 가 파일이 바뀔 때와 10분마다 부릅니다. 바뀐 게 없으면 조용히 끝납니다.
cd "$(dirname "$0")" || exit 1
[ -f ./파이썬고르기.sh ] && . ./파이썬고르기.sh
mkdir -p 로그 캐시 report

LOG="로그/워치자동.log"
LOCK="워치자동.lock"

# 이미 돌고 있으면 그냥 나갑니다 (launchd 가 여러 번 부를 수 있습니다)
if [ -f "$LOCK" ] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then exit 0; fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT INT TERM

# 제작이 이미 돌고 있으면 건드리지 않습니다. 다음 번에 다시 봅니다.
if [ -f 제작중.lock ] && kill -0 "$(cat 제작중.lock 2>/dev/null)" 2>/dev/null; then exit 0; fi
[ -f 일시정지.flag ] && exit 0

# 파일을 옮기거나 복사하는 중일 수 있습니다. 다 앉을 때까지 기다립니다.
sleep 20

# 홈페이지 워치리스트를 먼저 맥에 맞춥니다 (2026-09-08 추가).
#  워치리스트를 홈페이지 「내 기록」에서 관리하시므로, 맥 CSV 만 보고 있으면
#  홈페이지에 새로 넣은 종목을 영영 못 봅니다. 조용히 실패해도 그냥 갑니다.
if [ -f 워치리스트맞추기.py ]; then
  "$PY3" 워치리스트맞추기.py --그대로 >>"$LOG" 2>&1 || true
fi

NEW="$("$PY3" 워치리스트감시.py --새것 2>>"$LOG")"
[ -z "$NEW" ] && exit 0

N=$(printf '%s\n' "$NEW" | grep -c .)
{
  echo ""
  echo "═══════ 워치리스트 자동 $(date '+%F %T') ═══════"
  echo "새 종목 ${N}개"
  printf '%s\n' "$NEW" | sed 's/^/  · /'
} >> "$LOG"

./알림.sh "새 종목 ${N}개를 찾았습니다" "자료를 모으고 보고서를 만들기 시작합니다" >/dev/null 2>&1

for rc in "$HOME/.zprofile" "$HOME/.zshrc" "$HOME/.bash_profile" "$HOME/.profile"; do
  [ -r "$rc" ] && . "$rc" >/dev/null 2>&1
done
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:$HOME/.claude/local:$HOME/.npm-global/bin:$HOME/bin"

# 자는 사이에 멈추지 않게
command -v caffeinate >/dev/null 2>&1 && caffeinate -ims -w $$ &

# ① 자료 수집 — 종목 하나씩 (공시·재무·주가·뉴스·컨퍼런스콜 자료가 여기서 모입니다)
echo "── 자료 수집 ──" >> "$LOG"
CODES=""
while IFS=, read -r CODE NAME; do
  [ -z "$CODE" ] && continue
  CODES="$CODES $CODE"
  echo "[$(date '+%H:%M:%S')] 수집 $CODE $NAME" >> "$LOG"
  "$PY3" -u collect.py "$CODE" >> "$LOG" 2>&1
done <<< "$NEW"

# ② 증권사 리포트 — 새 종목의 리포트를 네이버와 증권사 계정에서 받습니다
#   (2026-10-05 부터 와이즈리포트를 못 써서 갈아끼웠습니다)
echo "── 증권사 리포트 ──" >> "$LOG"
#   CODES 가 비면 인자 없이 불려 워치리스트 전체·산업까지 받으므로 막아 둡니다
[ -n "${CODES// /}" ] && { "$PY3" -u 네이버리포트받기.py $CODES >> "$LOG" 2>&1 || true; }
if [ -n "${CODES// /}" ] && [ -f 증권사리포트받기.py ]; then
  # shellcheck disable=SC2086
  "$PY3" -u 증권사리포트받기.py $CODES >> "$LOG" 2>&1 || true
fi

# ③ 제작 — 새 종목만 목록에 적어 두고 돌립니다
printf '%s\n' "$NEW" > 제작목록.txt
echo "── 제작 시작 $(date '+%H:%M:%S') ──" >> "$LOG"
. ./제작엔진.sh
run_all 제작목록.txt "${MAKE_JOBS:-2}" >> "$LOG" 2>&1

# ④ 여기까지 왔으면 이 종목들은 다뤘습니다. 다음부터는 새것으로 보지 않습니다.
"$PY3" 워치리스트감시.py --적기 >> "$LOG" 2>&1

echo "═══════ 끝 $(date '+%F %T') ═══════" >> "$LOG"
./알림.sh "새 종목 보고서가 끝났습니다" "앱의 「보고서 보기」에서 확인하세요" Glass >/dev/null 2>&1
