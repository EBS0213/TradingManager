#!/bin/bash
# 관심종목 목록을 보여주고, 원하면 편집기로 열어 준다.
cd "$(dirname "$0")/.." || exit 1
[ -f ./파이썬고르기.sh ] && . ./파이썬고르기.sh
clear
echo "════════════════════════════════════════════════════════"
echo "   관심종목"
echo "════════════════════════════════════════════════════════"
"$PY3" - <<'PYX'
import sys
sys.path.insert(0, ".")
import 워치리스트도구 as W
fs = W.csv파일들()
본 = W.읽기()
if not fs:
    print("  관심종목 CSV 파일을 찾지 못했습니다.")
    print("  'Watchlist' 또는 '관심종목' 폴더 안에 csv 를 넣어 주세요.")
    raise SystemExit(0)
print(f"  파일 : {fs[0]}")
if len(fs) > 1:
    print("  (같이 읽는 파일: " + ", ".join(str(f) for f in fs[1:]) + ")")
print(f"  모두 {len(본)}종목")
print("────────────────────────────────────────────────────────")
국내 = [(c, n) for c, n in 본.items() if c.isdigit()]
해외 = [(c, n) for c, n in 본.items() if not c.isdigit()]
if 국내:
    print(f"  ■ 국내 {len(국내)}종목")
    for i, (c, n) in enumerate(국내, 1):
        print(f"   {i:>3}. {c:<8s} {n}")
if 해외:
    print(f"\n  ■ 해외 {len(해외)}종목")
    for i, (c, n) in enumerate(해외, 1):
        print(f"   {i:>3}. {c:<8s} {n}")
print("────────────────────────────────────────────────────────")
open("/tmp/관심종목_파일경로.txt", "w").write(str(fs[0]))
PYX
echo
printf "  고치시겠습니까? (y = 편집기로 열기 / 그 외 = 닫기) : "
read -r GO
if [ "$GO" = "y" ] || [ "$GO" = "Y" ]; then
  F=$(cat /tmp/관심종목_파일경로.txt 2>/dev/null)
  [ -n "$F" ] && open -e "$F"
  echo
  echo "  한 줄에  \"코드\",\"종목명\",\"메모\",\"추가일\"  형식입니다."
  echo "  고치고 저장하면 바로 반영됩니다. 지울 종목은 그 줄을 통째로 지우세요."
  echo "  바꾸기 전 파일은 '백업' 폴더에 있습니다."
  echo
fi
read -n 1 -s -r -p "  아무 키나 누르면 닫힙니다."
