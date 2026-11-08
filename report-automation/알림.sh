#!/bin/bash
[ "${TM26_AUTOMATION_LOCAL_ONLY:-0}" = 1 ] && exit 0
# 화면 오른쪽 위 알림.
#   ./알림.sh "제목줄" "본문" [소리이름] [갈 곳]
#
# 소리 : Glass(완료) · Basso(문제) · 없으면 무음
# 갈 곳: 알림을 **눌렀을 때 열릴 자리**입니다 (2026-09-05 신설)
#        · https://…        그 웹페이지를 엽니다
#        · /경로/파일.pdf   그 파일을 엽니다
#        · 마지막            방금 올린 글로 갑니다 (올리기.py 가 적어 둔 주소)
#
# 누를 수 있는 알림은 terminal-notifier 가 있어야 합니다 (brew install terminal-notifier).
# 없으면 예전처럼 알림만 띄우고, 갈 곳이 있으면 작은 물음창을 대신 띄웁니다.
cd "$(dirname "$0")" 2>/dev/null || true
T="${1:-TM26}"
M="${2:-작업이 끝났습니다}"
S="${3:-}"
GO="${4:-}"

# 「마지막」이면 방금 올린 글 주소를 꺼내 옵니다
if [ "$GO" = "마지막" ]; then
  GO="$(cat 캐시/마지막게시.txt 2>/dev/null | tr -d '\r\n')"
fi


# ── 텔레그램 (2026-09-08 다시 씀) ──────────────────────────────────
# 맥미니는 화면을 보지 않으므로 텔레그램이 기본 알림입니다.
#
# **사이트의 /api/screener/alert 는 더 이상 쓰지 않습니다.** 그 길은 스카우트 결과를
# 받는 채널로 고정돼 있어서, 보고서 제작 알림이 거기 섞여 들어갔습니다.
# 그 채널에는 스카우트 결과만 가야 합니다.
#
# 이제 **보고서 자동화 전용 채널로 직접** 보냅니다. 필요한 값 둘을 .env 에서 읽습니다.
#     TELEGRAM_BOT_TOKEN=…      @BotFather 가 준 봇 토큰
#     TELEGRAM_CHAT_ID=-100…    보낼 채널 번호
# 둘 중 하나라도 비어 있으면 텔레그램으로 보내지 않고 로그에만 적습니다.
# 채널 번호를 모르시면 `./텔레그램채널찾기.sh` 를 돌리십시오. 찾아서 .env 에 적어 줍니다.

읽기_env() {                       # $1 = 열쇠 이름. `source .env` 는 위험해서 안 씁니다.
  [ -r .env ] || return 0
  grep -m1 "^[[:space:]]*$1=" .env 2>/dev/null | cut -d= -f2- | tr -d '\r\n" '
}

알림기록() {                       # 어디로도 못 보내도 흔적은 남깁니다
  mkdir -p 로그 2>/dev/null
  printf '%s  [%s] %s | %s%s\n' "$(date '+%F %T')" "${3:--}" "$1" "$2" \
    "${4:+ | $4}" >> 로그/알림.log 2>/dev/null
}

텔레그램보내기() {                 # $1 제목 · $2 본문 · $3 소리 · $4 갈곳
  local TOKEN CHAT MARK WHEN MSG JSON CODE
  알림기록 "$1" "$2" "$3" "$4"

  TOKEN="${TELEGRAM_BOT_TOKEN:-$(읽기_env TELEGRAM_BOT_TOKEN)}"
  CHAT="${TELEGRAM_CHAT_ID:-$(읽기_env TELEGRAM_CHAT_ID)}"

  if [ -z "$TOKEN" ] || [ -z "$CHAT" ]; then
    echo "텔레그램을 건너뜁니다 — .env 의 TELEGRAM_BOT_TOKEN·TELEGRAM_CHAT_ID 가 비어 있습니다." >&2
    echo "  './텔레그램채널찾기.sh' 를 돌리면 채널 번호를 찾아 적어 줍니다." >&2
    echo "  알림 내용은 '로그/알림.log' 에 그대로 남습니다." >&2
    return 1
  fi

  # 이 시스템에서 Basso 는 「문제」, Glass 는 「완료」를 뜻합니다
  MARK="•"; [ "$3" = "Basso" ] && MARK="⚠️"; [ "$3" = "Glass" ] && MARK="✔"
  WHEN="$(date '+%Y-%m-%d %H:%M:%S')"

  # 기계 이름(「김준성의 Mac mini」)은 넣지 않습니다. 보내는 맥이 하나뿐입니다.
  MSG="$MARK TM26 보고서 · $1
$2

$WHEN"
  [ -n "$4" ] && [ "$4" != "마지막" ] && MSG="$MSG
$4"

  JSON="$(TM26_CHAT="$CHAT" printf '%s' "$MSG" | TM26_CHAT="$CHAT" /usr/bin/python3 -c 'import json,os,sys; print(json.dumps({"chat_id": os.environ["TM26_CHAT"], "text": sys.stdin.read(), "disable_web_page_preview": True}, ensure_ascii=False))' 2>/dev/null)"
  [ -n "$JSON" ] || return 1

  CODE="$(curl -s -m 30 -o /dev/null -w '%{http_code}' -X POST \
    -H 'Content-Type: application/json' --data "$JSON" \
    "https://api.telegram.org/bot${TOKEN}/sendMessage" 2>/dev/null)"
  [ "$CODE" = "200" ] && return 0
  # 토큰이 섞일 수 있으므로 curl 의 말은 그대로 내보내지 않습니다
  echo "텔레그램 알림 실패 (HTTP $CODE) — 봇이 그 채널의 관리자인지, 채널 번호가 맞는지 보십시오" >&2
  return 1
}

텔레그램보내기 "$T" "$M" "$S" "$GO"
TN="$(command -v terminal-notifier 2>/dev/null)"
[ -z "$TN" ] && [ -x /opt/homebrew/bin/terminal-notifier ] && TN=/opt/homebrew/bin/terminal-notifier

if [ -n "$TN" ]; then
  ARGS=(-title "TM26" -subtitle "$T" -message "$M" -group "tm26")
  [ -n "$S" ] && ARGS+=(-sound "$S")
  if [ -n "$GO" ]; then
    case "$GO" in
      http://*|https://*) ARGS+=(-open "$GO") ;;
      *) [ -e "$GO" ] && ARGS+=(-execute "open '$GO'") ;;
    esac
    ARGS+=(-actions "이동" -closeLabel "닫기")
  fi
  "$TN" "${ARGS[@]}" >/dev/null 2>&1 &
  exit 0
fi

# terminal-notifier 가 없을 때 — 알림만 띄우고, 갈 곳이 있으면 물어봅니다
if [ -n "$S" ]; then
  osascript -e "display notification \"$M\" with title \"TM26\" subtitle \"$T\" sound name \"$S\"" >/dev/null 2>&1
else
  osascript -e "display notification \"$M\" with title \"TM26\" subtitle \"$T\"" >/dev/null 2>&1
fi
if [ -n "$GO" ]; then
  osascript >/dev/null 2>&1 <<AS &
tell application "System Events"
  activate
  set r to display dialog "$M" with title "$T" buttons {"닫기", "이동"} default button "이동" giving up after 25
  if button returned of r is "이동" then do shell script "open " & quoted form of "$GO"
end tell
AS
fi
exit 0
