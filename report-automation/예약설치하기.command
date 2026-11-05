#!/bin/bash
# ============================================================
#  맥미니에 TM26 보고서 작업 예약을 걸어 줍니다.
#  ★ 이 파일은 기업분석리포트 폴더 안에 두고 실행하십시오.
#     (폴더 위치를 스스로 읽어 plist 에 적습니다)
# ============================================================
set -u
cd "$(dirname "$0")" || exit 1
HERE="$(pwd)"
AG="$HOME/Library/LaunchAgents"

if [ ! -f "$HERE/투자작업.sh" ]; then
  echo "✗ 여기는 기업분석리포트 폴더가 아닙니다: $HERE"
  echo "  이 파일과 작업표.txt 를 기업분석리포트 폴더 안으로 옮긴 뒤 다시 실행하세요."
  exit 1
fi
mkdir -p "$AG" "$HERE/로그"

N=0
while read -r TAIL HH MM DOW WHAT DESC; do
  case "$TAIL" in ''|\#*) continue ;; esac

  KIND="${WHAT%%:*}"; ARG="${WHAT#*:}"
  case "$KIND" in
    투자작업)  CMD="./투자작업.sh $ARG >> '로그/$ARG.log' 2>&1"; LABEL="com.jun.invest.$TAIL" ;;
    파이썬)    CMD="'$HERE/.venv/bin/python3' -u $ARG >> '로그/collect.log' 2>&1"; LABEL="com.jun.stockreport.$TAIL" ;;
    스크립트)  CMD="./$ARG >> '로그/자동제작.log' 2>&1"; LABEL="com.jun.stockreport.$TAIL" ;;
    *) echo "  ✗ 모르는 종류: $WHAT"; continue ;;
  esac

  CAL=""; OLDIFS="$IFS"; IFS=','
  for d in $DOW; do
    CAL="$CAL    <dict><key>Weekday</key><integer>$d</integer><key>Hour</key><integer>$((10#$HH))</integer><key>Minute</key><integer>$((10#$MM))</integer></dict>
"
  done
  IFS="$OLDIFS"

  F="$AG/$LABEL.plist"
  cat > "$F" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>-lc</string>
  <string>cd '$HERE' &amp;&amp; $(printf '%s' "$CMD" | sed 's/&/\&amp;/g; s/</\&lt;/g; s/>/\&gt;/g')</string></array>
  <key>StartCalendarInterval</key><array>
$CAL  </array>
  <key>RunAtLoad</key><false/>
  <key>StandardErrorPath</key><string>$HERE/로그/$TAIL.err</string>
</dict></plist>
PLIST

  launchctl bootout "gui/$UID/$LABEL" 2>/dev/null
  launchctl bootstrap "gui/$UID" "$F" 2>/dev/null || launchctl load -w "$F" 2>/dev/null
  echo "  ✔ $LABEL  →  $HH:$MM  요일 $DOW   ($DESC)"
  N=$((N+1))
done < 작업표.txt

echo
echo "예약 $N 개를 걸었습니다."
echo "확인:  launchctl list | grep com.jun"
echo
echo "※ 맥미니가 잠들면 예약이 밀립니다:  sudo pmset -a sleep 0 displaysleep 10 disksleep 0"
