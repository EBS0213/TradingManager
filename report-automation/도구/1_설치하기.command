#!/bin/bash
cd "$(dirname "$0")/.."
[ -f ./파이썬고르기.sh ] && . ./파이썬고르기.sh
echo "===================================="
echo " 기업분석 리포트 - 필요한 프로그램 설치"
echo "===================================="
echo
if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 이 없습니다. https://www.python.org/downloads/ 에서 설치한 뒤 다시 실행하세요."
  read -n 1 -s -r -p "아무 키나 누르면 닫힙니다."; exit 1
fi
echo "· 파이썬: $(python3 -V)"
echo "· 라이브러리를 설치합니다 (몇 분 걸립니다)"
"$PY3" -m pip install --upgrade pip >/dev/null 2>&1
"$PY3" -m pip install -r requirements.txt || "$PY3" -m pip install --user -r requirements.txt
echo
echo "· 잘 도는지 확인 (가짜 데이터로 한 번 돌려봅니다)"
"$PY3" collect.py --demo
echo
echo "설치 완료. config.yaml 에 DART 인증키를 넣고 watchlist.csv 에 종목을 적으세요."
read -n 1 -s -r -p "아무 키나 누르면 닫힙니다."
