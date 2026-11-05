#!/bin/bash
# 수집이 끝난 종목 중 보고서가 없는 것을 찾아 바로 제작합니다.
#   · Finder 에서 더블클릭
#   · 또는 터미널에서:  ./4_지금_보고서_만들기.command
#   · 종목을 직접 고르려면:  ./4_지금_보고서_만들기.command 005930 CDNA
cd "$(dirname "$0")/.." || exit 1
[ -f ./파이썬고르기.sh ] && . ./파이썬고르기.sh
mkdir -p 로그 report

# ── 맥이 잠들지 않게 붙잡는다 ────────────────────────────────────────
# 2026-08-26 추가 — 새벽에 맥북이 잠들면서 8종목이 통째로 죽었다.
#   "API Error: Your computer went to sleep mid-response"
# caffeinate 를 이 스크립트의 수명(-w $$)에 묶어 둔다. 스크립트가 끝나면
# 알아서 풀리므로 따로 꺼 줄 필요가 없다.
#   -i 유휴 잠자기 금지 / -m 디스크 잠자기 금지 / -s 전원 연결 시 시스템 잠자기 금지
if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -ims -w $$ &
  echo "  · 작업이 끝날 때까지 맥이 잠들지 않게 잡아 둡니다 (caffeinate)"
fi

# ── PATH 를 사람이 쓰는 셸과 같게 맞춘다 ─────────────────────────────
# Finder 로 더블클릭하면 PATH 가 /usr/bin:/bin 뿐이라, claude 가 깔려 있어도
# `command -v claude` 가 실패한다. 프로필을 읽어 PATH 를 채우고,
# 그래도 없으면 알려진 설치 위치를 직접 뒤진다.
for rc in "$HOME/.zprofile" "$HOME/.zshrc" "$HOME/.bash_profile" "$HOME/.profile"; do
  [ -r "$rc" ] && . "$rc" >/dev/null 2>&1
done
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:$HOME/.claude/local:$HOME/.npm-global/bin:$HOME/bin"

# 실제 실행기와 본인 로그인은 제작엔진/코덱스실행에서 확인합니다.

clear
echo "════════════════════════════════════════════════════════"
echo "   기업분석 보고서 제작"
echo "════════════════════════════════════════════════════════"
echo

# ── 1. 만들 종목 고르기 ──────────────────────────────────────────────
# 목록을 화면에 띄우고 사람이 고른다. 그냥 Enter 면 '아직 없는 것 전부'.
# 종목코드를 인자로 주면 묻지 않고 그 종목만 만든다(이미 있어도 다시).
rm -f 일시정지.flag                      # 지난번 일시정지 표시를 지운다
"$PY3" -u 종목고르기.py "$@"
GOLLA=$?
[ "$GOLLA" -eq 9 ] && { echo; echo "  만들 종목이 없습니다."; echo; read -n 1 -s -r -p "  아무 키나 누르면 닫힙니다."; exit 0; }
[ "$GOLLA" -eq 1 ] && { echo; read -n 1 -s -r -p "  아무 키나 누르면 닫힙니다."; exit 0; }

# ── 2. 실행기 확인 ─────────────────────────────────────────────────
# 2026-10-19 사용자 지시 — 「이제 코덱스가 담당해. 클로드 쪽 작업은 막아줘」.
#  제작은 제작엔진.sh 가 Codex 로 합니다. 여기서 Claude 로 로그인을 찔러 보던
#  줄(claude -p "OK…")은 지웠습니다. 원본은 같은 폴더의 .bak_20261019 입니다.
echo
if [ ! -x "$HOME/.local/bin/codex" ] && ! command -v codex >/dev/null 2>&1; then
  echo "  ✗ 이 맥에서 Codex CLI 를 찾지 못했습니다."
  echo
  read -n 1 -s -r -p "  아무 키나 누르면 닫힙니다."; exit 1
fi
echo "  실행기     : Codex (제작엔진.sh)"
echo "  지시문     : 제작지시.md  (내용을 고치면 바로 반영됩니다)"
echo
echo "  종목당 20~40분 걸립니다. 검증까지 포함한 시간입니다."
printf "  시작할까요? (y = 시작 / 그 외 = 취소) : "
read -r GO
case "$GO" in y|Y) ;; *) echo "  취소했습니다."; read -n 1 -s -r -p "  아무 키나 누르면 닫힙니다."; exit 0;; esac

# ── 3. 제작 ─────────────────────────────────────────────────────────
# 2026-08-26 개편 — 종목 2개를 동시에 만든다.
# 한 건에 40분이 걸리는데 그 40분은 거의 전부 '읽고 쓰는' 시간이라 줄일 수가 없다.
# 대신 종목끼리는 서로 상관이 없으므로 나란히 돌린다. 만드는 과정은 똑같으므로
# 품질은 변하지 않는다. 실제 일은 '제작엔진.sh' 가 한다.
JOBS="${MAKE_JOBS:-2}"

. ./제작엔진.sh
run_all 제작목록.txt "$JOBS"

echo
echo "    보고서 PDF : report 폴더"
echo "    낱장 이미지 : out/<종목>/이미지 폴더"
echo "    종목별 로그 : 로그/종목_<코드>.log"
echo
read -n 1 -s -r -p "  아무 키나 누르면 닫힙니다."
