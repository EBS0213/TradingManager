#!/bin/bash
# 2026-09-14: launchd 환경에서도 같은 Python과 Codex를 사용한다.
set -eu
cd "$(dirname "$0")"
. ./파이썬고르기.sh
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
export TZ=Asia/Seoul
exec "$PY3" -B -u 자동검토.py "$@"
