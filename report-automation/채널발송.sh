#!/bin/bash
[ "${TM26_AUTOMATION_LOCAL_ONLY:-0}" = 1 ] && exit 0
# 완성된 보고서·브리핑을 텔레그램 채널로 보냅니다. (2026-09-08 신설)
#
#   ./채널발송.sh "제목" <파일.html|.txt|.md> [--확인]
#
#   --확인 을 붙이면 보내지 않고 무엇이 나갈지만 화면에 찍습니다.
#
# 어디로 가나 — 사이트의 `/api/screener/alert` 를 부릅니다. 이 길은 **스카우트 결과를
# 받는 채널**로 갑니다. 사용자가 브리핑·전략 요약도 그 채널로 보내 달라고 했습니다
# (2026-09-08). 봇 토큰은 Vercel 에만 있고 이 맥은 `~/.tm26_key` 만 가집니다.
#
# ※ `알림.sh` 는 이 길을 쓰지 않습니다. 제작 완료·실패 알림이 그 채널에 섞이면 안 되기
#   때문입니다. 이 스크립트는 **사람이 읽을 완성된 글**만 보냅니다. 둘을 섞지 마십시오.
set -u

REPORT_ROOT="$(cd "$(dirname "$0")" && pwd)"
SITE="$(python3 "$REPORT_ROOT/로컬설정.py")" || exit 1
LIMIT=3900                                  # 텔레그램 한 통 4096자. 여유를 둡니다.

TITLE="${1:-}"
FILE="${2:-}"
PREVIEW=""
[ "${3:-}" = "--확인" ] && PREVIEW=1

if [ -z "$TITLE" ] || [ -z "$FILE" ]; then
  echo "쓰는 법: $(basename "$0") \"제목\" <파일> [--확인]" >&2
  exit 2
fi
if [ ! -s "$FILE" ]; then
  echo "보낼 파일이 없거나 비어 있습니다: $FILE" >&2
  exit 2
fi

# ── 글 다듬기 ─────────────────────────────────────────────
# HTML 이면 태그를 걷어내고 사람이 읽을 줄글로 만듭니다. 표는 「·」 로 이어 붙입니다.
BODY="$(TM26_TITLE="$TITLE" TM26_LIMIT="$LIMIT" /usr/bin/python3 - "$FILE" <<'PY'
import html, os, re, sys
from html.parser import HTMLParser

경로 = sys.argv[1]
글 = open(경로, encoding="utf-8", errors="ignore").read()

if 경로.lower().endswith((".html", ".htm")):
    class 훑기(HTMLParser):
        건너뛸것 = {"script", "style", "head", "title"}
        def __init__(self):
            super().__init__(); self.모음 = []; self.끄기 = 0
        def handle_starttag(self, t, a):
            if t in self.건너뛸것: self.끄기 += 1
            elif t in ("br", "p", "div", "tr", "li", "h1", "h2", "h3", "h4"):
                self.모음.append("\n")
            elif t in ("td", "th"):
                self.모음.append(" · ")
        def handle_endtag(self, t):
            if t in self.건너뛸것: self.끄기 = max(0, self.끄기 - 1)
            elif t in ("p", "div", "tr", "li", "h1", "h2", "h3", "h4"):
                self.모음.append("\n")
        def handle_data(self, d):
            if not self.끄기: self.모음.append(d)
    훑 = 훑기(); 훑.feed(글); 글 = "".join(훑.모음)

글 = html.unescape(글)
글 = re.sub(r"[ \t]+", " ", 글)
글 = re.sub(r" *· *(\n|$)", r"\1", 글)        # 줄 끝에 남은 표 구분자
글 = re.sub(r"\n{3,}", "\n\n", 글)
글 = "\n".join(줄.strip() for 줄 in 글.splitlines())
글 = re.sub(r"\n{3,}", "\n\n", 글).strip()

제목 = os.environ["TM26_TITLE"]
한도 = int(os.environ["TM26_LIMIT"])
머리 = f"📄 {제목}\n\n"
남은 = 한도 - len(머리)
if len(글) > 남은:
    잘린 = 글[: 남은 - 40]
    잘린 = 잘린[: 잘린.rfind("\n")] if "\n" in 잘린 else 잘린
    글 = 잘린 + "\n\n…(이어지는 내용은 홈페이지에서 보십시오)"
print(머리 + 글)
PY
)"

if [ -z "$BODY" ]; then
  echo "글이 비었습니다 — 파일을 확인하십시오: $FILE" >&2
  exit 1
fi

if [ -n "$PREVIEW" ]; then
  echo "──────── 이렇게 나갑니다 (${#BODY}자) ────────"
  printf '%s\n' "$BODY"
  echo "────────────────────────────────────────────"
  echo "(--확인 이라 보내지 않았습니다)"
  exit 0
fi

# ── 보내기 ────────────────────────────────────────────────
REPORT_ROOT="$(cd "$(dirname "$0")" && pwd)"
KEY="$(cd "$REPORT_ROOT" && python3 -c 'from 올리기 import 키찾기; print(키찾기())')"
if [ "${#KEY}" -ne 64 ]; then
  echo "키 길이가 이상합니다(${#KEY}자). 64자여야 합니다." >&2
  exit 3
fi

JSON="$(printf '%s' "$BODY" | /usr/bin/python3 -c 'import json,sys; print(json.dumps({"text": sys.stdin.read()}, ensure_ascii=False))')"
[ -n "$JSON" ] || { echo "보낼 것을 만들지 못했습니다." >&2; exit 1; }

CODE="$(curl -s -m 60 -o /dev/null -w '%{http_code}' -X POST \
  -H "x-screener-key: $KEY" -H 'Content-Type: application/json' \
  --data "$JSON" "$SITE/api/screener/alert" 2>/dev/null)"

if [ "$CODE" = "200" ]; then
  echo "✔ 보냈습니다 — $TITLE (${#BODY}자)"
  exit 0
fi
# 열쇠가 섞일 수 있으므로 curl 의 말은 그대로 내보내지 않습니다
echo "✗ 발송 실패 (HTTP $CODE) — report-automation/.env 와 로컬 서버 연결을 확인하십시오" >&2
exit 1
