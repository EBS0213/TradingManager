"""
SEC EDGAR 공시 '본문' 수집기  (해외 종목용 — dart_biz.py 의 짝)
------------------------------------------------------------------
국내 종목은 DART 반기·사업보고서 본문에서 사업의 내용·수주·소송을 가져온다.
해외 종목에는 그게 없어서 재무 숫자만 남고, 그러면 보고서가 재무제표 해설서가 된다.
증권사 리포트도 해외 기업은 거의 없다. 그 빈자리를 SEC 원문으로 채운다.

가져오는 것 (10-K / 10-Q / 8-K)
  · Item 1.  Business            — 무엇을 만들어 누구에게 파는가. 고객·경쟁사·시장이 여기 있다
  · Item 1A. Risk Factors        — 회사가 스스로 적은 위험. **레드팀 절의 1급 재료**
  · Item 3.  Legal Proceedings   — 소송
  · Item 7.  MD&A                — 경영진이 직접 쓴 실적 해설. 숫자의 '이유'
  · Item 7A. Market Risk         — 환·금리·원자재 노출
  · 8-K EX-99.1                  — 분기 실적 보도자료. 컨퍼런스콜 자료의 뼈대

컨퍼런스콜 전문은 SEC 에 올라오지 않는다. 회사 IR 사이트 주소를 데이터팩에 함께 적어 두어
보고서를 쓸 때 사람(또는 클로드)이 직접 확인하도록 한다.

원칙은 같다. **모르면 비워두고 '미확인'이라고 적는다.**
"""

from __future__ import annotations

import html as _html
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import requests

ARCHIVES = "https://www.sec.gov/Archives/edgar/data"


@dataclass
class ItemSpec:
    key: str
    # 10-K/10-Q 본문에서 이 항목의 머리글을 찾는 정규식
    pat: str
    cap: int
    why: str


ITEM_SPECS: list[ItemSpec] = [
    ItemSpec("사업의내용(Item 1)", r"item\s*1\s*[\.\:\-–—]?\s*business", 16000,
             "무엇을 만들어 누구에게 파는가. 제품·고객·경쟁사·시장 규모가 모두 여기 있다. "
             "보고서 II·III절의 뼈대."),
    ItemSpec("리스크(Item 1A)", r"item\s*1a\s*[\.\:\-–—]?\s*risk\s*factors", 20000,
             "**회사가 스스로 적은 위험.** 레드팀 절에서 가장 먼저 볼 곳. "
             "다만 형식적 나열이 많으니 '이 회사에만 해당하는 것'을 골라 쓸 것."),
    ItemSpec("소송(Item 3)", r"item\s*3\s*[\.\:\-–—]?\s*legal\s*proceedings", 6000,
             "소송·규제 조사. 금액과 진행 단계를 확인한다."),
    ItemSpec("경영진분석(Item 7/2)",
             r"item\s*[27]\s*[\.\:\-–—]?\s*management'?s?\s*discussion", 20000,
             "경영진이 직접 쓴 실적 해설. **숫자가 왜 그렇게 나왔는지**가 여기 있다. "
             "증권사 리포트와 대조할 첫 번째 자료."),
    ItemSpec("시장위험(Item 7A/3)",
             r"item\s*[37]a\s*[\.\:\-–—]?\s*quantitative\s*and\s*qualitative", 6000,
             "환율·금리·원자재 노출. 영업외손익이 흔들릴 때 원인이 여기다."),
]

# 이 뒤에 나오는 항목들은 우리가 쓰지 않는다. 경계로만 쓴다.
ITEM_BOUNDARY = re.compile(
    r"item\s*(?:1a|1b|1c|2|3|4|5|6|7a|7|8|9a|9b|9|10|11|12|13|14|15|16)\s*[\.\:\-–—]",
    re.I)


# ---------------------------------------------------------------------------
# HTML → 텍스트
# ---------------------------------------------------------------------------
def html_to_text(raw: str) -> str:
    """SEC 인라인 XBRL HTML 을 사람이 읽는 텍스트로.

    표는 통째로 버리지 않고 셀을 ' | ' 로 이어 한 줄로 만든다.
    (Item 1 의 제품·고객 표, Item 7 의 실적 비교표가 쓸모 있기 때문)
    """
    s = re.sub(r"(?is)<(script|style|head)\b.*?</\1>", " ", raw)
    s = re.sub(r"(?is)<!--.*?-->", " ", s)
    # 표: 행은 줄바꿈, 셀은 파이프
    s = re.sub(r"(?i)</t[dh]>\s*", " | ", s)
    s = re.sub(r"(?i)</tr>", "\n", s)
    # 문단 구분
    s = re.sub(r"(?i)<(br|/p|/div|/h[1-6]|/li)[^>]*>", "\n", s)
    s = re.sub(r"<[^>]+>", " ", s)
    s = _html.unescape(s)
    s = s.replace("\xa0", " ").replace("’", "'").replace("—", "—")
    lines = []
    for ln in s.split("\n"):
        ln = re.sub(r"[ \t]+", " ", ln).strip()
        ln = re.sub(r"(\s*\|\s*)+", " | ", ln).strip(" |")
        if ln:
            lines.append(ln)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines))


def split_items(text: str) -> list[tuple[str, int, int]]:
    """본문에서 Item 머리글 위치를 찾아 (제목, 시작, 끝) 목록을 만든다."""
    hits = [(m.group(0), m.start()) for m in ITEM_BOUNDARY.finditer(text)]
    out = []
    for i, (title, start) in enumerate(hits):
        end = hits[i + 1][1] if i + 1 < len(hits) else len(text)
        out.append((title, start, end))
    return out


def _is_toc_line(text: str, pos: int) -> bool:
    """이 위치의 Item 머리글이 목차(Table of Contents) 줄인지 판정한다.

    목차는 두 가지 특징이 있다.
      ① 제목 뒤에 점선과 쪽 번호만 온다  → "Item 1A. Risk Factors ....... 12"
      ② 바로 다음 줄에 또 다른 Item 이 이어진다
    둘 중 하나라도 걸리면 본문이 아니라 목차다.
    """
    tail = text[pos:pos + 260]
    first_line = tail.split("\n", 1)[0]
    # ① 제목 줄이 점·공백·숫자·쪽표시로만 끝난다
    after_title = re.sub(r"(?i)^item\s*\d+[a-c]?\s*[\.\:\-–—]?\s*[a-z'’\s&,\(\)/]*", "", first_line)
    if re.fullmatch(r"[\.\s·•\-–—]*\d{1,4}\s*", after_title or " "):
        return True
    # ② 바로 뒤에 또 다른 Item 머리글이 오는데 그 사이에 '글'이 거의 없다
    #    (목차는 항목이 연달아 나열되고 사이에 점선·쪽번호만 있다.
    #     본문 Item 3 처럼 내용이 짧은 절을 목차로 오인하지 않도록 글자수로 가른다)
    nxt = ITEM_BOUNDARY.search(tail[40:])
    if nxt:
        between = tail[40:40 + nxt.start()]
        if len(re.sub(r"[^0-9A-Za-z]", "", between)) < 60:
            return True
    return False


def extract_item(text: str, pat: str, cap: int) -> str:
    """해당 Item 의 본문을 뽑는다.

    같은 제목이 목차에도 나오므로 목차 줄을 먼저 걸러내고,
    남은 것 중 **가장 긴 조각**을 고른다.
    """
    best = ""
    for m in re.finditer(pat, text, re.I):
        if _is_toc_line(text, m.start()):
            continue
        start = m.start()
        nxt = ITEM_BOUNDARY.search(text, m.end() + 40)
        end = nxt.start() if nxt else min(len(text), start + cap * 3)
        chunk = text[start:end].strip()
        if len(chunk) > len(best):
            best = chunk
    if len(best) > cap:
        best = best[:cap] + f"\n\n…(이하 {len(best) - cap:,}자 생략 — 원문 링크에서 확인)"
    return best


# ---------------------------------------------------------------------------
# 결과 그릇
# ---------------------------------------------------------------------------
@dataclass
class SecDoc:
    form: str = ""
    filed: str = ""
    period: str = ""
    url: str = ""
    items: dict[str, str] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)

    def summary(self) -> dict[str, Any]:
        return {"양식": self.form, "제출일": self.filed, "대상기간": self.period,
                "원문": self.url, "수집한항목": list(self.items.keys()), "메모": self.notes}


def _fetch(client, url: str, cache_name: str) -> str | None:
    """텍스트(HTML) 를 받아 캐시에 저장한다. EdgarClient 의 헤더를 그대로 쓴다."""
    cache = Path(client.cache) / f"{cache_name}.txt"
    if cache.exists():
        return cache.read_text(encoding="utf-8", errors="replace")
    try:
        r = requests.get(url, headers=client.headers, timeout=90)
        time.sleep(getattr(client, "pause", 0.2))
        if r.status_code != 200:
            return None
        txt = r.text
    except Exception:                                    # noqa: BLE001
        return None
    cache.write_text(txt, encoding="utf-8")
    return txt


def collect_sec_text(client, cik: str, filings: list[dict],
                     want_annual: bool = True) -> list[SecDoc]:
    """최신 10-Q(또는 10-K)와 가장 최근 10-K 의 본문에서 필요한 Item 을 뽑는다.

    10-Q 는 Item 1(Business)이 없다. 사업 설명은 10-K 에만 있으므로 둘 다 본다.
    """
    picks: list[dict] = []
    tenq = next((f for f in filings if f.get("form") in ("10-Q", "10-K")), None)
    if tenq:
        picks.append(tenq)
    if want_annual and (not tenq or tenq.get("form") != "10-K"):
        tenk = next((f for f in filings if f.get("form") == "10-K"), None)
        if tenk:
            picks.append(tenk)

    out: list[SecDoc] = []
    for f in picks:
        doc = SecDoc(form=f.get("form", ""), filed=f.get("filed", ""),
                     period=f.get("period") or "", url=f.get("url", ""))
        acc = f.get("url", "").rstrip("/").split("/")[-2] if "/" in f.get("url", "") else ""
        raw = _fetch(client, doc.url, f"sec_doc_{acc}")
        if not raw:
            doc.notes.append("원문을 받지 못했습니다.")
            out.append(doc)
            continue
        text = html_to_text(raw)
        if len(text) < 2000:
            doc.notes.append(f"본문이 너무 짧습니다({len(text):,}자). 원문 링크에서 확인하세요.")
        for spec in ITEM_SPECS:
            got = extract_item(text, spec.pat, spec.cap)
            if len(got) >= 150:                          # 목차 조각은 위에서 이미 걸러진다
                doc.items[spec.key] = got
        if not doc.items:
            doc.notes.append("Item 머리글을 인식하지 못했습니다. 원문 링크에서 직접 확인하세요.")
        out.append(doc)
    return out


def collect_earnings_release(client, cik: str, filings: list[dict],
                             max_docs: int = 2) -> list[SecDoc]:
    """8-K 에 붙은 실적 보도자료(EX-99.1)를 가져온다.

    컨퍼런스콜 전문은 SEC 에 없지만, 실적 보도자료에는 콜에서 읽는 숫자와
    가이던스가 대부분 들어 있다. 콜 자료의 뼈대라고 보면 된다.
    """
    out: list[SecDoc] = []
    for f in [x for x in filings if x.get("form") == "8-K"][:6]:
        if len(out) >= max_docs:
            break
        url = f.get("url", "")
        if "/" not in url:
            continue
        base = url.rsplit("/", 1)[0]
        acc = base.rstrip("/").split("/")[-1]
        idx = _fetch(client, f"{base}/index.json", f"sec_idx_{acc}")
        if not idx:
            continue
        name = None
        for m in re.finditer(r'"name"\s*:\s*"([^"]+)"', idx):
            n = m.group(1)
            if re.match(r"(?i).*(ex[-_]?99[._-]?1|exhibit99).*\.(htm|html|txt)$", n):
                name = n
                break
        if not name:
            continue
        raw = _fetch(client, f"{base}/{name}", f"sec_ex_{acc}")
        if not raw:
            continue
        text = html_to_text(raw)
        if len(text) < 800:
            continue
        doc = SecDoc(form="8-K EX-99.1 (실적 보도자료)", filed=f.get("filed", ""),
                     period=f.get("period") or "", url=f"{base}/{name}")
        doc.items["실적 보도자료"] = text[:18000] + (
            f"\n\n…(이하 {len(text) - 18000:,}자 생략)" if len(text) > 18000 else "")
        out.append(doc)
    return out


# ---------------------------------------------------------------------------
# 데이터팩용 마크다운
# ---------------------------------------------------------------------------
def sec_markdown(docs: list[SecDoc], releases: list[SecDoc], profile: dict) -> str:
    buf: list[str] = []
    A = buf.append
    A("\n## 8. SEC 공시 본문 — 재무 밖의 사실\n")
    if not docs and not releases:
        A("SEC 원문을 수집하지 못했습니다.\n")
        return "\n".join(buf)

    A("> 여기 있는 것은 **회사가 직접 써서 SEC 에 제출한 문장**입니다. 1급 재료입니다.\n"
      "> 해외 종목은 국내 증권사 리포트가 거의 없으므로 **이 절이 사실상 유일한 1차 자료**입니다.\n"
      "> 보고서 본문에 반드시 녹여 쓰되, 회사의 자기 설명이므로 재무와 대조하세요.\n")

    why = {s.key: s.why for s in ITEM_SPECS}
    for d in docs:
        A(f"\n### {d.form} (제출 {d.filed} · 대상기간 {d.period or '미확인'}) · [원문]({d.url})\n")
        if d.notes:
            A("> " + " / ".join(d.notes) + "\n")
        for k, v in d.items.items():
            A(f"\n<details><summary>{k} — {why.get(k, '')}</summary>\n")
            A("\n```\n" + v + "\n```\n")
            A("</details>\n")

    for d in releases:
        A(f"\n### {d.form} (제출 {d.filed}) · [원문]({d.url})\n")
        for k, v in d.items.items():
            A(f"\n<details><summary>{k} — 콜에서 읽는 숫자와 가이던스가 대부분 여기 있다</summary>\n")
            A("\n```\n" + v + "\n```\n")
            A("</details>\n")

    # 컨퍼런스콜은 SEC 에 없다. 어디서 찾아야 하는지를 적어 둔다.
    name = (profile.get("name") or "").strip()
    A("\n### 컨퍼런스콜·IR 자료 — 여기는 사람이 확인해야 한다\n")
    A("SEC 에는 컨퍼런스콜 전문이 올라오지 않습니다. 보고서를 쓸 때 아래를 직접 확인하세요.\n")
    A(f"- **회사 IR 사이트** — `{name} investor relations` 로 검색. "
      "분기 실적 발표 자료(deck)와 콜 다시듣기가 대개 여기 있습니다.")
    A(f"- **콜 전문** — `{name} earnings call transcript` 로 검색. "
      "Motley Fool·Insider Monkey 등에 공개본이 올라옵니다. **3급 자료이므로 "
      "숫자는 그대로 쓰지 말고 8-K 실적 보도자료나 10-Q 로 확인한 뒤 쓰세요.**")
    A(f"- **가이던스** — 위 8-K EX-99.1 안에 다음 분기 매출·EPS 가이던스가 들어 있는 경우가 많습니다. "
      "있으면 그것을 1급으로 쓰고, 콜 발언은 보조로만 씁니다.")
    A(f"- **산업 자료** — SIC {profile.get('sic')} ({profile.get('sic_desc')}). "
      "이 분류를 실마리로 시장 규모·성장률·경쟁사를 웹에서 찾습니다.\n")
    return "\n".join(buf)
