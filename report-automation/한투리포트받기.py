#!/usr/bin/env python3
"""한국투자증권 리서치 원문 PDF 를 받아 입력 폴더에 넣는다. (2026-09-14 신설)

    "$PY3" 한투리포트받기.py               로그인 확인 → 밀린 것 전부 받기 (보통 이것만 씁니다)
    "$PY3" 한투리포트받기.py --로그인       로그인 창만 띄우기
    "$PY3" 한투리포트받기.py --점검         로그인이 살아 있는지만 보기
    "$PY3" 한투리포트받기.py --받기 --개수 20

★ 2026-09-14 확인 — **이 맥에서는 아직 못 씁니다.**
    한국투자증권 로그인 화면이 **IPinside LWS 보안프로그램**을 요구합니다. 없으면
    설치 안내 화면으로 튕깁니다(사람 브라우저든 이 스크립트든 똑같습니다).
    이 맥에는 그 프로그램이 깔려 있지 않습니다 — 프로세스도 포트도 없습니다.
    그래서 지금은 **목록·요약만** 받습니다(`한투리서치받기.py`, 로그인 불필요).
    보안프로그램을 깔아 브라우저 로그인이 되는 환경이 되면 이 파일이 그대로 동작합니다.

로그인은 왜 사람이 하나
    한국투자증권 로그인은 **보안키보드(Xecure)와 전자서명 모듈**을 거칩니다. 그것을
    스크립트가 대신 치게 만드는 것은 보안장치를 우회하는 일이라 하지 않습니다.
    대신 **로그인만 사람이 한 번** 하고, 창이 열린 자리에서 로그인 흔적(쿠키)을 받아
    **나머지 내려받기를 전부 기계가** 합니다. 비밀번호는 이 스크립트도, 맥의 어느 파일도
    가지고 있지 않습니다. `와이즈수집.py` 와 같은 구조에서 로그인 단계만 사람 몫입니다.

    증권사 세션은 오래 안 갑니다(보통 몇십 분). 그래서 「로그인 → 밀린 것 한꺼번에」
    한 번으로 끝내는 흐름입니다. 무인 예약으로 돌리지 마십시오 — 세션이 끊겨 있습니다.

받은 PDF 가 가는 곳 (`리포트넣기.py` 가 이어받습니다)
    기업분석 → `입력_리포트PDF/`   산업분석 → `입력_산업리포트PDF/`   그 밖 → `입력_전략리포트PDF/`

저작권
    스티펠·국태해통증권 등 **제휴사 저작물**입니다. 읽고 우리 말로 요약하는 데만 씁니다.
    원문을 게시판에 올리거나 통째로 옮기지 마십시오.
"""
from __future__ import annotations

import json
import pathlib
import re
import sys
import time
import unicodedata as u
from datetime import datetime

import requests

뿌리 = pathlib.Path(__file__).resolve().parent
쌓인곳 = 뿌리 / "캐시" / "한투리서치.json"
자리 = 뿌리 / "캐시" / "kis_state.json"            # 로그인 흔적(쿠키). 비밀번호는 없습니다.
받은기록 = 뿌리 / "캐시" / "한투받은것.json"

사이트 = "https://securities.koreainvestment.com"
목록쪽 = 사이트 + "/main/research/research/Search.jsp"
로그인쪽 = 사이트 + "/main/member/login/login.jsp"
확인주소 = 사이트 + "/main/research/research/StrategyDetail.jsp?cmd=loginCheck"

브라우저표시 = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")


def nfc(x: str) -> str:
    return u.normalize("NFC", x or "")


# ── 로그인 흔적 ────────────────────────────────────────────────
def 쿠키세션() -> requests.Session | None:
    """저장해 둔 로그인 흔적으로 requests 세션을 만든다. 없으면 None."""
    if not 자리.exists():
        return None
    try:
        상태 = json.loads(자리.read_text(encoding="utf-8"))
    except Exception:                                # noqa: BLE001
        return None
    s = requests.Session()
    s.headers.update({"User-Agent": 브라우저표시, "Referer": 목록쪽})
    for c in 상태.get("cookies", []):
        if "koreainvestment" in (c.get("domain") or ""):
            s.cookies.set(c["name"], c["value"], domain=c["domain"].lstrip("."),
                          path=c.get("path", "/"))
    return s


def 표본하나() -> dict | None:
    """로그인 여부를 떠볼 리포트 한 건. 쌓아 둔 목록에서 원문파일이 있는 것을 고른다."""
    if not 쌓인곳.exists():
        return None
    글 = json.loads(쌓인곳.read_text(encoding="utf-8")).get("글") or {}
    for r in 글.values():
        if r.get("원문파일"):
            return r
    return None


def 원문주소(s: requests.Session, r: dict) -> tuple[str, str]:
    """(주소, 까닭). 로그인 안 됐으면 주소가 빈 글자이고 까닭이 적힌다."""
    본문 = {"type": "fileView", "filepath": r.get("원문묶음", ""),
            "filename": r.get("원문파일", ""), "option": "01",
            "datasubmitdate": (r.get("날짜") or "").replace("-", "."),
            "airYn": "N", "korYn": "Y", "special": "N",
            "returnUrl": "%2Fmain%2Fresearch%2Fresearch%2FSearch.jsp"}
    try:
        답 = s.post(확인주소, data=본문, timeout=30).json()
    except Exception as e:                           # noqa: BLE001
        return "", f"응답을 읽지 못했습니다: {str(e)[:60]}"
    주소 = 답.get("url") or ""
    if not 주소:
        return "", f"주소가 없습니다: {str(답)[:80]}"
    if "login.jsp" in 주소:
        return "", "로그인이 풀렸습니다"
    return (주소 if 주소.startswith("http") else 사이트 + 주소), ""


def 로그인됐나(조용히: bool = False) -> bool:
    s = 쿠키세션()
    if s is None:
        if not 조용히:
            print("  아직 로그인한 적이 없습니다.")
        return False
    r = 표본하나()
    if r is None:
        if not 조용히:
            print("  받아 둔 목록이 없습니다. 먼저:  \"$PY3\" 한투리서치받기.py --새것 --쪽수 5")
        return False
    주소, 까닭 = 원문주소(s, r)
    if not 조용히:
        print("  로그인 살아 있습니다." if 주소 else f"  로그인이 필요합니다 — {까닭}")
    return bool(주소)


def 로그인하기(기다림초: int = 300) -> bool:
    """창을 띄우고 사람이 로그인하기를 기다린다. 비밀번호는 사람이 직접 칩니다."""
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright 가 없습니다. 먼저:  .venv/bin/pip install playwright && "
              ".venv/bin/playwright install chromium")
        return False

    표본 = 표본하나()
    with sync_playwright() as pw:
        브 = pw.chromium.launch(headless=False, args=["--disable-blink-features=AutomationControlled"])
        맥락 = (브.new_context(storage_state=str(자리), locale="ko-KR", user_agent=브라우저표시)
                if 자리.exists() else 브.new_context(locale="ko-KR", user_agent=브라우저표시))
        쪽 = 맥락.new_page()
        쪽.goto(로그인쪽, wait_until="domcontentloaded", timeout=60000)

        print()
        print("  ┌─────────────────────────────────────────────────────┐")
        print("  │  열린 창에서 한국투자증권에 로그인해 주십시오.      │")
        print("  │  보안키보드라 사람이 직접 쳐야 합니다.              │")
        print("  │  로그인되면 이 창이 알아서 닫히고 받기가 시작됩니다.│")
        print("  └─────────────────────────────────────────────────────┘")
        print(f"  ({기다림초 // 60}분 기다립니다. 그만두시려면 창을 닫으십시오.)")
        print()

        끝 = time.time() + 기다림초
        됐다 = False
        while time.time() < 끝:
            time.sleep(3)
            try:
                맥락.storage_state(path=str(자리))
            except Exception:                        # noqa: BLE001
                break                                # 창이 닫혔다
            if 표본 is None:
                # 떠볼 리포트가 없으면 주소만 보고 판단한다
                if "login.jsp" not in 쪽.url:
                    됐다 = True
                    break
                continue
            if 로그인됐나(조용히=True):
                됐다 = True
                break

        if 됐다:
            맥락.storage_state(path=str(자리))
            자리.chmod(0o600)
            print("  ✓ 로그인 확인했습니다. 창을 닫습니다.")
        else:
            print("  로그인을 확인하지 못했습니다.")
        try:
            브.close()
        except Exception:                            # noqa: BLE001
            pass
    return 됐다


# ── 받기 ───────────────────────────────────────────────────────
def 갈곳(갈래: str) -> pathlib.Path:
    if "산업" in 갈래:
        return 뿌리 / "입력_산업리포트PDF"
    if "기업" in 갈래:
        return 뿌리 / "입력_리포트PDF"
    return 뿌리 / "입력_전략리포트PDF"


def 파일이름(r: dict) -> str:
    """`리포트넣기.py` 가 종목을 찾을 수 있게 티커·종목코드를 이름에 넣는다."""
    제목 = re.sub(r"[/:\\\n\r\t]", " ", nfc(r.get("제목", "무제")))[:70].strip()
    티 = f"({r['티커']})" if r.get("티커") else ""
    날 = (r.get("날짜") or "").replace("-", "")
    return f"한투_{제목}{티}_{날}.pdf".replace("  ", " ")


def 받은것() -> dict:
    if 받은기록.exists():
        try:
            return json.loads(받은기록.read_text(encoding="utf-8"))
        except Exception:                            # noqa: BLE001
            pass
    return {}


def 받기(개수: int = 30) -> int:
    s = 쿠키세션()
    if s is None:
        print("  로그인 흔적이 없습니다. --로그인 을 먼저 하십시오.")
        return 1
    if not 쌓인곳.exists():
        print("  받아 둔 목록이 없습니다. 먼저:  \"$PY3\" 한투리서치받기.py --새것 --쪽수 5")
        return 1

    글 = json.loads(쌓인곳.read_text(encoding="utf-8")).get("글") or {}
    이미 = 받은것()
    할것 = [r for k, r in 글.items() if r.get("원문파일") and k not in 이미]
    할것.sort(key=lambda r: (r.get("날짜", ""), r.get("시각", "")), reverse=True)
    할것 = 할것[:개수]

    if not 할것:
        print("  받을 것이 없습니다. (목록을 먼저 새로 받아 보십시오)")
        return 0

    print(f"  {len(할것)}건을 받습니다.")
    센것, 막힌것 = 0, 0
    for r in 할것:
        키 = r.get("원문파일")
        주소, 까닭 = 원문주소(s, r)
        if not 주소:
            print(f"    ✗ {r['제목'][:40]} — {까닭}")
            막힌것 += 1
            if "로그인" in 까닭:
                print("      로그인이 풀렸습니다. --로그인 을 다시 하십시오.")
                break
            continue
        try:
            답 = s.get(주소, timeout=60)
            답.raise_for_status()
        except Exception as e:                       # noqa: BLE001
            print(f"    ✗ {r['제목'][:40]} — 내려받기 실패: {str(e)[:50]}")
            막힌것 += 1
            continue

        몸 = 답.content
        형 = (답.headers.get("content-type") or "").lower()
        if not (몸[:5] == b"%PDF-" or "pdf" in 형):
            # 뷰어 화면이 왔으면 그 안에서 진짜 파일 주소를 한 번 더 찾는다
            m = re.search(r'(https?://[^\s"\']+\.pdf|/[^\s"\']+\.pdf)', 답.text or "")
            if not m:
                print(f"    ✗ {r['제목'][:40]} — PDF 가 아니라 화면이 왔습니다({형[:30]})")
                막힌것 += 1
                continue
            다시 = m.group(1)
            답 = s.get(다시 if 다시.startswith("http") else 사이트 + 다시, timeout=60)
            몸 = 답.content
            if 몸[:5] != b"%PDF-":
                print(f"    ✗ {r['제목'][:40]} — 끝내 PDF 가 아닙니다")
                막힌것 += 1
                continue

        폴더 = 갈곳(r.get("갈래", ""))
        폴더.mkdir(parents=True, exist_ok=True)
        경로 = 폴더 / 파일이름(r)
        경로.write_bytes(몸)
        이미[키] = {"제목": r.get("제목"), "날짜": r.get("날짜"),
                   "경로": str(경로.relative_to(뿌리)), "받은때": datetime.now().isoformat(timespec="seconds")}
        센것 += 1
        print(f"    ✓ {경로.relative_to(뿌리)}  ({len(몸) // 1024:,}KB)")
        time.sleep(0.6)                              # 사이트를 몰아치지 않는다

    받은기록.write_text(json.dumps(이미, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"\n  받음 {센것}건 · 막힘 {막힌것}건 · 누적 {len(이미)}건")
    if 센것:
        print("  이어서 종목 폴더로 넣으려면:  \"$PY3\" 리포트넣기.py")
    return 0 if 센것 or not 막힌것 else 1


def main() -> int:
    인자 = sys.argv[1:]
    개수 = 30
    if "--개수" in 인자:
        개수 = int(인자[인자.index("--개수") + 1])

    if "--점검" in 인자:
        return 0 if 로그인됐나() else 1
    if "--로그인" in 인자 and "--받기" not in 인자:
        return 0 if 로그인하기() else 1
    if "--받기" in 인자:
        return 받기(개수)

    # 기본 — 로그인 확인하고, 안 돼 있으면 창을 띄우고, 되면 바로 받는다
    if not 로그인됐나():
        if not 로그인하기():
            return 1
    return 받기(개수)


if __name__ == "__main__":
    raise SystemExit(main())
