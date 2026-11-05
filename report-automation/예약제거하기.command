#!/bin/bash
# 걸어 둔 TM26 보고서 예약을 모두 지웁니다. 폴더와 로그는 그대로 둡니다.
cd "$(dirname "$0")" || exit 1
FOUND=0
for f in "$HOME/Library/LaunchAgents"/com.jun.invest.*.plist "$HOME/Library/LaunchAgents"/com.jun.stockreport.*.plist; do
  [ -e "$f" ] || continue
  LABEL="$(basename "$f" .plist)"
  launchctl bootout "gui/$UID/$LABEL" 2>/dev/null || launchctl unload -w "$f" 2>/dev/null
  rm -f "$f"
  echo "  ✔ $LABEL 제거"
  FOUND=1
done
[ "$FOUND" = 0 ] && echo "지울 예약이 없습니다."
