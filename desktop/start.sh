#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
exec node "$ROOT/desktop/start.mjs"
