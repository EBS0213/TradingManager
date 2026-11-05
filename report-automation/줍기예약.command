#!/bin/bash
# `받은리포트/` 를 지켜보다가 리포트 PDF 가 떨어지면 알아서 넣습니다. (2026-09-14 신설)
#
#   ./줍기예약.command          예약을 겁니다
#   ./줍기예약.command --제거    예약을 없앱니다
#
# 파일이 바뀔 때마다 + 10분마다 `리포트줍기.py` 를 돌립니다. 주울 게 없으면 조용히 끝납니다.
#
# ※ ~/Downloads 를 지켜보게 하지 마십시오. macOS 개인정보 보호가 자동 실행 프로그램의
#    내려받기 폴더 접근을 막는데, 물어볼 화면을 못 띄워 프로그램이 그대로 멈춥니다
#    (2026-09-14 실제로 멈췄습니다). 브라우저 내려받기 위치를 `받은리포트/` 로 바꾸십시오.
set -u
cd "$(dirname "$0")" || exit 1
HERE="$(pwd)"
AG="$HOME/Library/LaunchAgents"
LABEL="com.jun.stockreport.pickup"
PLIST="$AG/$LABEL.plist"

if [ "${1:-}" = "--제거" ]; then
  launchctl unload "$PLIST" 2>/dev/null
  rm -f "$PLIST"
  echo "예약을 없앴습니다. (리포트줍기.py 는 손으로 그대로 쓸 수 있습니다)"
  exit 0
fi

if [ ! -f "$HERE/리포트줍기.py" ]; then
  echo "✗ 여기는 기업분석리포트 폴더가 아닙니다: $HERE"; exit 1
fi
mkdir -p "$AG" "$HERE/로그" "$HERE/받은리포트"

cat > "$PLIST" <<XML
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd '$HERE' && '$HERE/.venv/bin/python3' -u 리포트줍기.py >> '로그/줍기.log' 2>&1</string>
  </array>
  <key>WatchPaths</key>
  <array><string>$HERE/받은리포트</string></array>
  <key>StartInterval</key><integer>600</integer>
  <key>RunAtLoad</key><false/>
  <key>StandardErrorPath</key><string>$HERE/로그/줍기.err</string>
</dict>
</plist>
XML

launchctl unload "$PLIST" 2>/dev/null
launchctl load "$PLIST" 2>/dev/null && echo "  ✓ 예약을 걸었습니다: $LABEL" || { echo "  ✗ 예약을 걸지 못했습니다"; exit 1; }
echo
echo "  이제 리포트 PDF 를 '받은리포트/' 에 넣기만 하시면 됩니다."
echo "    크롬 설정 → 다운로드 → 위치 변경 → 받은리포트 폴더 로 바꾸면 손이 아예 안 갑니다."
echo "    · 산업 → 입력_산업리포트PDF/    · 기업 → 종목 폴더까지"
echo "    · 그 밖 → 입력_전략리포트PDF/"
echo "  못 알아본 PDF 는 건드리지 않고 그 자리에 둡니다."
echo "  기록: 로그/줍기.log · 없애려면 ./줍기예약.command --제거"
