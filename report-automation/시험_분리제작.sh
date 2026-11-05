#!/bin/bash

# 2026-10-19 사용자 지시 — 「클로드 쪽 작업은 막아줘」. 이 시험은 claude -p 를 부르므로 막아 둡니다.
#  다시 쓰려면 ALLOW_CLAUDE_TEST=1 을 주고 실행하십시오.
[ "${ALLOW_CLAUDE_TEST:-}" = "1" ] || { echo "Claude 작업은 2026-10-19 부터 막혀 있습니다(Codex 담당). 시험_분리제작.sh 는 실행하지 않습니다."; exit 3; }
# ============================================================
#  분리 제작 시험 — 「자료 수집」과 「작성」을 서로 다른 세션으로 (2026-10-05 신설)
#
#    ./시험_분리제작.sh "VLO,Valero Energy Corporation"
#
#  왜 — 지금은 한 세션이 웹 원문 60~90개를 문맥에 쌓은 채 작성까지 해서, 문맥이
#  65만 토큰까지 커지고 한 건에 약 1억 토큰이 듭니다. 수집을 따로 떼면 작성 세션은
#  수집 노트만 보고 쓰므로 문맥이 작게 유지됩니다.
#
#  품질 보호 장치
#    · 수집 노트는 요약하지 않습니다 — 원문 숫자·출처 주소·인용문을 표로 그대로 남깁니다.
#    · 웹 원문은 파일로 저장해 두고, 작성 세션은 필요한 줄만 grep 으로 다시 찾아볼 수 있습니다.
#
#  **시험이므로 실제 산출물을 건드리지 않습니다.** 모든 결과는 out/_시험/<코드>/ 에만 씁니다.
#  report/ · 협업/ · 게시판 · 텔레그램에는 아무것도 가지 않습니다.
#  끝나면 로그/시험_분리제작_<코드>.log 에 단계별 토큰 사용량이 남습니다.
# ============================================================
CLAUDE="${CLAUDE:-}"   # 제작엔진.sh 는 set -u 를 전제하지 않습니다
cd "$(dirname "$0")" || exit 1
[ -f ./파이썬고르기.sh ] && . ./파이썬고르기.sh
. ./제작엔진.sh
claude찾기 || { echo "claude 를 찾지 못했습니다"; exit 1; }

LINE="${1:?사용법: ./시험_분리제작.sh \"코드,이름\"}"
CODE="${LINE%%,*}"
DIR="out/_시험/${CODE}"
LOG="로그/시험_분리제작_${CODE}.log"
MODEL="${REPORT_MODEL:-claude-opus-5-5}"
mkdir -p "$DIR/원문" 로그
: > "$LOG"

쓴양() {   # claude --output-format json 결과에서 토큰을 뽑아 로그에 남깁니다
  "$PY3" - "$1" "$2" >> "$LOG" <<'PYEOF'
import json, sys
단계, 파일 = sys.argv[1], sys.argv[2]
try:
    j = json.loads(open(파일, encoding="utf-8").read().strip().splitlines()[-1])
    u = j.get("usage", {})
    tot = sum(u.get(k, 0) for k in ("input_tokens", "output_tokens",
                                     "cache_read_input_tokens", "cache_creation_input_tokens"))
    print(f"[{단계}] 총 {tot/1e6:.1f}M 토큰 · 출력 {u.get('output_tokens',0)/1e3:.0f}K"
          f" · 턴 {j.get('num_turns')} · 비용표시 ${j.get('total_cost_usd', 0):.2f}")
except Exception as e:
    print(f"[{단계}] 사용량을 읽지 못했습니다: {e}")
PYEOF
}

# ── 1단계: 자료 수집 ─────────────────────────────────────────
A="$(cat 제작지시.md)

---
## 이번 세션의 역할 — **자료 수집만** 합니다 (분리 제작 시험)

종목: ${LINE}

위 제작지시의 「2. 재료」와 「4. 절마다 반드시 채울 것」이 요구하는 자료를 **모으기만** 하십시오.
보고서·요약·PDF·인계는 **쓰지 마십시오.** 그것은 다음 세션이 합니다.

산출 두 가지:
1. \`${DIR}/원문/\` — 열어 본 웹 페이지·공시·IR 자료의 본문을 파일로 저장합니다
   (\`curl\` 로 받아 텍스트로 바꿔 저장, 파일 이름에 출처를 알 수 있게).
2. \`${DIR}/수집노트.md\` — 절(II~VIII)별로 **요약하지 말고** 다음을 표로 남깁니다.
   | 항목 | 값(원문 숫자 그대로) | 기준일·기간 | 출처 주소 | 원문 파일 | 원문 인용 한 줄 |
   증권사·경쟁사 의견, 반대 의견(약세 쪽), 컨퍼런스 콜 발언도 같은 표에 넣습니다.
   찾지 못한 항목은 「미확인 — 시도한 곳」으로 적습니다. 지어내지 마십시오.

report/ · 협업/ · 게시판에는 아무것도 쓰지 마십시오. 무인 실행이니 묻지 말고 바로 시작하십시오."

echo "== 1단계 수집 시작 $(date '+%F %T')" >> "$LOG"
"$CLAUDE" -p "$A" --model "$MODEL" --output-format json \
  --permission-mode dontAsk \
  --allowedTools "Read,Write,Edit,Bash,Glob,Grep,WebFetch,WebSearch" \
  </dev/null > "$DIR/1단계.json" 2>>"$LOG"
쓴양 "1단계 수집" "$DIR/1단계.json"
[ -s "$DIR/수집노트.md" ] || { echo "수집노트가 없습니다 — 중단" >> "$LOG"; exit 2; }

# ── 2단계: 작성 (웹 도구 없음) ────────────────────────────────
B="$(cat 제작지시.md)
$([ -f 지시문/_공통_문체기준.md ] && cat 지시문/_공통_문체기준.md)

---
## 이번 세션의 역할 — **작성만** 합니다 (분리 제작 시험)

종목: ${LINE}

자료 수집은 앞 세션이 끝냈습니다.
· \`${DIR}/수집노트.md\` 를 먼저 읽으십시오. 숫자와 출처는 여기 있는 그대로 씁니다.
· 더 필요한 대목은 \`${DIR}/원문/\` 에서 **grep 으로 필요한 줄만** 찾아 읽으십시오. 파일을 통째로 읽지 마십시오.
· 이 세션에는 웹 도구가 없습니다. 꼭 필요한 숫자가 노트와 원문 어디에도 없으면
  \`curl\` 로 받아 \`${DIR}/원문/\` 에 저장한 뒤 grep 하십시오.

**시험이므로 산출 위치가 다릅니다.** 제작지시의 「8. 산출」「9. 인계」에 적힌 자리 대신
보고서 HTML·PDF·요약본을 모두 \`${DIR}/\` 에 만드십시오.
report/ · 협업/검토대기/ · 게시판 · 텔레그램에는 **아무것도 쓰지 마십시오.** 인계 파일은 만들지 않습니다.
무인 실행이니 묻지 말고 바로 시작하십시오."

echo "== 2단계 작성 시작 $(date '+%F %T')" >> "$LOG"
"$CLAUDE" -p "$B" --model "$MODEL" --output-format json \
  --permission-mode dontAsk \
  --allowedTools "Read,Write,Edit,Bash,Glob,Grep" \
  </dev/null > "$DIR/2단계.json" 2>>"$LOG"
쓴양 "2단계 작성" "$DIR/2단계.json"
echo "== 끝 $(date '+%F %T') · 산출: $(ls "$DIR"/*.pdf 2>/dev/null | head -1)" >> "$LOG"
cat "$LOG"
