#!/bin/bash
# 애플 실리콘용 파이썬을 이 폴더 전용으로 만든다.
#   ./파이썬설정.sh
# 지금 쓰는 파이썬은 건드리지 않는다. 이 폴더 안 '.venv' 에만 새로 만든다.
# 잘못되면 .venv 폴더만 지우면 원래대로 돌아간다.
cd "$(dirname "$0")" || exit 1
set -u

echo "════════════════════════════════════════════════════════"
echo "   TM26 — 파이썬 정리 (애플 실리콘용)"
echo "════════════════════════════════════════════════════════"
echo

echo "▶ 1. 지금 상태"
echo "   맥 종류      : $(uname -m)"
echo "   지금 python3 : $(command -v python3 || echo '없음')"
if command -v python3 >/dev/null 2>&1; then
  echo "   그 파이썬 종류: $(file -b "$(readlink -f "$(command -v python3)" 2>/dev/null || command -v python3)" 2>/dev/null | head -c 60)"
fi
echo "   홈브루       : $(command -v brew || echo '없음')"
echo

if ! command -v brew >/dev/null 2>&1; then
  echo "✗ 홈브루가 없습니다. 먼저 설치해 주세요:"
  echo '   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
  exit 1
fi
BREW_PREFIX="$(brew --prefix)"
if [ "$BREW_PREFIX" != "/opt/homebrew" ]; then
  echo "⚠ 홈브루가 $BREW_PREFIX 에 있습니다 (인텔용 자리)."
  echo "   애플 실리콘용은 /opt/homebrew 입니다. 그래도 진행은 합니다."
  echo
fi

echo "▶ 2. 애플 실리콘용 파이썬과 그림 라이브러리 설치"
brew install python@3.12 cairo pango libffi 2>&1 | tail -3
PYBIN="$BREW_PREFIX/opt/python@3.12/bin/python3.12"
if [ ! -x "$PYBIN" ]; then
  echo "✗ python@3.12 를 찾지 못했습니다: $PYBIN"; exit 1
fi
echo "   새 파이썬 : $PYBIN"
echo "   종류      : $(file -b "$PYBIN" | head -c 60)"
echo

echo "▶ 3. 이 폴더 전용 파이썬 방(.venv) 만들기"
if [ -d .venv ]; then
  echo "   이미 있습니다. 옛 것을 .venv_옛것 으로 옮기고 새로 만듭니다."
  rm -rf .venv_옛것 2>/dev/null
  mv .venv .venv_옛것
fi
"$PYBIN" -m venv .venv || { echo "✗ .venv 만들기 실패"; exit 1; }
echo "   만들었습니다: $(pwd)/.venv"
echo

echo "▶ 4. 라이브러리 설치 (5~15분 걸립니다)"
./.venv/bin/python -m pip install --upgrade pip >/dev/null 2>&1
if ! ./.venv/bin/python -m pip install -r requirements.txt; then
  echo
  echo "✗ 설치 중 문제가 있었습니다. 위 메시지를 그대로 알려 주세요."
  echo "   되돌리려면:  rm -rf .venv  (그러면 예전 파이썬을 그대로 씁니다)"
  exit 1
fi
echo

echo "▶ 5. 브라우저(PDF 만들 때 씀) 설치"
./.venv/bin/python -m playwright install chromium 2>&1 | tail -3
echo

echo "▶ 6. 확인"
./.venv/bin/python - <<'PYX'
import platform, sys
print("   파이썬     :", sys.version.split()[0], "·", platform.machine())
빠진 = []
for 이름, 모듈 in [("requests","requests"),("pyyaml","yaml"),("pandas","pandas"),
                 ("matplotlib","matplotlib"),("jinja2","jinja2"),("bs4","bs4"),
                 ("lxml","lxml"),("FinanceDataReader","FinanceDataReader"),
                 ("pykrx","pykrx"),("pdfplumber","pdfplumber"),("playwright","playwright"),
                 ("pillow","PIL"),("openpyxl","openpyxl"),("pdfminer","pdfminer"),
                 ("pypdfium2","pypdfium2"),("cairosvg","cairosvg")]:
    try:
        __import__(모듈)
    except Exception as e:
        빠진.append(f"{이름} ({type(e).__name__})")
if 빠진:
    print("   ✗ 안 되는 것:", ", ".join(빠진))
else:
    print("   ✔ 라이브러리 16개 모두 정상")
PYX
echo
echo "════════════════════════════════════════════════════════"
echo "  끝났습니다."
echo "  이제 TM26 의 모든 작업이 이 폴더의 .venv 파이썬을 씁니다."
echo "  문제가 생기면  rm -rf .venv  하면 예전 파이썬으로 돌아갑니다."
echo "════════════════════════════════════════════════════════"
