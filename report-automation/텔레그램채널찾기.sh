#!/bin/bash
# 보고서 알림을 받을 텔레그램 채널의 번호(chat_id)를 찾아 .env 에 적습니다.
#
#   ./텔레그램채널찾기.sh              .env 에 든 토큰으로 찾습니다
#   ./텔레그램채널찾기.sh <봇토큰>      토큰을 주면 그것도 .env 에 적습니다
#
# 먼저 해 두셔야 하는 것 — 이것 없이는 아무것도 안 보입니다.
#   1) 그 채널에 **봇을 관리자로 추가** 하십시오.
#      (봇은 초대 링크로 스스로 못 들어갑니다. 사람이 넣어 주어야 합니다.)
#   2) 그 채널에 아무 글이나 하나 올리십시오. 그래야 봇이 채널을 알아봅니다.
#   ./텔레그램채널찾기.sh --카드 <봇토큰>   카드뉴스 전용 열쇠(CARDNEWS_…)로 적습니다.
#      제작 알림(알림.sh)이 쓰는 TELEGRAM_… 은 건드리지 않습니다 (2026-10-03).
cd "$(dirname "$0")" || exit 1

PREFIX=""
if [ "${1:-}" = "--카드" ]; then PREFIX="CARDNEWS_"; shift; fi
export PREFIX
TOKEN="${1:-}"
if [ -z "$TOKEN" ]; then
  TOKEN="$(grep -m1 '^[[:space:]]*TELEGRAM_BOT_TOKEN=' .env 2>/dev/null | cut -d= -f2- | tr -d '\r\n" ')"
fi
if [ -z "$TOKEN" ]; then
  echo "봇 토큰이 없습니다."
  echo "  텔레그램에서 @BotFather 에게 /newbot 을 보내 봇을 만들고, 받은 토큰으로"
  echo "  ./텔레그램채널찾기.sh <토큰>  처럼 돌리십시오."
  exit 2
fi

/usr/bin/python3 - "$TOKEN" <<'PY'
import json, sys, urllib.request, pathlib, re

토큰 = sys.argv[1]

def 부르기(길):
    with urllib.request.urlopen(f"https://api.telegram.org/bot{토큰}/{길}", timeout=30) as r:
        return json.loads(r.read().decode())

try:
    나 = 부르기("getMe")
except Exception as e:
    print(f"토큰이 틀렸거나 연결이 안 됩니다: {e}"); sys.exit(1)
if not 나.get("ok"):
    print("토큰이 틀렸습니다."); sys.exit(1)
print(f"봇 확인 — @{나['result'].get('username')}")

try:
    답 = 부르기("getUpdates?limit=100&allowed_updates=[\"message\",\"channel_post\",\"my_chat_member\"]")
except Exception as e:
    print(f"소식을 못 받았습니다: {e}"); sys.exit(1)

방 = {}
for u in 답.get("result", []):
    for k in ("channel_post", "message", "edited_channel_post", "my_chat_member"):
        c = (u.get(k) or {}).get("chat")
        if c:
            방[c["id"]] = (c.get("title") or c.get("username")
                           or f"{c.get('first_name','')} {c.get('last_name','')}".strip()
                           or "이름 없음", c.get("type", "?"))

if not 방:
    print()
    print("봇이 아는 채팅방이 하나도 없습니다. 두 가지를 확인해 주십시오.")
    print("  ① 그 채널에 이 봇을 **관리자로** 넣으셨습니까?")
    print("  ② 넣으신 **뒤에** 그 채널에 글을 하나 올리셨습니까?")
    print("     (봇을 넣기 전에 올린 글은 안 보입니다. 아무 글이나 새로 하나 올려 주십시오.)")
    sys.exit(3)

목록 = sorted(방.items(), key=lambda x: x[1][1] != "channel")
print()
print("  ── 봇이 아는 곳 ──────────────────────────────")
for i, (번호, (이름, 갈래)) in enumerate(목록, 1):
    print(f"   {i:>2}. {번호:<16} [{갈래}]  {이름}")
print("  ──────────────────────────────────────────────")
print()

if len(목록) == 1:
    고른 = 목록[0]
    print(f"하나뿐이라 이것으로 정합니다: {고른[1][0]}")
else:
    try:
        답변 = input("   번호를 골라 주세요 (그냥 Enter 면 취소) : ").strip()
    except (EOFError, KeyboardInterrupt):
        print("\n취소했습니다."); sys.exit(1)
    if not 답변.isdigit() or not (1 <= int(답변) <= len(목록)):
        print("취소했습니다."); sys.exit(1)
    고른 = 목록[int(답변) - 1]

번호 = str(고른[0])

env = pathlib.Path(".env")
글 = env.read_text(encoding="utf-8") if env.exists() else ""
import os
앞 = os.environ.get("PREFIX", "")
for 열쇠, 값 in ((앞 + "TELEGRAM_BOT_TOKEN", 토큰), (앞 + "TELEGRAM_CHAT_ID", 번호)):
    if re.search(rf"^[ \t]*{열쇠}=.*$", 글, re.M):
        글 = re.sub(rf"^[ \t]*{열쇠}=.*$", f"{열쇠}={값}", 글, flags=re.M)
    elif re.search(rf"^[ \t]*#{열쇠}=.*$", 글, re.M):
        글 = re.sub(rf"^[ \t]*#{열쇠}=.*$", f"{열쇠}={값}", 글, flags=re.M)
    else:
        글 = 글.rstrip("\n") + f"\n{열쇠}={값}\n"
env.write_text(글, encoding="utf-8")
env.chmod(0o600)

print()
print(f"✔ .env 에 적었습니다 — 채널 {번호} ({고른[1][0]})")
if 앞:
    print("  카드뉴스 전용으로 적었습니다. 제작 알림(알림.sh)은 그대로입니다.")
else:
    print("  이제 ./알림.sh \"시험\" \"잘 갑니다\" Glass 로 확인해 보십시오.")
PY
