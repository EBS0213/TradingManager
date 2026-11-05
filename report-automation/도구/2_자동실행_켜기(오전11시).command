#!/bin/bash
# 기업분석리포트 수집기 자동 실행 켜기 — 평일 오전 11시 (2026-08-21 변경: 기존 오후 4시 10분)
cd "$(dirname "$0")/.."
[ -f ./파이썬고르기.sh ] && . ./파이썬고르기.sh
DIR="$(pwd)"
PLIST="$HOME/Library/LaunchAgents/com.jun.stockreport.collect.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$DIR/로그"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.jun.stockreport.collect</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string><string>-lc</string>
    <string>cd '$DIR' && "$PY3" -u collect.py >> '로그/collect.log' 2>&1</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>11</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Weekday</key><integer>2</integer><key>Hour</key><integer>11</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Weekday</key><integer>3</integer><key>Hour</key><integer>11</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Weekday</key><integer>4</integer><key>Hour</key><integer>11</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Weekday</key><integer>5</integer><key>Hour</key><integer>11</integer><key>Minute</key><integer>0</integer></dict>
  </array>
  <key>RunAtLoad</key><false/>
  <key>StandardErrorPath</key><string>$DIR/로그/launchd.err</string>
</dict></plist>
PL
launchctl unload "$PLIST" 2>/dev/null
launchctl load "$PLIST" && echo "자동 실행을 켰습니다 — 평일 오전 11시에 수집합니다."
echo "로그는 '로그/collect.log' 에 쌓입니다."
read -n 1 -s -r -p "아무 키나 누르면 닫힙니다."
