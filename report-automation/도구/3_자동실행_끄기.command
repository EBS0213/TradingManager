#!/bin/bash
PLIST="$HOME/Library/LaunchAgents/com.jun.stockreport.collect.plist"
launchctl unload "$PLIST" 2>/dev/null
rm -f "$PLIST"
echo "자동 실행을 껐습니다."
read -n 1 -s -r -p "아무 키나 누르면 닫힙니다."
