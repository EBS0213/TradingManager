#!/bin/bash
# 평일 12시 30분 자동 제작을 끕니다. 파일은 지우지 않으니 언제든 다시 켤 수 있습니다.
PLIST="$HOME/Library/LaunchAgents/com.jun.stockreport.make.plist"
launchctl unload "$PLIST" 2>/dev/null
echo "✔ 자동 제작을 껐습니다. 손으로 만드는 '4_지금_보고서_만들기' 는 그대로 씁니다."
echo
read -n 1 -s -r -p "아무 키나 누르면 닫힙니다."
