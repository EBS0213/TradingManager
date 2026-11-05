#!/bin/bash
# 자동 실행을 기다리지 않고 지금 바로 수집합니다. 더블클릭하면 됩니다.
cd "$(dirname "$0")/.." || exit 1
[ -f ./파이썬고르기.sh ] && . ./파이썬고르기.sh
mkdir -p 로그

clear
echo "════════════════════════════════════════════════════════"
echo "   기업분석 자료 수집기"
echo "════════════════════════════════════════════════════════"
echo
echo "  1)  점검만 하기        인터넷 없이 준비 상태만 확인 (10초)"
echo "  2)  전체 수집          watchlist.csv 의 종목 전부"
echo "  3)  한 종목만 수집     종목코드를 직접 입력"
echo "  4)  가짜 데이터로 시험  인터넷 없이 전 과정이 도는지만 확인"
echo
printf "  번호를 누르고 엔터 (그냥 엔터 = 1번 점검) : "
read -r PICK
PICK="${PICK:-1}"
echo

STAMP=$(date '+%Y-%m-%d %H:%M:%S')
LOG="로그/manual.log"

case "$PICK" in
  1)
    "$PY3" -u collect.py --check
    ;;
  2)
    echo "── 먼저 준비 상태를 봅니다 ──────────────────────────────"
    "$PY3" -u collect.py --check || true
    echo
    printf "  이대로 전체 수집을 시작할까요? (y = 시작 / 그 외 = 취소) : "
    read -r GO
    if [ "$GO" != "y" ] && [ "$GO" != "Y" ]; then
      echo "  취소했습니다."
    else
      echo
      echo "  시작합니다. 중간에 멈추려면 Control + C 를 누르세요."
      echo "  진행 내용은 화면과 '로그/manual.log' 에 같이 쌓입니다."
      echo "────────────────────────────────────────────────────────"
      echo "" >> "$LOG"; echo "===== 수동 수집 시작 $STAMP =====" >> "$LOG"
      "$PY3" -u collect.py 2>&1 | tee -a "$LOG"
    fi
    ;;
  3)
    printf "  종목코드를 입력하세요 (예: 131290, 해외는 MXL) : "
    read -r CODE
    if [ -z "$CODE" ]; then
      echo "  종목코드가 비어 있어 취소했습니다."
    else
      echo "" >> "$LOG"; echo "===== 수동 수집 시작 ($CODE) $STAMP =====" >> "$LOG"
      "$PY3" -u collect.py "$CODE" 2>&1 | tee -a "$LOG"
    fi
    ;;
  4)
    "$PY3" -u collect.py --demo
    ;;
  *)
    echo "  1~4 중에서 골라주세요."
    ;;
esac

echo
echo "════════════════════════════════════════════════════════"
echo "  끝났습니다. 결과는 'out' 폴더에 종목별로 들어 있습니다."
echo "  클로드에게 '○○ 보고서 만들어줘' 라고 하면 이걸 읽고 씁니다."
echo "════════════════════════════════════════════════════════"
echo
printf "  이 창을 닫으려면 엔터를 누르세요 "
read -r _
