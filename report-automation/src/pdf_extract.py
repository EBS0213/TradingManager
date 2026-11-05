"""
증권사 리포트 PDF 정리기
------------------------
'입력_리포트PDF' 폴더에 넣어둔 PDF 에서
  · 증권사 · 작성일 · 목표주가 · 투자의견 · 애널리스트
  · 본문 텍스트(보고서를 쓸 때 근거로 읽을 원문)
를 뽑아낸다.

중요: 여기서 뽑은 원문은 **분석 재료**로만 쓴다. 생성되는 보고서는 원본 분석이어야 하고,
리포트 원문을 옮겨 싣는 형태가 되면 안 된다. (인수인계 메모 4절)
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
import unicodedata
from pathlib import Path

BROKERS = [
    "삼성증권", "NH투자증권", "미래에셋증권", "한국투자증권", "KB증권", "신한투자증권",
    "키움증권", "하나증권", "대신증권", "유안타증권", "메리츠증권", "다올투자증권",
    "IBK투자증권", "교보증권", "유진투자증권", "SK증권", "BNK투자증권", "한화투자증권",
    "현대차증권", "신영증권", "하이투자증권", "iM증권", "LS증권", "DS투자증권",
    "흥국증권", "상상인증권", "부국증권", "케이프투자증권", "리딩투자증권",
    "IV리서치", "밸류파인더", "한국IR협의회", "SK증권", "대신증권",
]

OPINION_PAT = re.compile(
    r"(적극\s*매수|매수|BUY|Buy|Outperform|시장수익률\s*상회|비중확대|"
    r"중립|Hold|Neutral|시장수익률|보유|매도|SELL|Underperform)", re.I)

# 목표주가.  줄바꿈을 건너뛸 수 있게 \n 을 허용한다.
#   "목표주가 상향 75,000원" · "목표주가(12M) 400,000" · "목표주가를 기존의\n75,000원으로"
TARGET_PAT = re.compile(
    r"(?:목표\s*주가|적정\s*주가|목표\s*가격|TP\s*\(|Target\s*Price)"
    r"[^\d]{0,40}?([1-9][\d,]{2,})", re.I | re.S)

# "목표주가를 기존의 43,000원에서 75,000원으로 상향" — 이런 문장에서 앞 숫자를 잡으면
# 직전 목표주가를 새 목표주가로 착각한다. 'A원에서 B원으로' 는 B가 답이다. 이걸 먼저 본다.
TARGET_CHANGE_PAT = re.compile(
    r"(?:목표\s*주가|적정\s*주가)[^\d]{0,40}?[\d,]{4,}\s*원?\s*(?:에서|→|->|~)\s*"
    r"([1-9][\d,]{3,})\s*원", re.S)

# 'Not Rated' 는 목표주가를 내지 않은 것이다. 이 표기가 있으면 숫자를 찾지 않는다.
NOT_RATED_PAT = re.compile(r"Not\s*Rated|N\.?R\.?\s*\(|투자의견\s*없음", re.I)

DATE_PAT = re.compile(r"(20\d{2})[.\-/년]\s*(\d{1,2})[.\-/월]\s*(\d{1,2})")


@dataclass
class BrokerReport:
    file: str
    broker: str | None = None
    published: str | None = None
    target_price: float | None = None
    opinion: str | None = None
    analysts: list[str] = field(default_factory=list)
    pages: int = 0
    text: str = ""
    key_lines: list[str] = field(default_factory=list)
    error: str | None = None

    def summary(self) -> dict:
        return {
            "파일": self.file, "증권사": self.broker, "작성일": self.published,
            "목표주가": self.target_price, "투자의견": self.opinion,
            "애널리스트": ", ".join(self.analysts) or None, "페이지": self.pages,
        }


def _date_from_name(name: str) -> str | None:
    """파일명에 박힌 YYYYMMDD 를 작성일로 쓴다.

    증권사 리포트 파일명은 보통 '종목명[코드]_20260818_Samsung_1124060.pdf' 꼴이다.
    URL 인코딩(%ed%8b%b0…)이 섞여 있어도 8자리 숫자는 그대로 남는다.
    """
    from datetime import date as _date
    today = _date.today()
    best = None
    # 8자리 날짜 또는 14자리 타임스탬프(20260803131903) 둘 다 받는다
    for m in re.finditer(r"(?<!\d)(20\d{2})(\d{2})(\d{2})(?:\d{6})?(?!\d)", name):
        y, mo, d = int(m.group(1)), int(m.group(2)), int(m.group(3))
        if not (1 <= mo <= 12 and 1 <= d <= 31):
            continue
        try:
            got = _date(y, mo, d)
        except ValueError:
            continue
        if got > today:                       # 미래 날짜는 접수번호 등을 잘못 읽은 것
            continue
        if best is None or got > best:        # 파일명에 날짜가 여럿이면 가장 최근 것
            best = got
    return best.isoformat() if best else None


def _date_from_text(hay: str) -> str | None:
    """본문에서 날짜를 찾되, 조회 시각이 붙은 워터마크 줄은 건너뛴다."""
    for line in hay.split("\n"):
        if "Copyright" in line or "::" in line:      # FnGuide 워터마크
            continue
        m = DATE_PAT.search(line)
        if m:
            return f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"
    return None


_파싱캐시: dict = {}


def parse_pdf(path: Path, max_chars: int = 60000) -> BrokerReport:
    """PDF 하나를 읽는다. **같은 파일을 두 번 읽지 않는다.**

    2026-08-24 추가 — 한 번 수집을 돌 때 같은 PDF 가 여러 번 파싱되고 있었다.
    104개 149MB 를 종목마다 다시 읽어 20종목 수집이 몇 시간짜리가 됐다.
    파일 경로·수정시각·크기를 열쇠로 캐시한다.
    """
    try:
        st = path.stat()
        열쇠 = (str(path), st.st_mtime_ns, st.st_size, max_chars)
    except OSError:
        열쇠 = None
    if 열쇠 is not None and 열쇠 in _파싱캐시:
        return _파싱캐시[열쇠]

    rep = _parse_pdf_실제(path, max_chars)
    if 열쇠 is not None:
        _파싱캐시[열쇠] = rep
    return rep


def _parse_pdf_실제(path: Path, max_chars: int = 60000) -> BrokerReport:
    rep = BrokerReport(file=path.name)
    try:
        import pdfplumber
    except ImportError:
        rep.error = "pdfplumber 가 설치되지 않았습니다. `pip install pdfplumber`"
        return rep

    try:
        with pdfplumber.open(path) as pdf:
            rep.pages = len(pdf.pages)
            chunks = []
            for page in pdf.pages:
                chunks.append(page.extract_text() or "")
            rep.text = "\n".join(chunks)[:max_chars]
    except Exception as e:                          # noqa: BLE001
        rep.error = f"PDF 를 읽지 못했습니다: {e}"
        return rep

    # --- 텍스트가 뽑히는 PDF 인지 먼저 판정한다 -----------------------------
    # 증권사 리포트 중에는 표지와 요약 박스가 통째로 이미지·벡터로 된 것이 있다.
    # 이런 파일은 목표주가·투자의견이 '없는' 게 아니라 '안 읽히는' 것이다.
    # 구분하지 않으면 데이터팩에 조용히 빈칸으로 남아 보고서가 잘못 나간다.
    per_page = len(rep.text) / max(rep.pages, 1)
    if per_page < 300:
        rep.error = (f"텍스트가 거의 추출되지 않았습니다(쪽당 {per_page:.0f}자). "
                     "표지가 이미지로 된 리포트일 수 있습니다. 목표주가는 사람이 직접 확인하세요.")

    head = rep.text[:6000]
    hay = f"{path.name}\n{head}"

    for b in BROKERS:
        if b in hay:
            rep.broker = b
            break

    # 작성일: 파일명의 8자리 날짜를 1순위로 쓴다.
    #   본문에서 찾으면 FnGuide 워터마크("...::2026-08-19")처럼 '내려받은 날짜'를 잡아버린다.
    #   그러면 몇 달 전 리포트가 전부 오늘 날짜로 찍혀서 '목표주가의 변화'를 볼 수 없게 된다.
    rep.published = _date_from_name(path.name) or _date_from_text(hay)

    # Not Rated 리포트는 목표주가가 없는 것이 정상이다. 억지로 숫자를 찾지 않는다.
    if NOT_RATED_PAT.search(head):
        rep.opinion = "Not Rated"
    else:
        cands = []
        m = TARGET_CHANGE_PAT.search(head)      # 'A원에서 B원으로' 가 있으면 B가 답이다
        if m:
            cands.append(m.group(1))
        cands += [x.group(1) for x in TARGET_PAT.finditer(head)]
        for c in cands:
            try:
                v = float(c.replace(",", ""))
            except ValueError:
                continue
            # 목표주가는 보통 네 자리 이상이다. 세 자리 이하는 배수·비율을 잘못 잡은 것이다.
            if 1000 <= v <= 100_000_000:
                rep.target_price = v
                break

    m = OPINION_PAT.search(head)
    if m:
        rep.opinion = m.group(1).strip()

    for m in re.finditer(r"([가-힣]{2,4})\s*(?:연구원|애널리스트)", head):
        if m.group(1) not in rep.analysts:
            rep.analysts.append(m.group(1))

    # 첫 페이지에서 소제목처럼 보이는 줄 = 투자포인트 후보
    for line in head.split("\n"):
        s = line.strip()
        if 8 <= len(s) <= 45 and not re.search(r"\d{3,}", s) and \
           re.search(r"[가-힣]", s) and not s.endswith("."):
            rep.key_lines.append(s)
    rep.key_lines = rep.key_lines[:12]
    return rep


def collect_reports(folder: Path, stock_code: str | None = None,
                    stock_name: str | None = None) -> list[BrokerReport]:
    """폴더 안의 PDF 를 읽는다. 종목명/코드가 파일명이나 본문에 있으면 그것만 고른다.

    **종목별 하위 폴더를 쓰면 그 폴더만 읽는다.**
      입력_리포트PDF/
        티에스이/   ← `collect.py 131290` 이 '티에스이'로 돌면 여기만 본다
        인바디/
        코스메카코리아/
    폴더로 나눠 두면 (1) 다른 종목 PDF 를 매번 파싱하지 않아 빨라지고,
    (2) 본문에 다른 종목이 언급됐을 때 잘못 딸려 오는 일이 없다.
    폴더가 없으면 예전처럼 전체를 훑으므로, 그냥 다 넣어둬도 동작은 같다.
    """
    folder = Path(folder)
    if not folder.exists():
        return []

    # **맥 파일명은 NFD, CSV 의 종목명은 NFC 다.**
    #
    # 2026-08-24 — 이걸 안 맞춰서 `"타이거일렉" in "타이거일렉"` 이 False 였다.
    # 자모가 분리돼 저장되기 때문인데(코드포인트 5개 대 12개), 그 결과
    # **한글 종목은 폴더 매칭이 한 번도 성공한 적이 없다.**
    # 예전 코드는 매칭에 실패하면 전체를 훑어 본문 텍스트로 다시 걸렀으므로
    # 결과는 맞았지만 그 대가로 PDF 104개를 종목마다 다시 읽고 있었다.
    # 양쪽을 NFC 로 맞추면 폴더가 제대로 잡히고, 그래서 빠르면서 정확해진다.
    def _nfc(x: str) -> str:
        return unicodedata.normalize("NFC", x or "")

    이름N, 코드N = _nfc(stock_name), _nfc(stock_code)
    하위폴더 = [d for d in sorted(folder.iterdir())
              if d.is_dir() and not _nfc(d.name).startswith(("_", "."))]
    내종목폴더 = [d for d in 하위폴더
                if (이름N and 이름N in _nfc(d.name)) or (코드N and 코드N in _nfc(d.name))]

    쓸파일: list[Path] = []
    if 내종목폴더:
        for d in 내종목폴더:
            쓸파일 += sorted(d.glob("**/*.pdf"))
        print(f"     · 종목 폴더: {', '.join(d.name for d in 내종목폴더)} ({len(쓸파일)}건)")
        본문검사 = False
    else:
        # **하위 폴더는 남의 종목 자리다. 열지 않는다.**
        #
        # 2026-08-24 수정 — 예전에는 종목 폴더가 없으면 `**/*.pdf` 로 전체를 훑고
        # 본문에 종목명이 있는지 하나씩 파싱해 확인했다. PDF 104개 149MB 를
        # 폴더 없는 종목마다 전부 읽는 셈이라(11종목 × 104개 = 1,144회)
        # 20종목 수집이 몇 시간이 됐다. 하위 폴더에 든 PDF 는 이미 다른 종목 것으로
        # 분류돼 있으므로, 폴더가 없는 종목은 **분류 안 된 루트의 낱개 PDF 만** 본다.
        쓸파일 = sorted(folder.glob("*.pdf"))
        본문검사 = bool(쓸파일)
        if 하위폴더 and not 쓸파일:
            print(f"     · 이 종목의 리포트 폴더가 없습니다 "
                  f"(있는 폴더: {len(하위폴더)}개). 리포트 없이 진행합니다.")

    out = []
    for p in 쓸파일:
        rep = parse_pdf(p)
        if 본문검사 and (이름N or 코드N):
            hay = _nfc(f"{p.name}\n{rep.text[:6000]}")
            if not ((이름N and 이름N in hay) or (코드N and 코드N in hay)):
                continue
        out.append(rep)

    bad = [r for r in out if r.error]
    if bad:
        print(f"     · 주의: {len(bad)}건은 텍스트가 추출되지 않았습니다(이미지 리포트). "
              "목표주가는 데이터팩에 '미확인'으로 남습니다.")
    return out


def consensus_from_reports(reports: list[BrokerReport]) -> dict:
    """여러 리포트의 목표주가 분포. 전직 애널리스트 조언대로 '한 명'이 아니라 '변화와 분산'을 본다."""
    tps = [(r.broker or r.file, r.published, r.target_price)
           for r in reports if r.target_price]
    if not tps:
        return {}
    vals = [t[2] for t in tps]
    return {
        "리포트수": len(tps),
        "평균목표주가": round(sum(vals) / len(vals)),
        "최고": max(vals), "최저": min(vals),
        "분산폭(%)": round((max(vals) / min(vals) - 1) * 100, 1) if min(vals) else None,
        "목록": [{"증권사": b, "작성일": d, "목표주가": v} for b, d, v in
                sorted(tps, key=lambda t: (t[1] or ""))],
    }
