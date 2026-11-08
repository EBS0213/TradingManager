#!/bin/bash
# Finder entry point: prepare dependencies, then resume the private installation.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/opt/homebrew/bin:/opt/homebrew/opt/node@22/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
export NEXT_TELEMETRY_DISABLED=1
mkdir -p "$ROOT/logs"
exec > >(tee -a "$ROOT/logs/install.log") 2>&1
finish() {
  result=$?
  if [ "$result" -ne 0 ]; then
    echo "설치가 중단되었습니다. 로그: $ROOT/logs/install.log"
    echo "기존 기록은 유지됩니다. 원인을 해결한 뒤 이 파일을 다시 실행하세요."
    if [ -t 0 ]; then read -r -p "창을 닫으려면 Enter를 누르세요. " _; fi
  fi
  exit "$result"
}
trap finish EXIT
if [ "$(uname -s)" != Darwin ]; then echo 'macOS 전용입니다.'; exit 1; fi
if [ "$(id -u)" = 0 ]; then echo '관리자(root)가 아닌 일반 사용자로 실행하세요.'; exit 1; fi
if ! /bin/launchctl print "gui/$(id -u)" >/dev/null 2>&1; then
  echo 'macOS 사용자 서비스에 접근할 수 없습니다. Finder에서 Install-macOS.command를 실행하세요.'
  exit 1
fi
if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install || true
  echo 'Apple 개발 도구 설치 창에서 설치를 완료해 주세요. 완료를 기다리는 중입니다…'
  for ((attempt=0; attempt<900; attempt++)); do
    if xcode-select -p >/dev/null 2>&1; then break; fi
    sleep 2
  done
  xcode-select -p >/dev/null
fi
if ! command -v brew >/dev/null; then
  echo 'Homebrew가 필요합니다. 공식 설치기가 필요한 변경사항과 승인을 안내합니다.'
  installer="$(mktemp -t tradingmanager-homebrew)"
  curl --fail --show-error --location --retry 3 https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh -o "$installer"
  /bin/bash "$installer"
  rm -f "$installer"
fi
BREW="$(command -v brew)"
missing=()
if ! command -v node >/dev/null || ! node -e 'process.exit(Number(process.versions.node.split(".")[0])>=22?0:1)'; then missing+=(node@22); fi
if ! command -v python3 >/dev/null || ! python3 -c 'import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)'; then missing+=(python@3.12); fi
PG_PREFIX="$($BREW --prefix postgresql@18)"
if [ ! -x "$PG_PREFIX/bin/initdb" ]; then missing+=(postgresql@18); fi
if [ "${#missing[@]}" -gt 0 ]; then
  echo "필수 프로그램 준비: ${missing[*]}"
  HOMEBREW_NO_AUTO_UPDATE=1 "$BREW" install "${missing[@]}"
fi
if [ -x "$($BREW --prefix node@22)/bin/node" ]; then export PATH="$($BREW --prefix node@22)/bin:$PATH"; fi
PYTHON="$(command -v python3)"
if ! "$PYTHON" -c 'import sys; sys.exit(0 if sys.version_info >= (3,11) else 1)'; then PYTHON="$($BREW --prefix python@3.12)/bin/python3.12"; fi
cd "$ROOT"
"$PYTHON" desktop/setup.py "$@"
if [ "${1:-}" != --check ]; then open "$HOME/Desktop/TradingManager.app"; fi
