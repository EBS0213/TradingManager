#!/bin/bash
# 조언자.sh — 만들어진 보고서를 다른 모델에게 검토시켜 지적표를 받는다.
#
#   쓰는 법:  ./조언자.sh  out/005930_삼성전자/삼성전자_005930_기업분석보고서_2026.09.18.html
#
#   - 고쳐 쓰라고 하지 않는다. 지적표만 받는다.
#   - **보고서를 건드리지 않는다.** 그래서 PDF 와 어긋나지 않고,
#     문체점검 14항목 통과도 그대로 유효하다.
#   - 지적표는 Codex 인계 파일에 「조언자 지적」 절로 붙인다.
#     반영 여부는 Codex 가 판단한다. 검토자를 셋으로 늘리지 않는다.
#   - 무슨 일이 있어도 원본을 잃지 않는다. 항상 exit 0.
#
# 2026-09-19 — 원안(3단계 자동반영)에서 반영 단계를 뺀 판본.
#   뺀 이유: 본체가 보고서 전체를 다시 뱉으면 길이 검문소로는 **숫자가 조용히
#   바뀌는 것**을 못 잡는다. 85% 하한은 잘림만 잡는다.

set -u
BASE="$HOME/기업분석리포트"
. "$BASE/파이썬고르기.sh"
LOG="$BASE/로그/조언자.log"
mkdir -p "$(dirname "$LOG")"

say() { echo "[$(date '+%m-%d %H:%M:%S')] $*" | tee -a "$LOG"; }

# ── 이 맥에는 timeout(1) 이 없다. coreutils 를 깔지 않고 쓰려고 직접 만든다.
#    쓰는 법: run_limited <초> <입력파일> <출력파일> <명령...>
#    백그라운드 작업의 stdin 은 bash 가 /dev/null 로 돌리므로 반드시 명시한다.
run_limited() {
  local secs="$1" infile="$2" outfile="$3"; shift 3
  "$@" < "$infile" > "$outfile" 2>>"$LOG" &
  local pid=$! i=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$i" -ge "$secs" ]; then
      kill -TERM "$pid" 2>/dev/null; sleep 2; kill -KILL "$pid" 2>/dev/null
      return 124
    fi
    sleep 1; i=$((i + 1))
  done
  wait "$pid"
}

HTML="${1:-}"
[ -n "$HTML" ] && [ -f "$HTML" ] || { say "파일 없음: $HTML"; exit 0; }
case "$HTML" in *.bak_*.html) say "백업본은 검토하지 않습니다: $HTML"; exit 0;; esac

# 종목코드: <종목명>_<코드>_기업분석보고서_<날짜>.html 의 두 번째 칸
STEM="$(basename "$HTML" .html)"
CODE="$(echo "$STEM" | awk -F_ '{print $2}')"
[ -n "$CODE" ] || { say "코드를 못 읽었습니다: $STEM"; exit 0; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
STAMP="$(shasum -a 256 "$HTML" | cut -c1-16)"

# ── 0단계. 이미 본 판본이면 여기서 끝낸다 ────────────────────────────
#    2026-09-19 — 중복 검사가 모델 호출 뒤에 있어서, 같은 보고서로 다시 돌리면
#    700KB 짜리 3분 호출을 한 번 더 하고 나서야 「이미 붙어 있음」을 알았다.
HAND="$(ls -1t "$BASE"/협업/검토대기/*_"${CODE}".md 2>/dev/null | head -1)"
if [ -n "$HAND" ] && grep -q "조언자 지적 · 판본 $STAMP" "$HAND" 2>/dev/null; then
  say "이 판본($STAMP)은 이미 붙어 있습니다 → 건너뜀 (모델 호출 안 함)"
  exit 0
fi

# ── 1단계. 기계 점검 먼저 (싸고 확실하다) ────────────────────────────
python3 "$BASE/src/문체점검.py" "$HTML" --보고서 > "$WORK/문체점검.txt" 2>&1
say "문체점검 완료 ($CODE)"

# ── 2단계. 조언자에게 지적표를 받는다 ─────────────────────────────────
cat > "$WORK/프롬프트.txt" <<'PROMPT_END'
너는 증권사 리서치센터의 심사역이다. 후배 애널리스트가 쓴 초고를 검토한다.

다음 세 파일이 이 보고서가 지켜야 할 기준이다. 반드시 먼저 읽어라.
  제작지시.md
  skills/기업분석리포트/references/섹션별_작성지침.md
  skills/기업분석리포트/references/추적관찰_지침.md

검토 대상 초고와, 기계 점검 결과가 함께 주어진다.
기계 점검이 이미 잡아낸 항목은 다시 지적하지 마라. 시간 낭비다.

너는 사람이 읽어야만 알 수 있는 것만 본다. 다음 다섯 가지다.

  1. 배점표 대비 빈 칸. 각 절의 배점을 보고, 배점에 비해 내용이 비어 있는
     절을 찾아라. 특히 II절(사업 개론·도해·지역별 매출·지분구조),
     VI-2절(블루팀 상방 요인)이 형식만 채우고 근거가 없는 경우가 잦다.
  2. 인용하지 않은 재료. 입력 폴더에 넣은 증권사 리포트·공시·어닝콜 중
     본문에서 한 번도 쓰이지 않은 것을 적시하라.
  3. 근거 없는 단정. 숫자나 출처 없이 단언한 문장을 그대로 인용하라.
  4. 추적관찰 항목이 업종 선행지표인가. "실적을 지켜봐야 한다" 같은
     동어반복이면 지적하라. 반도체면 ASP·IDM CAPEX, 바이오면 임상일정·
     탑라인처럼 업종 고유 지표여야 한다.
  5. 레드팀과 블루팀의 균형. 어느 한쪽이 다른 쪽을 압도하면 지적하라.

이 지적표는 **사람(Codex 검토자)이 읽고 판단할 재료**다. 자동으로 반영되지
않는다. 그러니 각 항목은 그 자체로 알아볼 수 있어야 한다. "III절이 부실하다"
처럼 뭉뚱그리지 말고, 어느 문장·어느 표인지 짚어라.

반드시 지킬 것:
  - 보고서를 고쳐 쓰지 마라. 문장을 새로 제안하지도 마라.
  - 파일을 쓰거나 고치지 마라. 읽기만 한다.
  - 아래 형식의 표 하나만 출력한다. 그 밖의 말은 한 줄도 쓰지 마라.
  - 정말 고칠 게 없으면 표를 비워라. 억지로 채우지 마라.
  - 최대 8건. 중요한 것부터.

| 절 | 무엇이 문제인가 | 무엇을 채워야 하는가 |
|---|---|---|
PROMPT_END

{
  cat "$WORK/프롬프트.txt"
  echo; echo "=== 기계 점검 결과 ==="; cat "$WORK/문체점검.txt"
  echo; echo "=== 초고 ==="; cat "$HTML"
} > "$WORK/입력.txt"

# 보고서가 1MB 에 육박한다. argv 로 넘기면 ARG_MAX(1,048,576)에 걸린다.
# 실제로 GigaCloud 보고서(1,065,668바이트)가 「Argument list too long」으로 죽었다.
# 그래서 stdin 으로 넘긴다.
say "조언자 호출 ($(wc -c < "$WORK/입력.txt") 바이트, 모델 ${CODEX_ADVISOR_MODEL:-gpt-6.1-sol})"
(
  cd "$BASE" || exit 1
  "$PY3" 코덱스실행.py --role analysis --mode text --timeout 600 \
    --model "${CODEX_ADVISOR_MODEL:-gpt-6.1-sol}" \
    < "$WORK/입력.txt" > "$WORK/지적표.md" 2>>"$LOG"
)
RC=$?
[ "$RC" -eq 124 ] && say "조언자 10분 초과 — 받은 데까지만 씁니다"

# 표 줄만 센다. 머리글(| 절 |)과 구분선(|---)은 빼고.
# 원안의 `grep -c ... || echo 0` 은 매치가 없을 때 grep 이 "0" 을 찍고
# 종료코드 1 을 내므로 echo 도 함께 돌아 "0\n0" 이 되어 산술이 깨졌다.
N=$(awk '/^\|/ && !/^\|[[:space:]]*-/ && !/^\|[[:space:]]*절[[:space:]]*\|/ {c++} END {print c+0}' \
      "$WORK/지적표.md" 2>/dev/null)
say "조언자 지적 ${N}건"

SIDE="${HTML%.html}_조언.md"
{
  echo "# 조언자 지적 — $STEM"
  echo "- 검토 시각: $(date '+%F %T') · 모델 ${CODEX_ADVISOR_MODEL:-gpt-6.1-sol} · 판본 $STAMP"
  echo "- 지적 ${N}건 · **자동 반영하지 않았습니다.** 반영 여부는 Codex 가 판단합니다."
  echo
  cat "$WORK/지적표.md"
} > "$SIDE"

if [ "$N" -lt 1 ]; then
  say "지적 없음 → 인계 파일은 건드리지 않습니다"
  exit 0
fi

# ── 3단계. 인계 파일에 붙인다. 보고서는 건드리지 않는다 ───────────────
if [ -z "$HAND" ]; then
  say "인계 파일이 아직 없습니다 (협업/검토대기/*_${CODE}.md) → $SIDE 에만 남깁니다"
  exit 0
fi

{
  echo
  echo "## 조언자 지적 · 판본 $STAMP"
  echo
  echo "$(date '+%F %T') · 모델 ${CODEX_ADVISOR_MODEL:-gpt-6.1-sol} · **미반영**."
  echo "보고서 본문·PDF 는 건드리지 않았습니다. 아래는 Codex 검토용 재료입니다."
  echo "기계 점검(문체점검 14항목)이 잡은 항목은 조언자에게 제외시켰습니다."
  echo
  cat "$WORK/지적표.md"
} >> "$HAND"

say "인계 파일에 붙였습니다 → ${HAND##*/} (${N}건)"
exit 0
