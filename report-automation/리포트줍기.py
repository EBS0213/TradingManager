#!/usr/bin/env python3
"""내려받기 폴더에 떨어진 증권사 리포트 PDF 를 주워 입력 폴더에 넣는다. (2026-09-14 신설)

    "$PY3" 리포트줍기.py                  `받은리포트/` 를 훑어 리포트만 옮긴다
    "$PY3" 리포트줍기.py --확인            옮기지 않고 무엇을 옮길지만 보여준다
    "$PY3" 리포트줍기.py --다운로드         ~/Downloads 도 함께 (손으로 돌릴 때만)
    "$PY3" 리포트줍기.py --폴더 ~/Desktop --날수 30

★ 왜 `받은리포트/` 인가 — 2026-09-14 확인
    `~/Downloads` 를 지켜보게 했더니 launchd 로 도는 프로그램이 **멈춰 버렸습니다.**
    macOS 개인정보 보호(TCC)가 자동 실행 프로그램의 내려받기 폴더 접근을 막는데,
    물어볼 화면을 띄울 수 없어 `os.scandir` 에서 그대로 걸립니다.
    그래서 예약은 막히지 않는 `받은리포트/` 를 봅니다. 브라우저 내려받기 위치를
    그 폴더로 바꿔 두면 손이 아예 안 갑니다. 손으로 돌릴 때는 `--다운로드` 로
    내려받기 폴더도 함께 볼 수 있습니다(터미널은 권한이 있습니다).

왜 필요한가
    한국투자증권 원문 PDF 는 자동으로 못 받습니다 — 로그인 화면이 보안프로그램(IPinside)을
    요구하고, 로그인 자체가 보안키보드를 씁니다(2026-09-14 확인). 그래서 **사람이 받는 것까지만**
    하고, 그다음 손이 가는 일(폴더 옮기기·이름 고치기·종목 찾아 넣기)을 전부 없앱니다.
    받기만 하면 나머지는 기계가 합니다.

무엇을 리포트로 보나 — 셋 중 하나면 옮깁니다. 아니면 **건드리지 않습니다.**
    ① 쌓아 둔 한국투자증권 리서치 목록(`캐시/한투리서치.json`)의 제목과 맞는 것
    ② PDF 에서 증권사 이름이 잡히는 것 (`src/pdf_extract.py`)
    ③ 본문에 「투자의견」·「목표주가」·「Analyst」 같은 말이 있는 것

    남의 파일을 함부로 옮기지 않습니다. 못 알아본 것은 그 자리에 그대로 둡니다.

어디로 가나
    산업 리포트 → `입력_산업리포트PDF/`
    기업 리포트 → `입력_리포트PDF/` 에 넣은 뒤 `리포트넣기.py` 가 종목 폴더까지
    그 밖(전략·시황·해외) → `입력_전략리포트PDF/`
"""
from __future__ import annotations

import json
import os
import pathlib
import re
import subprocess
import sys
import time
import unicodedata as u
from datetime import datetime

뿌리 = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(뿌리))
쌓인곳 = 뿌리 / "캐시" / "한투리서치.json"
기록 = 뿌리 / "캐시" / "줍은것.json"
잠금 = 뿌리 / "줍기.lock"

# 리포트라고 볼 낱말. 개인 문서에는 거의 안 나오는 것만 골랐습니다.
#  2026-09-14 — 채권 리포트(Bond Market Daily)가 「투자의견·목표주가」를 한 번도 안 써서
#  놓쳤습니다. 와이즈리포트로 받은 PDF 에는 FnGuide 물찍이가 박혀 있어 그것을 넣었습니다.
리포트말 = ("투자의견", "목표주가", "애널리스트", "Analyst", "Target Price",
          "Overweight", "리서치센터", "Equity Research", "FnGuide",
          "무단복제를 금합니다", "조사분석자료", "Compliance Notice",
          "투자등급", "Market Daily")


def nfc(x: str) -> str:
    return u.normalize("NFC", x or "")


def 읽은기록() -> dict:
    if 기록.exists():
        try:
            return json.loads(기록.read_text(encoding="utf-8"))
        except Exception:                            # noqa: BLE001
            pass
    return {}


def 열쇠(p: pathlib.Path) -> str:
    st = p.stat()
    return f"{nfc(p.name)}|{st.st_size}"


def 한투목록() -> list[dict]:
    if not 쌓인곳.exists():
        return []
    return list((json.loads(쌓인곳.read_text(encoding="utf-8")).get("글") or {}).values())


def 제목맞추기(이름: str, 본문: str, 목록: list[dict]) -> dict | None:
    """파일 이름이나 본문 첫머리에 한투 리서치 제목이 들어 있으면 그 글을 돌려준다."""
    바탕 = nfc(이름 + " " + 본문[:3000])
    for r in 목록:
        제목 = nfc(r.get("제목", ""))
        핵심 = 제목.split(":")[-1].strip() if ":" in 제목 else 제목
        핵심 = re.sub(r"\s+", " ", 핵심)
        if len(핵심) >= 8 and 핵심[:20] in 바탕:
            return r
        파일 = r.get("원문파일", "")
        if 파일 and 파일.split("_")[0] in 이름:       # 20260911165601547_ko.pdf 같은 원래 이름
            return r
    return None


def 갈래정하기(글: dict | None, 본문: str, 이름: str) -> tuple[str, pathlib.Path]:
    """산업·기업·전략 중 하나. **파일 이름이 이미 말해 주면 그 말을 믿는다.**

    와이즈리포트가 붙여 주는 이름(P_전략 · I_산업 · 종목명［코드］기업)이 가장 확실하다.
    그다음이 한투 목록의 갈래, 마지막이 본문 낱말이다."""
    이 = nfc(이름)
    if 이.startswith("I_"):
        return "산업", 뿌리 / "입력_산업리포트PDF"
    if 이.startswith("P_"):
        return "전략", 뿌리 / "입력_전략리포트PDF"
    if 이.startswith("C_") or re.search(r"[\[［]\d{6}[\]］]", 이):
        return "기업", 뿌리 / "입력_리포트PDF"

    갈래 = (글 or {}).get("갈래", "")
    바탕 = nfc(이름 + " " + 본문[:4000])
    if "산업" in 갈래 or re.search(r"산업분석|Sector Report|Industry (Update|Report)|섹터|업종", 바탕):
        return "산업", 뿌리 / "입력_산업리포트PDF"
    if "기업" in 갈래 or re.search(r"\(\d{6}\)|\([A-Z]{1,5}\s+(USA|HKG|JPN)\)|기업분석|기업Note", 바탕):
        return "기업", 뿌리 / "입력_리포트PDF"
    return "전략", 뿌리 / "입력_전략리포트PDF"


def 티커찾기(글: dict | None, 본문: str, 이름: str) -> str:
    if 글 and 글.get("티커"):
        return 글["티커"]
    바탕 = nfc(이름 + " " + 본문[:4000])
    m = re.search(r"\(([A-Z0-9]{1,6})\s+(?:USA|HKG|JPN|KOR)\)", 바탕)
    if m:
        return m.group(1)
    m = re.search(r"[\(\[](\d{6})[\)\]]", 바탕)
    return m.group(1) if m else ""


def 새이름(원래: str, 글: dict | None, 티커: str, 날짜: str) -> str:
    """한투 목록과 맞은 것만 제목으로 새 이름을 짓는다.

    다른 데서 받은 리포트는 **이름을 그대로 둔다** — 와이즈리포트가 붙인 이름에
    이미 갈래·날짜·증권사·종목코드가 들어 있고 `리포트넣기.py` 가 그걸로 종목을 찾는다.
    괜히 바꾸면 찾던 것을 못 찾는다."""
    if not 글:
        return nfc(원래)
    제목 = re.sub(r"[/:\\\n\r\t]", " ", nfc(글.get("제목") or pathlib.Path(원래).stem))[:70].strip()
    티 = f"({티커})" if 티커 and f"({티커})" not in 제목 else ""
    날 = (날짜 or "").replace("-", "").replace(".", "")[:8]
    return re.sub(r"\s{2,}", " ", f"한투_{제목}{티}_{날}.pdf")


def 훑기(폴더: pathlib.Path, 날수: int, 확인만: bool) -> int:
    from src.pdf_extract import parse_pdf

    목록 = 한투목록()
    이미 = 읽은기록()
    자른때 = time.time() - 날수 * 86400
    옮긴것: list[pathlib.Path] = []
    넘긴것 = 0

    후보 = sorted(폴더.glob("*.pdf"), key=lambda p: p.stat().st_mtime, reverse=True)
    for p in 후보:
        try:
            st = p.stat()
        except OSError:
            continue
        if st.st_mtime < 자른때 or st.st_size < 20_000:
            continue
        if time.time() - st.st_mtime < 10:           # 아직 받는 중일 수 있다
            continue
        k = 열쇠(p)
        if k in 이미:
            continue

        try:
            rep = parse_pdf(p, max_chars=8000)
        except Exception as e:                       # noqa: BLE001
            print(f"  · {p.name[:50]} — 읽지 못했습니다({str(e)[:40]}). 그대로 둡니다.")
            continue
        본문 = rep.text or ""
        글 = 제목맞추기(p.name, 본문, 목록)
        리포트인가 = bool(글) or bool(rep.broker) or any(w in 본문 for w in 리포트말)
        if not 리포트인가:
            넘긴것 += 1
            continue

        갈래, 갈곳 = 갈래정하기(글, 본문, p.name)
        티커 = 티커찾기(글, 본문, p.name)
        날짜 = (글 or {}).get("날짜") or rep.published or datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d")
        이름 = 새이름(p.name, 글, 티커, 날짜)
        갈데 = 갈곳 / 이름

        어디서 = "한투 목록과 맞음" if 글 else (f"증권사 {rep.broker}" if rep.broker else "리포트 낱말")
        if 확인만:
            print(f"  → [{갈래}] {p.name[:45]}\n      {갈데.relative_to(뿌리)}  ({어디서})")
            continue

        갈곳.mkdir(parents=True, exist_ok=True)
        n = 1
        while 갈데.exists():
            갈데 = 갈곳 / (이름[:-4] + f"_{n}.pdf")
            n += 1
        try:
            p.replace(갈데)
        except OSError:                              # 다른 디스크면 복사한 뒤 지운다
            갈데.write_bytes(p.read_bytes())
            p.unlink()
        이미[k] = {"제목": (글 or {}).get("제목") or p.stem, "갈래": 갈래,
                  "간곳": str(갈데.relative_to(뿌리)), "찾은법": 어디서,
                  "주운때": datetime.now().isoformat(timespec="seconds")}
        옮긴것.append(갈데)
        print(f"  ✓ [{갈래}] {갈데.relative_to(뿌리)}  ({어디서})")

    if 확인만:
        return 0

    기록.parent.mkdir(parents=True, exist_ok=True)
    기록.write_text(json.dumps(이미, ensure_ascii=False, indent=2), encoding="utf-8")

    기업것 = [q for q in 옮긴것 if "입력_리포트PDF" in str(q)]
    if 기업것:
        print("\n  종목 폴더로 넣습니다.")
        subprocess.run([sys.executable, "리포트넣기.py", *[str(q) for q in 기업것]], cwd=뿌리)

    if 옮긴것:
        print(f"\n  {len(옮긴것)}건을 넣었습니다. (못 알아본 PDF {넘긴것}건은 그대로 두었습니다)")
        알림 = 뿌리 / "알림.sh"
        if 알림.exists():
            subprocess.run([str(알림), f"리포트 {len(옮긴것)}건을 넣었습니다",
                            ", ".join(q.stem[:28] for q in 옮긴것[:3]), "Glass"],
                           cwd=뿌리, capture_output=True)
    else:
        print(f"  새로 주울 리포트가 없습니다. (못 알아본 PDF {넘긴것}건)")
    return 0


def main() -> int:
    인자 = sys.argv[1:]
    날수 = int(인자[인자.index("--날수") + 1]) if "--날수" in 인자 else 7
    확인만 = "--확인" in 인자

    폴더들: list[pathlib.Path] = []
    if "--폴더" in 인자:
        폴더들.append(pathlib.Path(os.path.expanduser(인자[인자.index("--폴더") + 1])))
    else:
        폴더들.append(뿌리 / "받은리포트")
        if "--다운로드" in 인자:                    # 손으로 돌릴 때만. 예약으로는 걸지 마십시오.
            폴더들.append(pathlib.Path(os.path.expanduser("~/Downloads")))

    폴더들 = [f for f in 폴더들 if f.is_dir()]
    if not 폴더들:
        print(f"볼 폴더가 없습니다. {뿌리 / '받은리포트'} 를 만들어 두십시오.")
        return 2

    # 겹쳐 돌지 않게 (launchd 가 파일이 바뀔 때마다 부릅니다)
    if not 확인만:
        if 잠금.exists():
            try:
                if time.time() - 잠금.stat().st_mtime < 600:
                    return 0
            except OSError:
                pass
        잠금.write_text(str(os.getpid()))
    try:
        끝값 = 0
        for f in 폴더들:
            print(f"■ {f} 를 훑습니다 (최근 {날수}일)")
            끝값 = 훑기(f, 날수, 확인만) or 끝값
        return 끝값
    finally:
        if not 확인만:
            잠금.unlink(missing_ok=True)


if __name__ == "__main__":
    raise SystemExit(main())
