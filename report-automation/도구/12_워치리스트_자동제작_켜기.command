#!/bin/bash
# 관심종목 파일을 새로 넣으면, 새 종목만 알아서 자료 모으고 보고서까지 만듭니다.
#
#   · 「관심종목」 폴더에 CSV 를 넣거나 고치면 바로 알아챕니다 (10분마다도 한 번씩 봅니다).
#   · 이미 보고서가 있는 종목은 다시 만들지 않습니다.
#   · 켜는 순간의 관심종목은 '이미 본 것'으로 잡습니다 — 켜자마자 몽땅 만들지 않게.
#
# 이 파일을 한 번 더블클릭하면 등록되고, 그 뒤로는 알아서 돕니다.
cd "$(dirname "$0")/.."
DIR="$(pwd)"
PLIST="$HOME/Library/LaunchAgents/com.jun.stockreport.watchlist.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$DIR/로그" "$DIR/캐시"
chmod +x "$DIR/워치리스트자동.sh" 2>/dev/null

# 켜는 지금 있는 종목을 기준으로 삼습니다 (이것을 안 하면 전부 새것으로 봅니다)
[ -f "$DIR/파이썬고르기.sh" ] && . "$DIR/파이썬고르기.sh"
"$PY3" "$DIR/워치리스트감시.py" --지금

감시할것=""
for P in "$DIR/관심종목" "$DIR/워치리스트" "$DIR/watchlist" "$DIR/watchlist.csv"; do
  [ -e "$P" ] && 감시할것="$감시할것
    <string>$P</string>"
done
if [ -z "$감시할것" ]; then
  감시할것="
    <string>$DIR</string>"
fi

cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.jun.stockreport.watchlist</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string><string>-lc</string>
    <string>cd '$DIR' && ./워치리스트자동.sh</string>
  </array>
  <key>WatchPaths</key>
  <array>$감시할것
  </array>
  <key>StartInterval</key><integer>600</integer>
  <key>RunAtLoad</key><false/>
  <key>StandardErrorPath</key><string>$DIR/로그/워치자동.err</string>
</dict></plist>
PL

launchctl unload "$PLIST" 2>/dev/null
if launchctl load "$PLIST"; then
  echo "✔ 켰습니다."
  echo
  echo "  · 이제 「관심종목」 폴더에 CSV 를 넣으면 곧(20초쯤 뒤) 알아서 시작합니다."
  echo "  · 새 종목 하나에 20~40분쯤 걸리고, 두 개씩 나란히 만듭니다."
  echo "  · 진행 상황은 TM26 앱의 「진행 상황 보기」 또는 '로그/워치자동.log'."
  echo "  · 끄려면 '13_워치리스트_자동제작_끄기' 를 누르세요."
else
  echo "✗ 등록에 실패했습니다. 화면에 뜬 내용을 그대로 알려 주세요."
fi
echo
read -n 1 -s -r -p "아무 키나 누르면 닫힙니다."
