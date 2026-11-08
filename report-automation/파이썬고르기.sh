# 이 폴더의 .venv 가 있으면 그것을 쓰고, 없으면 시스템 파이썬을 쓴다.
# 다른 스크립트에서:  . ./파이썬고르기.sh   한 뒤  "$PY3" 로 부른다.
if [ -n "${PY3:-}" ] && [ -x "$PY3" ]; then
  : # 상위 로컬 실행기가 선택한 이 설치의 Python을 유지한다.
elif [ -x "./.venv/bin/python3" ]; then
  PY3="$(pwd)/.venv/bin/python3"
elif [ -x "$HOME/기업분석리포트/.venv/bin/python3" ]; then
  PY3="$HOME/기업분석리포트/.venv/bin/python3"
else
  PY3="$(command -v python3 || echo /usr/bin/python3)"
fi
export PY3
