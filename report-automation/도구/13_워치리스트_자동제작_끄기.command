#!/bin/bash
# 관심종목 자동 감지를 끕니다. 넣어 둔 종목이나 만든 보고서는 그대로 둡니다.
PLIST="$HOME/Library/LaunchAgents/com.jun.stockreport.watchlist.plist"
launchctl unload "$PLIST" 2>/dev/null
rm -f "$PLIST"
echo "✔ 껐습니다. 이제 관심종목을 넣어도 저절로 만들지 않습니다."
echo "  (다시 켜려면 '12_워치리스트_자동제작_켜기' 를 누르세요)"
echo
read -n 1 -s -r -p "아무 키나 누르면 닫힙니다."
