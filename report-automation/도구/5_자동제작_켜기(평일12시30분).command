#!/bin/bash
# 평일 낮 12시 30분에 '수집 → 보고서 제작'을 자동으로 돌립니다.
# 이 파일을 한 번 더블클릭하면 등록되고, 그 뒤로는 알아서 돕니다.
cd "$(dirname "$0")/.."
[ -f ./파이썬고르기.sh ] && . ./파이썬고르기.sh
DIR="$(pwd)"
PLIST="$HOME/Library/LaunchAgents/com.jun.stockreport.make.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$DIR/로그"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.jun.stockreport.make</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string><string>-lc</string>
    <string>cd '$DIR' && ./자동제작.sh >> '로그/자동제작.log' 2>&1</string>
  </array>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Weekday</key><integer>1</integer><key>Hour</key><integer>12</integer><key>Minute</key><integer>30</integer></dict>
    <dict><key>Weekday</key><integer>2</integer><key>Hour</key><integer>12</integer><key>Minute</key><integer>30</integer></dict>
    <dict><key>Weekday</key><integer>3</integer><key>Hour</key><integer>12</integer><key>Minute</key><integer>30</integer></dict>
    <dict><key>Weekday</key><integer>4</integer><key>Hour</key><integer>12</integer><key>Minute</key><integer>30</integer></dict>
    <dict><key>Weekday</key><integer>5</integer><key>Hour</key><integer>12</integer><key>Minute</key><integer>30</integer></dict>
  </array>
  <key>RunAtLoad</key><false/>
  <key>StandardErrorPath</key><string>$DIR/로그/자동제작.err</string>
</dict></plist>
PL
launchctl unload "$PLIST" 2>/dev/null
if launchctl load "$PLIST"; then
  echo "✔ 켰습니다 — 평일 낮 12시 30분에 수집하고 보고서를 만듭니다."
  echo
  echo "  · 그 시각에 맥이 켜져 있어야 합니다. 꺼져 있으면 그날은 건너뜁니다."
  echo "    (잠자기는 괜찮습니다 — 깨어난 뒤 곧 실행됩니다)"
  echo "  · 진행 내용은 '로그/자동제작.log' 에 쌓입니다."
  echo "  · 끄려면 '6_자동제작_끄기' 를 누르세요."
else
  echo "✗ 등록에 실패했습니다. 화면에 뜬 내용을 그대로 알려 주세요."
fi
echo
read -n 1 -s -r -p "아무 키나 누르면 닫힙니다."
