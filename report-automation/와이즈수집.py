#!/usr/bin/env python3
"""와이즈리포트에서 오늘 나온 증권사 리포트를 받아 입력 폴더에 넣는다.

  python3 와이즈수집.py                오늘(자료가 없으면 직전 영업일) 것
  python3 와이즈수집.py 2026-09-04     날짜를 직접
  python3 와이즈수집.py --확인          받지 않고 무엇이 있는지만 보여준다
  python3 와이즈수집.py --계정          아이디·비밀번호를 넣는다 (맥 키체인)
  python3 와이즈수집.py --점검          로그인만 해 보고 끝낸다
  python3 와이즈수집.py --종목 000660 005930   그 종목들의 지난 석 달 리포트만
  python3 와이즈수집.py --종목 관심종목        관심종목 전체의 지난 석 달 리포트

받은 파일이 가는 곳
  P_…  투자전략·경제·채권·해외·시황  →  입력_전략리포트PDF/
  I_…  산업                          →  입력_산업리포트PDF/
  C_…  기업 (관심종목에 있는 것만)    →  리포트넣기.py 가 종목 폴더로 넣습니다

아이디·비밀번호는 맥 키체인에만 둡니다. 이 파일에도, 로그에도 적지 않습니다.
로그인한 흔적(쿠키)은 캐시/wise_state.json 에 두고 다음에 다시 씁니다 —
매번 새로 로그인하면 사이트가 「중복 로그인」으로 볼 수 있기 때문입니다.
"""
import argparse
import datetime as dt
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import unicodedata as u
import urllib.parse

뿌리 = pathlib.Path(__file__).resolve().parent
사이트 = "https://www.wisereport.co.kr"
자리 = 뿌리 / "캐시" / "wise_state.json"      # 로그인 흔적
로그폴더 = 뿌리 / "로그"

# 키체인에 넣을 때 쓰는 이름. 「키체인 접근」 앱에서 이 이름으로 찾을 수 있습니다.
서비스 = "tm26-wisereport"
계정칸 = "wisereport"

# 받은 파일 이름으로 갈 곳을 정합니다. 사이트가 붙여 주는 이름이 이렇습니다.
#   P_Strategy_20260903_MERITZ_1128641.pdf      투자전략·경제·채권·해외·시황
#   I_Chemicals_20260814_KB_1123911.pdf         산업
#   큐렉소［060280］_20260907_Sangsangin_…pdf     기업 (앞에 갈래 글자가 없습니다)
전략폴더 = 뿌리 / "입력_전략리포트PDF"
산업폴더 = 뿌리 / "입력_산업리포트PDF"
기업폴더 = 뿌리 / "입력_리포트PDF"
기록 = 뿌리 / "캐시" / "wise_받은것.json"       # 이미 받은 리포트 번호

# 눈으로 보기 좋게 다운로드 폴더에도 같이 둡니다 (2026-09-05).
#   ~/다운로드/오늘 보고서/<종목명>/…pdf      기업 리포트
#   ~/다운로드/오늘 보고서/산업·전략/…pdf     산업·전략·경제·채권·해외·시황
# 진짜 파일은 입력_* 폴더에 있고 이곳에는 **같은 파일을 가리키는 딴이름**을 둡니다
#  (하드링크라 자리를 두 배로 먹지 않고, 한쪽을 지워도 다른 쪽은 멀쩡합니다).
내려받기 = pathlib.Path.home() / "Downloads"
오늘폴더 = 내려받기 / "오늘 보고서"
지난폴더 = 내려받기 / "지난 보고서"
전략묶음 = "산업·전략"

# 화면 위쪽 탭. 왼쪽 숫자가 사이트가 쓰는 갈래 번호입니다 (viewReport(번호)).
갈래들 = [
    ("36", "전략", "P"), ("34", "경제", "P"), ("28", "채권", "P"),
    ("44", "글로벌", "P"), ("31", "정기", "P"), ("37", "이슈", "P"),
    ("32", "산업", "I"),
    ("33", "기업", "C"),        # 관심종목에 있는 것만 받습니다
]

한번에최대 = 60          # 한 번 돌 때 받을 파일 수 한도 (사고 방지)
쪽한도 = 12              # 갈래 하나에서 넘길 목록 쪽 수 한도


def nfc(x): return u.normalize("NFC", x or "")


# ── 계정 (맥 키체인) ────────────────────────────────────────────
def 계정읽기():
    """키체인에서 아이디·비밀번호를 꺼낸다. 없으면 (None, None)."""
    try:
        r = subprocess.run(["security", "find-generic-password",
                            "-s", 서비스, "-a", 계정칸, "-w"],
                           capture_output=True, text=True, timeout=20)
    except Exception:
        return None, None
    if r.returncode != 0:
        return None, None
    try:
        d = json.loads(r.stdout.strip())
        return d.get("id") or None, d.get("pw") or None
    except Exception:
        return None, None


def _as글(s: str) -> str:
    """AppleScript 안에 넣을 따옴표 글. ensure_ascii=False 가 꼭 필요합니다 —
       한글이 \\uc2dc 같은 모양으로 나가면 AppleScript 가 문장을 못 읽습니다."""
    return json.dumps(s, ensure_ascii=False)


def 물어보기(제목: str, 안내: str, 감춤: bool = False) -> str:
    """맥 대화상자로 한 줄 받는다. 취소하면 빈 글자."""
    숨김 = " with hidden answer" if 감춤 else ""
    # 상자를 **System Events 가** 띄우게 합니다. osascript 자신이 띄우면 화면에
    #  나설 자격이 없어 뒤에 숨거나 그냥 닫힙니다 (2026-09-05 에 여기서 한 번 헤맸습니다).
    본 = ('tell application "System Events"\n'
          '  activate\n'
          f'  display dialog {_as글(안내)} with title {_as글(제목)} '
          f'default answer ""{숨김} buttons {{"취소","확인"}} default button "확인"\n'
          'end tell')
    r = subprocess.run(["osascript", "-e", 본], capture_output=True, text=True)
    if r.returncode != 0:
        까닭 = (r.stderr or "").strip()
        # 사람이 취소를 누른 것(-128)은 오류가 아닙니다. 그 밖의 것은 알려 줍니다.
        if 까닭 and "-128" not in 까닭:
            print("대화상자를 띄우지 못했습니다:", 까닭[:200])
        return ""
    m = re.search(r"text returned:(.*)$", r.stdout.strip())
    return (m.group(1).strip() if m else "")


def 계정넣기() -> int:
    아이디 = 물어보기("와이즈리포트 계정", "와이즈리포트 아이디를 넣어 주세요.")
    if not 아이디:
        print("취소했습니다."); return 1
    비번 = 물어보기("와이즈리포트 계정", f"{아이디} 의 비밀번호를 넣어 주세요.", 감춤=True)
    if not 비번:
        print("취소했습니다."); return 1

    값 = json.dumps({"id": 아이디, "pw": 비번}, ensure_ascii=False)
    # -U 는 같은 이름이 이미 있으면 덮어씁니다 (없으면 새로 만듭니다)
    r = subprocess.run(["security", "add-generic-password", "-U",
                        "-s", 서비스, "-a", 계정칸,
                        "-l", "TM26 와이즈리포트", "-w", 값],
                       capture_output=True, text=True)
    if r.returncode != 0:
        print("키체인에 넣지 못했습니다:", r.stderr.strip()[:200]); return 1

    # 계정이 바뀌었으면 옛 로그인 흔적은 버립니다
    자리.unlink(missing_ok=True)
    print(f"넣었습니다 — 아이디 {아이디} (비밀번호는 맥 키체인에만 있습니다)")
    print("이제 「리포트 받아오기」 를 눌러 보세요.")
    return 0


# ── 로그인 ──────────────────────────────────────────────────────
def _새창(pw, 보이게: bool):
    브라우저 = pw.chromium.launch(headless=not 보이게)
    맥락 = (브라우저.new_context(storage_state=str(자리))
            if 자리.exists() else 브라우저.new_context())
    맥락.set_default_timeout(30000)
    return 브라우저, 맥락


def 로그인상태(쪽) -> bool:
    """리포트 목록이 열리면 로그인된 것입니다 (안 되면 첫 화면으로 튕깁니다)."""
    쪽.goto(사이트 + "/wiseReport/reports/ReportList.aspx", wait_until="domcontentloaded")
    쪽.wait_for_timeout(1500)
    return "/ReportList.aspx" in 쪽.url


def 사이트알림(쪽, 몇번=3) -> str:
    """사이트가 띄우는 상자(jAlert/jConfirm)를 확인으로 넘긴다. 뭐라고 했는지 돌려준다.

    「중복 로그인」 상자가 여기로 옵니다 — 확인을 누르면 다른 데 켜 둔 창이 끊기고
    이쪽이 들어갑니다. 브라우저에 와이즈리포트를 열어 두셨다면 그 창이 끊깁니다."""
    말들 = []
    for _ in range(몇번):
        상자 = 쪽.locator("#popup_container")
        try:
            if not (상자.count() and 상자.first.is_visible()):
                break
            글 = 쪽.locator("#popup_message")
            if 글.count():
                말 = 글.first.inner_text().strip().replace("\n", " ")
                if 말:
                    말들.append(말)
            누를것 = 쪽.locator("#popup_ok")
            if not (누를것.count() and 누를것.first.is_visible()):
                누를것 = 쪽.locator("#popup_container button").first
            누를것.click()
            쪽.wait_for_timeout(2000)
        except Exception:
            break
    return " / ".join(말들)


def 로그인하기(쪽, 아이디: str, 비번: str) -> str:
    """로그인한다. 잘 되면 빈 글자, 안 되면 까닭을 돌려준다."""
    쪽.goto(사이트 + "/", wait_until="domcontentloaded")
    쪽.wait_for_timeout(1200)

    아이디칸 = 쪽.locator("#UsrID")
    if not 아이디칸.count():
        return "로그인칸을 찾지 못했습니다 (사이트 화면이 바뀌었을 수 있습니다)"
    아이디칸.first.click()
    아이디칸.first.fill(아이디)

    # 비밀번호칸은 처음에 숨어 있습니다. 옆에 「비밀번호」라고 적힌 가짜 칸
    #  (#UsrPassWD_Text)을 누르면 그것이 사라지고 진짜 칸(#UsrPassWD)이 나옵니다.
    겉칸 = 쪽.locator("#UsrPassWD_Text")
    try:
        if 겉칸.count() and 겉칸.first.is_visible():
            겉칸.first.click()
            쪽.wait_for_timeout(400)
    except Exception:
        pass
    비번칸 = 쪽.locator("#UsrPassWD")
    if not 비번칸.count():
        return "비밀번호칸을 찾지 못했습니다"
    try:
        비번칸.first.fill(비번)
    except Exception:
        # 아직 숨어 있으면 화면 규칙을 무시하고 값만 넣습니다
        쪽.eval_on_selector("#UsrPassWD", "(e, v) => { e.style.display='inline'; e.value = v; }", 비번)

    # 브라우저 기본 알림창이 뜨면 그냥 넘깁니다
    쪽.on("dialog", lambda d: d.accept())

    단추 = 쪽.locator("#btnLogin")
    if 단추.count():
        단추.first.click()
    else:
        비번칸.first.press("Enter")
    쪽.wait_for_timeout(3500)

    말 = 사이트알림(쪽)
    if 말:
        print("  사이트 알림:", 말[:160])

    if 로그인상태(쪽):
        return ""
    return ("로그인이 되지 않았습니다"
            + (f" — 사이트가 이렇게 말합니다: {말[:160]}" if 말 else
               " (아이디·비밀번호를 다시 보시거나, 사이트가 비밀번호 변경을 요구하고 있을 수 있습니다)"))


def 세션열기(pw, 보이게=False):
    """로그인된 창을 돌려준다. (브라우저, 맥락, 쪽) 또는 SystemExit."""
    브라우저, 맥락 = _새창(pw, 보이게)
    쪽 = 맥락.new_page()

    if 자리.exists() and 로그인상태(쪽):
        return 브라우저, 맥락, 쪽

    아이디, 비번 = 계정읽기()
    if not 아이디:
        브라우저.close()
        raise SystemExit("와이즈리포트 계정이 없습니다. TM26 메뉴의 "
                         "「와이즈리포트 계정 넣기」를 먼저 하시거나, "
                         "python3 와이즈수집.py --계정 을 돌리십시오.")
    print(f"로그인합니다 — {아이디}")
    까닭 = 로그인하기(쪽, 아이디, 비번)
    if 까닭:
        브라우저.close()
        raise SystemExit("로그인 실패: " + 까닭)

    자리.parent.mkdir(parents=True, exist_ok=True)
    맥락.storage_state(path=str(자리))
    os.chmod(자리, 0o600)
    print("로그인했습니다.")
    return 브라우저, 맥락, 쪽


# ── 다운로드 폴더에 오늘 것 모아 두기 ──────────────────────────
def 오늘폴더준비() -> pathlib.Path:
    """「오늘 보고서」가 어제 것이면 「지난 보고서/<날짜>」로 옮기고 새로 시작한다.
       아무것도 지우지 않습니다 — 옮기기만 합니다."""
    오늘 = dt.date.today().isoformat()
    표 = 오늘폴더 / ".날짜"
    try:
        if 오늘폴더.exists():
            적힌날 = 표.read_text(encoding="utf-8").strip() if 표.exists() else ""
            if 적힌날 != 오늘:
                지난폴더.mkdir(parents=True, exist_ok=True)
                갈곳 = 지난폴더 / (적힌날 or "날짜모름")
                n = 1
                while 갈곳.exists():
                    n += 1
                    갈곳 = 지난폴더 / f"{적힌날 or '날짜모름'}_{n}"
                오늘폴더.rename(갈곳)
                print(f"어제까지의 「오늘 보고서」는 {갈곳} 로 옮겼습니다.")
        오늘폴더.mkdir(parents=True, exist_ok=True)
        표.write_text(오늘, encoding="utf-8")
    except Exception as e:
        print("  다운로드 폴더를 준비하지 못했습니다:", str(e)[:100])
    return 오늘폴더


def 다운로드에도(파일: pathlib.Path, 종목명: str = ""):
    """받은 파일을 다운로드 폴더에도 걸어 둔다. 실패해도 하던 일은 계속합니다."""
    이름 = nfc(파일.name)
    if 종목명:
        칸 = 종목명
    elif 이름.startswith(("P_", "I_")):
        칸 = 전략묶음
    elif "［" in 이름:
        칸 = 이름.split("［")[0].strip()      # 「큐렉소［060280］_…」 → 큐렉소
    else:
        # 이름에 종목이 안 들어 있는 리포트도 드물게 있습니다. 한 칸에 모아 둡니다.
        칸 = "기타"
    칸 = re.sub(r"[/:]", "_", 칸).strip() or "기타"
    try:
        갈곳 = 오늘폴더 / 칸
        갈곳.mkdir(parents=True, exist_ok=True)
        둘것 = 갈곳 / 이름
        if 둘것.exists():
            return
        try:
            os.link(파일, 둘것)          # 같은 파일을 두 자리에서 봅니다 (자리 안 먹습니다)
        except Exception:
            shutil.copy2(파일, 둘것)     # 다른 디스크면 그냥 복사합니다
    except Exception as e:
        print("   다운로드 폴더에 두지 못했습니다:", str(e)[:80])


# ── 이미 받은 것 ────────────────────────────────────────────────
def 열람전용읽기() -> set:
    """증권사가 내려받기를 막아 둔 리포트 번호. 다음부터는 시도하지 않습니다."""
    try:
        return set(json.loads(기록.read_text(encoding="utf-8")).get("열람전용", []))
    except Exception:
        return set()


def 받은것읽기() -> set:
    """다시 받지 않으려고 기억해 둔 리포트 번호. 파일 이름에서도 한 번 더 훑습니다."""
    본 = set()
    try:
        본 |= set(json.loads(기록.read_text(encoding="utf-8")).get("ids", []))
    except Exception:
        pass
    # 이 도구가 생기기 전에 손으로 받아 둔 것도 다시 받지 않게 합니다.
    #  이름 끝이 _<번호>.pdf 입니다.
    for 폴더 in (전략폴더, 산업폴더, 기업폴더):
        if not 폴더.exists():
            continue
        for f in 폴더.rglob("*.pdf"):
            m = re.search(r"_(\d{6,9})\.pdf$", nfc(f.name))
            if m:
                본.add(m.group(1))
    return 본


def 받은것적기(본: set, 열람전용: set = None):
    기록.parent.mkdir(parents=True, exist_ok=True)
    기록.write_text(json.dumps({"ids": sorted(본),
                              "열람전용": sorted(열람전용 or 열람전용읽기())},
                             ensure_ascii=False), encoding="utf-8")


def 관심종목():
    """{코드: 이름}. 못 읽으면 빈 것."""
    try:
        sys.path.insert(0, str(뿌리))
        import 워치리스트도구 as W
        return W.읽기() or {}
    except Exception as e:
        print("  관심종목을 읽지 못했습니다:", str(e)[:80])
        return {}


# ── 목록 읽기 ───────────────────────────────────────────────────
def 목록(쪽, 갈래번호: str, 시작일: str, 끝일: str, 쪽수한도: int = None):
    """한 갈래의 리포트 줄을 모두 읽어 온다. [{id, brk, path, 날짜, 제목, 제공처}]"""
    본, 본번호 = [], set()
    for 쪽번호 in range(1, (쪽수한도 or 쪽한도) + 1):
        쪽.evaluate("""([typ, s, e, per, page]) => {
            document.getElementById('txtStart').value = s;
            document.getElementById('txtEnd').value = e;
            fn_NavReport(typ, s, e, '1', 'cocode', '', per, String(page), 'anl_dt', 'd');
        }""", [갈래번호, 시작일, 끝일, "100", 쪽번호])
        쪽.wait_for_timeout(1800)
        줄들 = 쪽.evaluate("""() => [...document.querySelectorAll('#reportList table tr')]
            .map(tr => {
                const a = tr.querySelector("a[href*='openContent(']");
                if (!a) return null;
                const m = (a.getAttribute('href')||'')
                    .match(/openContent\\((\\d+),\\s*(\\d+),\\s*'([^']*)'/);
                if (!m) return null;
                const td = [...tr.querySelectorAll('td')].map(x => (x.innerText||'').trim());
                return {id: m[1], brk: m[2], path: m[3],
                        날짜: td[0]||'', 제목: td[1]||'', 제공처: td[3]||''};
            }).filter(Boolean)""")
        새것 = [r for r in 줄들 if r["id"] not in 본번호]
        for r in 새것:
            본번호.add(r["id"])
        본 += 새것
        # 새 줄이 없거나 한 쪽을 다 못 채웠으면 마지막 쪽입니다
        if not 새것 or len(줄들) < 100:
            break
    return 본


def 관심종목인가(줄, 종목: dict) -> bool:
    """기업 리포트가 내 관심종목의 것인가. 파일 이름 속 여섯 자리 코드를 먼저 봅니다."""
    m = re.search(r"_(\d{6})\.pdf$", 줄.get("path", ""))
    if m and m.group(1) in 종목:
        return True
    제목 = nfc(줄.get("제목", ""))
    m2 = re.match(r"\s*\[([^\]]+)\]", 제목)
    if m2:
        이름 = m2.group(1).strip()
        return any(nfc(n) == 이름 for n in 종목.values())
    return False


# ── 받기 ────────────────────────────────────────────────────────
def 하나받기(쪽, 줄) -> tuple:
    """리포트 하나를 받아 (저장한 파일, 까닭) 을 돌려준다.

    ① 보는 쪽(LoadReport.aspx)을 엽니다 — 여기에 그때그때 만들어지는 내려받기 주소가 있습니다.
    ② 그 주소를 **Referer 를 붙여** 곧바로 받습니다. Referer 가 없으면 사이트가 403 을 줍니다.
    ③ PDF 가 아니라 짧은 HTML 이 오면 증권사가 내려받기를 막아 둔 리포트입니다
       (사이트에서 보기만 됩니다). 그런 것은 바로 건너뜁니다.
    """
    보는곳 = (f"{사이트}/comm/LoadReport.aspx?rpt_id={줄['id']}"
            f"&brk_cd={줄['brk']}&fpath={urllib.parse.quote(줄['path'])}&view_lang=")
    마지막까닭 = "내려받지 못했습니다"

    for 시도 in (1, 2):
        try:
            쪽.goto(보는곳, wait_until="domcontentloaded")
            쪽.wait_for_timeout(1200 if 시도 == 1 else 3000)
            글 = 쪽.content()
        except Exception:
            마지막까닭 = "리포트 쪽을 열지 못했습니다"
            continue

        n = re.search(r"downloadFileName:\s*'([^']+)'", 글)
        이름 = nfc(n.group(1)) if n else f"{줄['id']}.pdf"
        m = re.search(r"(https://[^'\"\s]*LoadPdfForDownload\.aspx\?fileInfo=[^'\"\s]+)", 글)
        if not m:
            return None, "열람전용"      # 내려받기 자리가 아예 없는 리포트

        갈곳 = 산업폴더 if 이름.startswith("I_") else (전략폴더 if 이름.startswith("P_") else 기업폴더)
        갈곳.mkdir(parents=True, exist_ok=True)
        저장 = 갈곳 / 이름
        if 저장.exists() and 저장.stat().st_size > 1000:
            return 저장, ""              # 이미 같은 이름으로 받아 둔 것

        try:
            답 = 쪽.request.get(m.group(1), headers={"referer": 보는곳}, timeout=120000)
            몸 = 답.body()
        except Exception as e:
            마지막까닭 = f"내려받지 못했습니다 ({type(e).__name__})"
            continue

        if 몸[:4] != b"%PDF":
            글답 = 몸.decode("utf-8", "ignore")
            # 사이트는 하루 내려받기 한도가 있습니다. 걸리면 이렇게 답합니다.
            #  (2026-09-05: 71건째에서 걸렸습니다. 리포트가 막힌 것과 헷갈리면 안 됩니다 —
            #   한도는 내일이면 풀리므로 '못 받는 리포트' 로 기억해 두면 영영 안 받게 됩니다.)
            if "다운로드 제한" in 글답 or "제한되었습니다" in 글답:
                return None, "한도"
            if len(몸) < 4000:
                return None, "열람전용"
            마지막까닭 = "PDF 가 아닌 것이 왔습니다"
            continue

        저장.write_bytes(몸)
        return 저장, ""

    return None, 마지막까닭


def 종목폴더로(파일들):
    """기업 리포트를 리포트넣기.py 에게 넘겨 종목 폴더로 보낸다."""
    if not 파일들:
        return
    붙임 = [str(f) for f in 파일들]
    try:
        r = subprocess.run([sys.executable, str(뿌리 / "리포트넣기.py")] + 붙임,
                           capture_output=True, text=True, cwd=str(뿌리), timeout=600)
        for 줄 in (r.stdout or "").splitlines():
            if 줄.startswith("OK"):
                print("   넣음:", 줄.replace("OK\t", "")[:90])
            elif 줄.startswith("UNMATCHED"):
                print("   종목을 못 찾아 그대로 둡니다:", 줄.split("\t")[1] if "\t" in 줄 else 줄)
    except Exception as e:
        print("   리포트넣기.py 를 부르지 못했습니다:", str(e)[:100])


def 받아오기(쪽, 시작일: str, 끝일: str, 확인만: bool, 고른종목: set = None) -> int:
    """고른종목을 주면 그 종목들의 기업 리포트만 받습니다 (새로 넣은 종목의 지난 리포트)."""
    이미 = 받은것읽기()
    막힌것 = 열람전용읽기()
    종목 = 관심종목()
    if 고른종목:
        종목 = {c: 종목.get(c, c) for c in 고른종목}
        볼갈래 = [g for g in 갈래들 if g[2] == "C"]
        훑을쪽 = 40          # 기업 리포트는 하루 100건 넘게 나옵니다. 넉넉히 넘깁니다.
    else:
        볼갈래, 훑을쪽 = 갈래들, 쪽한도
    if not 확인만:
        오늘폴더준비()
    print(f"기간 {시작일} ~ {끝일} · 이미 가진 리포트 {len(이미)}건 · "
          + (f"고른 종목 {len(종목)}개" if 고른종목 else f"관심종목 {len(종목)}개"))

    쪽.goto(사이트 + "/wiseReport/reports/ReportList.aspx", wait_until="networkidle")
    쪽.wait_for_timeout(2500)

    받을것 = []
    for 번호, 이름, 갈래 in 볼갈래:
        try:
            줄들 = 목록(쪽, 번호, 시작일, 끝일, 훑을쪽)
        except Exception as e:
            print(f"  [{이름}] 목록을 읽지 못했습니다: {str(e)[:80]}")
            continue
        새것 = [r for r in 줄들 if r["id"] not in 이미 and r["id"] not in 막힌것]
        if 갈래 == "C":
            새것 = [r for r in 새것 if 관심종목인가(r, 종목)]
        print(f"  [{이름}] 목록 {len(줄들)}건 · 받을 것 {len(새것)}건")
        for r in 새것:
            r["갈래"] = 이름
        받을것 += 새것

    # 한 리포트가 두 탭에 함께 오르는 일이 잦습니다 (전략인데 정기이기도 한 식).
    #  그대로 두면 같은 것을 두 번 받습니다.
    본번호, 추린것 = set(), []
    for r in 받을것:
        if r["id"] in 본번호:
            continue
        본번호.add(r["id"])
        추린것.append(r)
    if len(추린것) != len(받을것):
        print(f"  (여러 탭에 겹쳐 오른 {len(받을것) - len(추린것)}건은 한 번만 받습니다)")
    받을것 = 추린것

    if not 받을것:
        print("새로 받을 리포트가 없습니다.")
        return 0

    if 확인만:
        for r in 받을것[:60]:
            print(f"  {r['날짜']}  [{r['갈래']}] {r['제목'][:44]}  ({r['제공처']})")
        if len(받을것) > 60:
            print(f"  … 그 밖에 {len(받을것) - 60}건")
        print(f"모두 {len(받을것)}건입니다. (--확인 이라 받지 않았습니다)")
        return 0

    if len(받을것) > 한번에최대:
        print(f"받을 것이 {len(받을것)}건이라 한 번에 {한번에최대}건까지만 받습니다. "
              f"나머지는 다음에 돌리면 이어서 받습니다.")
        받을것 = 받을것[:한번에최대]

    성공, 실패, 기업파일, 열람만, 한도걸림 = 0, 0, [], [], False
    for i, r in enumerate(받을것, 1):
        파일, 까닭 = 하나받기(쪽, r)
        if 까닭 == "한도":
            한도걸림 = True
            print(f"  {i:>3}/{len(받을것)}  ■ 사이트가 「다운로드 제한되었습니다」 라고 합니다. "
                  f"여기서 멈춥니다 — 오늘 몫을 다 쓴 것입니다.")
            print(f"     남은 {len(받을것) - i + 1}건은 기억해 두었다가 다음에 이어서 받습니다.")
            break
        if 까닭 == "열람전용":
            막힌것.add(r["id"]); 열람만.append(r)
            print(f"  {i:>3}/{len(받을것)}  · [{r['갈래']}] {r['제목'][:40]} — 사이트에서 보기만 되는 리포트입니다")
            continue
        if 파일:
            성공 += 1
            이미.add(r["id"])
            print(f"  {i:>3}/{len(받을것)}  {nfc(파일.name)[:70]}")
            다운로드에도(파일)
            if 파일.parent == 기업폴더:
                기업파일.append(파일)
        else:
            실패 += 1
            print(f"  {i:>3}/{len(받을것)}  ✗ [{r['갈래']}] {r['제목'][:40]} — {까닭}")
        쪽.wait_for_timeout(1200)      # 몰아치지 않게 한 박자 쉽니다
        if i % 10 == 0:
            받은것적기(이미, 막힌것)   # 중간에 끊겨도 받은 것은 기억해 둡니다

    받은것적기(이미, 막힌것)

    # 보기만 되는 리포트는 주소를 적어 둡니다 — 필요하면 브라우저로 여시면 됩니다.
    if 열람만:
        쪽지 = 로그폴더 / "와이즈_열람전용.txt"
        로그폴더.mkdir(parents=True, exist_ok=True)
        with 쪽지.open("a", encoding="utf-8") as f:
            f.write(f"\n── {dt.datetime.now():%Y-%m-%d %H:%M} ──\n")
            for r in 열람만:
                f.write(f"{r['날짜']} [{r['갈래']}] {r['제목']} ({r['제공처']})\n"
                        f"  {사이트}/comm/LoadReport.aspx?rpt_id={r['id']}"
                        f"&brk_cd={r['brk']}&fpath={urllib.parse.quote(r['path'])}&view_lang=\n")
        print(f"보기만 되는 리포트 {len(열람만)}건은 '로그/와이즈_열람전용.txt' 에 주소를 적어 뒀습니다.")
    if 기업파일:
        print("기업 리포트를 종목 폴더로 넣습니다.")
        종목폴더로(기업파일)

    print(f"끝났습니다 — 받음 {성공}건, 못 받음 {실패}건"
          + (f", 보기만 되는 것 {len(열람만)}건" if 열람만 else "")
          + (" · 하루 한도에 걸려 중간에 멈췄습니다" if 한도걸림 else ""))
    return 0 if 성공 or not 실패 else 1


def main() -> int:
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("날짜", nargs="?", default="")
    ap.add_argument("--계정", action="store_true")
    ap.add_argument("--확인", action="store_true")
    ap.add_argument("--점검", action="store_true")
    ap.add_argument("--종목", nargs="+", default=None,
                    help="종목코드들, 또는 '관심종목'")
    ap.add_argument("--개월", type=int, default=3, help="--종목 일 때 거슬러 볼 달 수")
    ap.add_argument("--보이게", action="store_true", help="창을 띄워 무슨 일이 일어나는지 본다")
    ap.add_argument("-h", "--help", action="store_true")
    옵션 = ap.parse_args()

    if 옵션.help:
        print(__doc__); return 0
    if getattr(옵션, "계정"):
        return 계정넣기()

    os.chdir(뿌리)       # 워치리스트도구·리포트넣기.py 가 이 폴더를 기준으로 봅니다

    # 날짜를 주면 그날 하루만. 안 주면 어제부터 다음 주까지 —
    #  주간 리포트는 **다음 주 월요일 날짜**로 올라오기 때문입니다 (오늘 것만 보면 놓칩니다).
    고른종목 = None
    오늘 = dt.date.today()
    if 옵션.종목:
        고른종목 = set(관심종목().keys()) if 옵션.종목 == ["관심종목"] else {
            str(c).strip().upper() for c in 옵션.종목}
        if not 고른종목:
            print("종목을 찾지 못했습니다."); return 2
        시작일 = (오늘 - dt.timedelta(days=31 * max(1, 옵션.개월))).isoformat()
        끝일 = (오늘 + dt.timedelta(days=7)).isoformat()
    elif 옵션.날짜:
        시작일 = 끝일 = 옵션.날짜
    else:
        시작일 = (오늘 - dt.timedelta(days=1)).isoformat()
        끝일 = (오늘 + dt.timedelta(days=7)).isoformat()

    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("playwright 가 없습니다. 먼저:  .venv/bin/pip install playwright && "
              ".venv/bin/playwright install chromium")
        return 2

    print(f"── 와이즈리포트 받아오기  {dt.datetime.now():%Y-%m-%d %H:%M:%S} ──")
    with sync_playwright() as pw:
        브라우저, 맥락, 쪽 = 세션열기(pw, 보이게=옵션.보이게)
        try:
            if 옵션.점검:
                print("로그인 상태가 살아 있습니다:", 쪽.url)
                return 0
            return 받아오기(쪽, 시작일, 끝일, 옵션.확인, 고른종목)
        finally:
            try:
                맥락.storage_state(path=str(자리))
            except Exception:
                pass
            브라우저.close()


if __name__ == "__main__":
    sys.exit(main())
