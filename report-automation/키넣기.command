#!/bin/bash
# 한국투자증권 앱키·앱시크릿을 .env 에 넣습니다.
# 입력한 키는 화면에 찍히지 않고, 이 창의 기록에도 남지 않습니다.
# 파인더에서 두 번 눌러 실행하거나, 터미널에서 ./키넣기.command 로 실행하십시오.

cd "$(dirname "$0")" || exit 1
. ./파이썬고르기.sh

echo "════════════════════════════════════════════════════════"
echo "  한국투자증권 오픈API 키 넣기"
echo "════════════════════════════════════════════════════════"
echo
echo "  키가 없으면 먼저 발급하십시오:"
echo "    https://apiportal.koreainvestment.com  →  KIS Developers 신청"
echo
echo "  붙여넣어도 화면에 보이지 않습니다. 그대로 Enter 를 누르십시오."
echo

# 2026-09-14 고침 — 예전에는 `"$PY3" - <<PYEOF` 로 파이썬을 **표준입력으로** 넘겼습니다.
#  그러면 표준입력이 이 스크립트 본문에 물려 있어서, 아래 input() 이 EOF 를 만나
#  키를 받자마자 조용히 중단됐습니다. .env 는 그대로였고요. 임시 파일로 바꿉니다.
TMPPY="$(mktemp -t kiskey)"; mv "$TMPPY" "$TMPPY.py"; TMPPY="$TMPPY.py"
trap 'rm -f "$TMPPY"' EXIT INT TERM
export TM26_DIR="$PWD"
cat > "$TMPPY" <<'PYEOF'
import getpass
import os
import pathlib
import re
import sys

뿌리 = pathlib.Path(os.environ.get("TM26_DIR") or pathlib.Path.cwd())
env = 뿌리 / ".env"

def 묻기(이름, 설명, 최소길이):
    while True:
        값 = getpass.getpass(f"  {설명}: ").strip()
        if not 값:
            print("    건너뜁니다 (기존 값을 그대로 둡니다).")
            return None
        if len(값) < 최소길이:
            print(f"    너무 짧습니다 ({len(값)}자). {이름} 은 보통 {최소길이}자 이상입니다. 다시 넣으십시오.")
            continue
        if " " in 값 or "\n" in 값:
            print("    공백이 섞여 있습니다. 앞뒤가 잘렸는지 확인하고 다시 넣으십시오.")
            continue
        return 값

키 = 묻기("앱키", "앱키 (APP KEY)", 30)
시크릿 = 묻기("앱시크릿", "앱시크릿 (APP SECRET)", 100)

print()
구분 = input("  실전계좌로 쓰시겠습니까? [Y/n] (n 이면 모의계좌) ").strip().lower()
구분 = "demo" if 구분 in ("n", "no") else "real"

넣을것 = {}
if 키:
    넣을것["KIS_APP_KEY"] = 키
if 시크릿:
    넣을것["KIS_APP_SECRET"] = 시크릿
넣을것["KIS_ENV"] = 구분

if not 키 and not 시크릿 and env.exists():
    본문 = env.read_text(encoding="utf-8", errors="ignore")
    if "KIS_APP_KEY" not in 본문:
        print("\n  ✗ 넣은 것이 없고 기존 키도 없습니다. 아무것도 바꾸지 않았습니다.")
        sys.exit(1)

# 기존 줄은 살리고 KIS_* 만 갈아 끼운다
줄들 = env.read_text(encoding="utf-8", errors="ignore").splitlines() if env.exists() else []
바뀜 = set()
새줄들 = []
for line in 줄들:
    이름 = line.split("=", 1)[0].strip() if "=" in line else ""
    if 이름 in 넣을것:
        새줄들.append(f"{이름}={넣을것[이름]}")
        바뀜.add(이름)
    else:
        새줄들.append(line)
for 이름, 값 in 넣을것.items():
    if 이름 not in 바뀜:
        새줄들.append(f"{이름}={값}")

임시 = env.with_suffix(".env.새로")
임시.write_text("\n".join(새줄들).rstrip() + "\n", encoding="utf-8")
임시.chmod(0o600)
임시.replace(env)
env.chmod(0o600)

print()
print(f"  ✓ .env 에 넣었습니다 — {', '.join(sorted(넣을것))}")
print(f"    계좌 구분: {구분}")
PYEOF

"$PY3" "$TMPPY"
상태=$?
rm -f "$TMPPY"
echo
if [ $상태 -ne 0 ]; then
  echo "  중단했습니다."
  echo
  read -n 1 -s -r -p "  아무 키나 누르면 닫힙니다."
  exit $상태
fi

echo "════════════════════════════════════════════════════════"
echo "  이어서 연결을 확인합니다 (삼성전자 005930)"
echo "════════════════════════════════════════════════════════"
echo
"$PY3" -m src.kis 점검 005930

echo
echo "  위 「현재가 응답 원문」 목록을 Claude 에게 그대로 보여 주시면"
echo "  필드 이름을 대조해서 price.py 연결로 넘어갑니다."
echo "  (원문에는 키가 들어 있지 않으니 붙여넣어도 안전합니다)"
echo
read -n 1 -s -r -p "  아무 키나 누르면 닫힙니다."
echo
