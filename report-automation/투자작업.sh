#!/bin/bash
# 투자 관련 정기 작업을 돌린다.
#   ./투자작업.sh 시황전략 | 장전브리핑 | 미국종목종합 | 한국종목종합 | 매매평가 | 주간피드백
# 지시문/<이름>.md 를 claude 에게 넘긴다. 지시문을 고치면 다음 실행부터 바로 반영된다.
cd "$(dirname "$0")" || exit 1
[ -f ./파이썬고르기.sh ] && . ./파이썬고르기.sh
JOB="$1"
case "$JOB" in
  한국종목종합|미국종목종합)
    echo "관심종목 종합 보고서 제작은 사용자 요청으로 중단되었습니다."
    exit 0 ;;
esac
# 두 번째 인자가 "손"이면 사람이 직접 누른 것 — 지시문이 이것으로 휴장일 처리를 가른다
[ "$2" = "손" ] && export SUON=1
[ -n "$SUON" ] && export SUON=1     # 앱이 환경변수로 줘도 인정한다
[ -z "$JOB" ] && { echo "무엇을 할지 알려 주세요: 시황전략 / 장전브리핑 / 미국종목종합 / 한국종목종합 / 매매평가 / 주간피드백 / 컨퍼런스콜"; exit 2; }
MD="지시문/${JOB}.md"
[ -f "$MD" ] || { echo "지시문을 찾지 못했습니다: $MD"; exit 2; }
# 모든 작업에 같은 문체기준을 붙인다 (2026-09-07).
#  지시문 일곱 개를 따로 고치지 않아도 되고, 새 지시문을 만들어도 자동으로 붙는다.
#  파일이 없으면 그냥 넘어간다 — 기준이 없다고 작업을 막지는 않는다.
STYLE="지시문/_공통_문체기준.md"
mkdir -p 로그 브리핑 매매로그

for rc in "$HOME/.zprofile" "$HOME/.zshrc" "$HOME/.bash_profile" "$HOME/.profile"; do
  [ -r "$rc" ] && . "$rc" >/dev/null 2>&1
done
export PATH="$PATH:/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:$HOME/.claude/local:$HOME/.npm-global/bin:$HOME/bin"
[ -x "$HOME/.local/bin/codex" ] || command -v codex >/dev/null 2>&1 || { echo "Codex CLI 없음"; exit 1; }

LOCK="투자작업_${JOB}.lock"
if [ -f "$LOCK" ] && kill -0 "$(cat "$LOCK" 2>/dev/null)" 2>/dev/null; then
  echo "이미 돌고 있습니다."; exit 0
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT INT TERM
command -v caffeinate >/dev/null 2>&1 && caffeinate -ims -w $$ &

# 시황·전략 보고서를 쓰기 전에 오늘 증권사 리포트를 먼저 받아 둡니다 (2026-09-05).
#  이 일이 7시에 시작하므로, 수집 예약을 따로 만들 필요가 없습니다.
#  못 받아도 그냥 넘어갑니다 — 리포트가 없어도 밤사이 소식과 지표로 보고서는 씁니다.
#  2026-10-05 부터 와이즈리포트를 못 씁니다 — 네이버(로그인 없음)와 증권사 계정으로 받습니다.
#  와이즈수집.py 는 지우지 않고 남겨 두었습니다. 여기서 부르지만 않습니다.
if [ "$JOB" = "시황전략" ]; then
  echo "── 증권사 리포트 받아오기 $(date '+%F %H:%M:%S') ──" >> "로그/리포트수집.log"
  "$PY3" -u 네이버리포트받기.py --산업만 >> "로그/리포트수집.log" 2>&1 || true
  [ -f 증권사리포트받기.py ] && { "$PY3" -u 증권사리포트받기.py --산업만 >> "로그/리포트수집.log" 2>&1 || true; }
fi

# 컨퍼런스콜은 「미국 시총 상위 100」 이 대상입니다 (2026-09-14 사용자 지시).
#  목록이 없거나 한 달이 넘었으면 먼저 새로 만듭니다. 5분쯤 걸립니다.
#  못 만들어도 그냥 갑니다 — 예전 목록으로라도 일은 돕니다.
if [ "$JOB" = "컨퍼런스콜" ] && [ -f 도구/미국시총상위.py ]; then
  TOP="캐시/미국시총상위.json"
  if [ ! -s "$TOP" ] || [ -z "$(find "$TOP" -mtime -30 2>/dev/null)" ]; then
    echo "── 미국 시총 상위 100 새로 만들기 $(date '+%H:%M:%S') ──" >> "로그/${JOB}.log"
    "$PY3" -u 도구/미국시총상위.py --만들기 >> "로그/${JOB}.log" 2>&1 || true
  fi
fi

# 한국투자증권 「독점 글로벌 리서치」 목록을 받아 둡니다 (2026-09-14).
#  로그인이 필요 없는 자료라 무인 실행에서도 됩니다. 제목·요약·애널리스트·날짜가 옵니다.
#  원문 PDF 는 보안프로그램이 있어야 해서 여기서 받지 않습니다 (한투리포트.command 참고).
if [ -f 한투리서치받기.py ]; then
  case "$JOB" in
    컨퍼런스콜|미국종목종합|시황전략)
      "$PY3" -u 한투리서치받기.py --새것 --쪽수 5 >> "로그/${JOB}.log" 2>&1 || true ;;
  esac
fi

LOG="로그/${JOB}.log"
{
  echo ""
  echo "===== $JOB  $(date '+%Y-%m-%d %H:%M:%S') ====="
} >> "$LOG"

TRY=0
STARTED=$(date +%s)
EMPTYRUN=0
while : ; do
  SAY="$(mktemp)"
  # 2026-09-14 — 프롬프트 **맨 끝**에 명령 한 줄을 붙입니다.
  #  9/8 부터 절반이 「무엇을 도와드릴까요」로 10초 만에 끝났습니다. 지시문 앞에는 역할 규정이,
  #  뒤에는 문체기준이 붙어 정작 할 일이 문서 가운데 묻혔던 탓입니다. 실패가 0건인
  #  제작엔진.sh 는 끝에 「이번에 만들 종목(이 한 종목만 만드세요)」를 붙입니다. 그것을 따릅니다.
  JOB_PROMPT="$(cat "$MD")${SUON:+

> 사람이 손으로 「지금 만들기」를 눌러 실행한 것입니다(SUON=1). 휴장일이어도 만드십시오.}$([ -f "$STYLE" ] && cat "$STYLE")

---

## 지금 할 일

위 **「${JOB} 지시문」을 지금 그대로 수행**하십시오. 산출물까지 만들어야 끝난 것입니다.
이것은 launchd 무인 자동 실행입니다 — **되물어도 답할 사람이 없습니다.**
무엇을 할지 묻지 말고, 확인을 구하지 말고, 바로 시작하십시오.
(휴장일 판정으로 만들지 않기로 했다면 그 사유를 한 줄로 남기고 끝내면 됩니다.)"
  "$PY3" 코덱스실행.py --role analysis --mode agent --timeout 10800 \
    --model "${CODEX_INVEST_MODEL:-gpt-6.1-sol}" <<< "$JOB_PROMPT" 2>&1 | tee -a "$LOG" > "$SAY"
  RC=${PIPESTATUS[0]}
  if [ "$RC" -eq 75 ]; then rm -f "$SAY"; echo "Codex 사용량 한도 — 다음 예약까지 중지"; exit 75; fi
  if grep -qiE "session limit|usage limit|rate limit|too many requests|quota" "$SAY"; then
    TRY=$((TRY+1)); rm -f "$SAY"
    if [ "$TRY" -gt 24 ]; then
      ./알림.sh "$JOB 을 못 끝냈습니다" "사용량 한도가 4시간 넘게 안 풀렸습니다" Basso; exit 1
    fi
    echo "  ⏸ 사용량 한도. 10분 뒤 다시 시도합니다."; sleep 600; continue
  fi
  rm -f "$SAY"
  break
done

# ── 빈손 종료 잡기 (2026-09-14 신설) ──
#  지시문을 받고도 「무엇을 도와드릴까요」로 10초 만에 끝나는 실패가 있었습니다.
#  종료코드가 0 이라 아무 표시가 없어 다음 날까지 아무도 몰랐습니다. 이제 시끄럽게 만듭니다.
#  휴장일에 한 줄만 남기고 끝내는 것은 정상이므로 그건 빼고 봅니다.
ELAPSED=$(( $(date +%s) - STARTED ))
if [ "$RC" -eq 0 ] && [ "$ELAPSED" -lt 90 ]; then
  if tail -25 "$LOG" | grep -qE "장이 열리지 않|휴장|거래일이 아"; then
    echo "  (휴장일이라 만들지 않았습니다 — 정상입니다)" >> "$LOG"
  else
    EMPTYRUN=1; RC=3
    {
      echo "  ✗ 빈손 종료 — ${ELAPSED}초 만에 끝났고 휴장 안내도 없습니다."
      echo "    지시문이 수행되지 않았습니다. 로그 맨 끝을 보십시오."
    } >> "$LOG"
  fi
fi

# 2026-09-15: 길이만 검사한 초안이 발송되던 문제. Claude가 문맥까지 확인한 판본만 발송한다.
if [ "$RC" -eq 0 ] && [ "$JOB" = "시황전략" ]; then
  TODAY="$(TZ=Asia/Seoul date '+%Y-%m-%d')"
  if [ -s "브리핑/$TODAY/텔레그램전략_${TODAY}.txt" ]; then
    "$PY3" -B 전략문체마무리.py "$TODAY" >> "$LOG" 2>&1 || RC=4
  fi
fi

# ── 완성된 요약본을 텔레그램 채널로 보냅니다 (2026-09-08 사용자 지시) ──
#  보고서를 다 쓴 **뒤에** 보냅니다. 휴장일이라 안 만들어졌으면 파일이 없으니 그냥 넘어갑니다.
#  게시판 게재와는 별개입니다 — 이건 사람이 읽을 요약을 채널에 흘려 주는 것입니다.
#  보낼 것을 늘리려면 아래 case 에 한 줄 더하면 됩니다.
if [ "$RC" -eq 0 ] && [ -x ./채널발송.sh ]; then
  TODAY="$(TZ=Asia/Seoul date '+%Y-%m-%d')"
  SUMMARY=""; SUBJECT=""
  case "$JOB" in
    시황전략) SUMMARY="브리핑/$TODAY/텔레그램전략_${TODAY}.txt"; SUBJECT="[시황·전략] $TODAY" ;;
  esac
  if [ -n "$SUMMARY" ] && [ -s "$SUMMARY" ]; then
    # 전용 글이 길면 끝을 자르지 않고 재작성 대상으로 남긴다.
    if ! "$PY3" -c 'import pathlib,sys; n=len(pathlib.Path(sys.argv[1]).read_text().strip()); sys.exit(0 if 0<n<=3500 else 1)' "$SUMMARY"; then
      echo "  (텔레그램 글의 길이 기준 미충족: $SUMMARY)" >> "$LOG"
    else
    # 2026-10-04 — 문단마다 카드 한 장으로 묶어 보냅니다(글카드뉴스.py). 실패하면 예전처럼 글로 보냅니다.
    if "$PY3" -B 글카드뉴스.py 전략 "$SUMMARY" >> "$LOG" 2>&1; then
      echo "  (카드뉴스로 채널 발송 완료)" >> "$LOG"
    else
      echo "  (카드뉴스 실패 — 글로 대신 보냅니다)" >> "$LOG"
      ./채널발송.sh "$SUBJECT" "$SUMMARY" >> "$LOG" 2>&1 \
        || echo "  (채널 발송에 실패했습니다 — 보고서는 그대로 있습니다)" >> "$LOG"
    fi
    fi
  elif [ -n "$SUMMARY" ]; then
    echo "  (요약본이 없어 채널 발송을 건너뜁니다: $SUMMARY)" >> "$LOG"
  fi
fi

# 2026-10-27: 제작 성공 후 이번 작업의 완성 인계만 즉시 게시한다.
if [ "$RC" -eq 0 ]; then
  "$PY3" -B -u 완성게시.py --작업 "$JOB" --시작 "$STARTED" >> "$LOG" 2>&1 \
    || echo "  (자동 게시 실패: 같은 파일은 반복하지 않습니다. 로그를 확인하십시오)" >> "$LOG"
fi

if [ "$EMPTYRUN" -eq 1 ]; then
  ./알림.sh "$JOB 이 빈손으로 끝났습니다" \
            "${ELAPSED}초 만에 끝나 산출물이 없습니다 — 로그/${JOB}.log 를 보십시오" Basso
elif [ "$RC" -ne 0 ]; then
  ./알림.sh "$JOB 중 문제가 있었습니다" "로그/${JOB}.log 를 확인해 주세요" Basso
fi
echo "끝 $(date '+%H:%M:%S')  (종료코드 $RC)" >> "$LOG"
exit "$RC"
