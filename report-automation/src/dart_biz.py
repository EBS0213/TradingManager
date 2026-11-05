"""
DART 정기보고서 '본문' 수집기  (재무제표 말고 나머지 전부)
------------------------------------------------------------
재무제표 숫자만으로는 회사를 설명할 수 없다.
사업보고서·반기보고서·분기보고서 본문에는 숫자보다 먼저 읽어야 할 것들이 들어 있다.

  · 사업의 개요           — 회사가 스스로 정의한 자기 사업
  · 주요 제품 및 서비스   — 제품별 매출 비중, 판매가격 추이
  · 원재료 및 생산설비    — 원재료 가격, 가동률, 증설 계획
  · 매출 및 수주상황      — 수주잔고. 제조업에서는 다음 분기 매출의 선행지표다
  · 연구개발활동          — R&D 비용률, 진행 중인 과제
  · 주주·임직원           — 최대주주 지분, 직원 수와 평균급여의 변화
  · 그 밖에 필요한 사항   — 소송, 제재, 우발부채  ← 레드팀 절의 1급 재료

하는 일은 두 가지다.
  (1) 원문 XML 을 받아서(document.xml) 필요한 절만 잘라 텍스트로 만든다
  (2) 표로 딱 떨어지는 것들은 별도 API 로 받아 정리한다 (배당·최대주주·직원·감사의견 …)

원칙은 재무 수집기와 같다. **모르면 비워두고 '미확인'이라고 적는다.**
"""

from __future__ import annotations

import io
import re
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import requests

from .dart_fin import BASE, REPRT_CODE, DartClient, DartError, to_number

# ---------------------------------------------------------------------------
# 뽑아올 절 — 제목에 이 낱말이 들어가면 가져온다
#   key    : 데이터팩에서 쓸 이름
#   pats   : 절 제목 정규식 (로마숫자·번호는 해마다 바뀌므로 낱말로 잡는다)
#   cap    : 이 절에서 가져올 최대 글자수 (본문 전체를 담으면 데이터팩이 못 쓰게 커진다)
#   why    : 이 절을 왜 보는지. 데이터팩에 같이 적어서 보고서 쓸 때 길잡이로 쓴다
# ---------------------------------------------------------------------------
@dataclass
class SectionSpec:
    key: str
    pats: tuple[str, ...]
    cap: int
    why: str


SECTION_SPECS: list[SectionSpec] = [
    SectionSpec("사업의개요", (r"사업의\s*개요",), 9000,
                "회사가 스스로 정의한 사업. 보고서 '기업 개요' 절의 뼈대."),
    SectionSpec("주요제품및서비스", (r"주요\s*제품", r"제품\s*및\s*서비스", r"주요\s*사업"), 12000,
                "제품별 매출 비중과 판매가격. 믹스 변화가 이익률 변화의 원인인지 여기서 확인."),
    SectionSpec("원재료및생산설비", (r"원재료", r"생산설비", r"생산\s*및\s*설비"), 12000,
                "원재료 가격·가동률·증설. 원가율 변화의 원인과 증설로 인한 미래 캐파."),
    SectionSpec("매출및수주상황", (r"매출\s*및\s*수주", r"수주\s*상황", r"수주\s*잔고"), 10000,
                "수주잔고는 제조·건설업에서 다음 분기 매출의 선행지표다. 반드시 인용할 것."),
    SectionSpec("위험관리및파생거래", (r"위험관리", r"파생거래", r"파생상품"), 6000,
                "환헤지·이자율스왑. 영업외손익이 크게 흔들릴 때 원인이 여기 있다."),
    SectionSpec("주요계약및연구개발", (r"주요계약", r"연구개발"), 10000,
                "R&D 비용률과 진행 과제. 장기 성장의 근거를 여기서 찾는다."),
    SectionSpec("기타참고사항", (r"기타\s*참고사항",), 10000,
                "산업의 특성·경기변동·시장점유율·경쟁요소. 산업 설명 절의 1급 재료."),
    SectionSpec("회사의개요", (r"회사의\s*개요",), 2500,
                "설립일·본점·상장일·주요 연혁."),
    SectionSpec("주주에관한사항", (r"주주에\s*관한\s*사항",), 5000,
                "최대주주 지분과 소액주주 비중. 지분 변동은 그 자체가 신호다."),
    SectionSpec("임원및직원", (r"임원\s*및\s*직원", r"직원\s*등의?\s*현황"), 3000,
                "직원 수와 평균급여의 방향. 인원이 줄면서 매출이 늘면 자동화·구조조정이다."),
    SectionSpec("계열회사", (r"계열회사", r"타법인\s*출자"), 2500,
                "종속기업 구조. 연결과 별도의 차이가 큰 회사는 여기부터 본다."),
    SectionSpec("대주주와의거래", (r"대주주\s*등과의\s*거래",), 3000,
                "내부거래. 매출의 상당 부분이 특수관계자면 레드팀 대상."),
    SectionSpec("경영진단및분석의견", (r"경영진단\s*및\s*분석의견", r"이사의\s*경영진단"), 12000,
                "경영진이 직접 쓴 실적 해설(MD&A). 회사가 무엇을 원인으로 보는지가 여기 있다. "
                "증권사 리포트와 대조할 첫 번째 자료."),
    SectionSpec("그밖에필요한사항", (r"그\s*밖에\s*투자자\s*보호", r"그\s*밖에\s*필요한\s*사항",
                                    r"그\s*밖에\s*투자의사결정"), 12000,
                "소송·제재·우발부채·주요 약정. **레드팀 절에서 가장 먼저 볼 곳.**"),
    SectionSpec("소송_제재_우발부채", (r"제재\s*등과\s*관련", r"소송\s*사건", r"우발\s*부채",
                                      r"우발채무", r"작성기준일\s*이후", r"견질\s*또는\s*담보용"), 8000,
                "**레드팀 1순위.** 과징금·소송가액·지급보증·담보제공은 여기서만 나온다."),
]

# 본문에서 통째로 걷어낼 절 (재무제표 주석은 수백 KB라 데이터팩을 못 쓰게 만든다)
SKIP_TITLE = re.compile(r"(재무제표\s*주석|연결재무제표|재무제표\s*등|전문가의\s*확인)")


# ---------------------------------------------------------------------------
# XML → 텍스트
# ---------------------------------------------------------------------------
_ENTITIES = {
    "&cr;": "\n", "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">",
    "&apos;": "'", "&quot;": '"', "&middot;": "·", "&sect;": "§",
}


def _unescape(s: str) -> str:
    for k, v in _ENTITIES.items():
        s = s.replace(k, v)
    s = re.sub(r"&#x?[0-9A-Fa-f]+;", " ", s)
    s = re.sub(r"&[A-Za-z]+;", " ", s)        # 남은 사설 엔티티
    return s


def _cell_text(frag: str) -> str:
    t = re.sub(r"<[^>]+>", " ", frag)
    return re.sub(r"\s+", " ", _unescape(t)).strip()


def _table_to_md(tbl: str, max_rows: int = 40) -> str:
    """DART 표(<TABLE><TR><TE|TD>)를 마크다운 표로. 너무 길면 앞뒤만."""
    rows: list[list[str]] = []
    for tr in re.findall(r"<TR\b[^>]*>(.*?)</TR>", tbl, re.S | re.I):
        cells = [_cell_text(c) for c in
                 re.findall(r"<T[ED]\b[^>]*>(.*?)</T[ED]>", tr, re.S | re.I)]
        if any(cells):
            rows.append(cells)
    if not rows:
        return ""
    ncol = max(len(r) for r in rows)
    if ncol < 2:
        return "\n".join(" ".join(r) for r in rows)
    if len(rows) > max_rows:
        rows = rows[: max_rows - 5] + [["…"] * ncol] + rows[-4:]
    out = []
    for i, r in enumerate(rows):
        r = r + [""] * (ncol - len(r))
        out.append("| " + " | ".join(c.replace("|", "/") for c in r) + " |")
        if i == 0:
            out.append("|" + "|".join(["---"] * ncol) + "|")
    return "\n".join(out)


def _body_to_text(frag: str) -> str:
    """절 안의 XML 조각을 사람이 읽는 텍스트로. 표는 마크다운 표로 살린다."""
    parts: list[str] = []
    pos = 0
    for m in re.finditer(r"<TABLE\b.*?</TABLE>", frag, re.S | re.I):
        parts.append(("text", frag[pos:m.start()]))
        parts.append(("table", m.group(0)))
        pos = m.end()
    parts.append(("text", frag[pos:]))

    out: list[str] = []
    for kind, chunk in parts:
        if kind == "table":
            md = _table_to_md(chunk)
            if md:
                out.append("\n" + md + "\n")
            continue
        chunk = re.sub(r"<(P|BR|TITLE|SECTION-\d)\b[^>]*>", "\n", chunk, flags=re.I)
        chunk = re.sub(r"</(P|TITLE|SECTION-\d)>", "\n", chunk, flags=re.I)
        chunk = re.sub(r"<[^>]+>", " ", chunk)
        chunk = _unescape(chunk)
        lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in chunk.split("\n")]
        lines = [ln for ln in lines if ln]
        if lines:
            out.append("\n".join(lines))
    text = "\n".join(out)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


# ---------------------------------------------------------------------------
# 본문 XML 받기
# ---------------------------------------------------------------------------
def fetch_document_xml(client: DartClient, rcept_no: str) -> str:
    """공시 원문(document.xml)을 받아 XML 문자열로. 응답은 zip 이다."""
    cache = client.cache / f"doc_{rcept_no}.xml"
    if cache.exists():
        return cache.read_text(encoding="utf-8")

    r = requests.get(f"{BASE}/document.xml",
                     params={"crtfc_key": client.key, "rcept_no": rcept_no}, timeout=90)
    r.raise_for_status()
    if r.content[:2] != b"PK":
        raise DartError(f"원문을 받지 못했습니다(zip 이 아님): {r.text[:200]}")

    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        # 본문이 제일 큰 파일이다. 첨부(감사보고서 등)는 건너뛴다.
        best = max(z.infolist(), key=lambda i: i.file_size)
        raw = z.read(best.filename)

    for enc in ("utf-8", "cp949", "euc-kr", "latin-1"):
        try:
            xml = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:                                                   # pragma: no cover
        xml = raw.decode("utf-8", errors="replace")
    cache.write_text(xml, encoding="utf-8")
    return xml


# 'I. 회사의 개요' 처럼 로마숫자로 시작하는 대제목
TOP_TITLE = re.compile(r"^\s*[IVXLC]+\s*[.．]\s*\S")


def split_sections(xml: str) -> list[tuple[str, str, str]]:
    """<TITLE> 기준으로 (제목, 본문조각, 넓은조각) 목록을 만든다.

    넓은조각이 왜 필요한가:
      'XI. 그 밖에 투자자 보호를 위하여 필요한 사항' 같은 **대제목은 그 자체로는 본문이 없다.**
      내용이 전부 '1. 공시내용 진행사항', '3. 제재 등과 관련된 사항' 같은 하위 절에 들어 있다.
      바로 다음 제목까지만 자르면 이런 절이 통째로 비어버린다.
      그래서 대제목이면 **다음 대제목이 나올 때까지**를 함께 담아둔다.
    """
    hits = list(re.finditer(r"<TITLE\b[^>]*>(.*?)</TITLE>", xml, re.S | re.I))
    titles = [_cell_text(m.group(1)) for m in hits]
    out: list[tuple[str, str, str]] = []
    for i, m in enumerate(hits):
        narrow_end = hits[i + 1].start() if i + 1 < len(hits) else len(xml)
        wide_end = narrow_end
        if TOP_TITLE.match(titles[i]):
            wide_end = len(xml)
            for j in range(i + 1, len(hits)):
                if TOP_TITLE.match(titles[j]):
                    wide_end = hits[j].start()
                    break
        out.append((titles[i], xml[m.end():narrow_end], xml[m.end():wide_end]))
    return out


# ---------------------------------------------------------------------------
# 결과 그릇
# ---------------------------------------------------------------------------
@dataclass
class BizText:
    rcept_no: str = ""
    report_nm: str = ""
    rcept_dt: str = ""
    url: str = ""
    sections: dict[str, str] = field(default_factory=dict)      # key -> 텍스트
    notes: list[str] = field(default_factory=list)

    def summary(self) -> dict[str, Any]:
        return {"접수번호": self.rcept_no, "보고서명": self.report_nm,
                "접수일": self.rcept_dt, "원문": self.url,
                "수집한절": list(self.sections.keys()), "메모": self.notes}


def latest_periodic(client: DartClient, corp_code: str, count: int = 2) -> list[dict]:
    """최근 정기보고서(사업/반기/분기) 목록. 최신순."""
    from datetime import date, timedelta
    bgn = (date.today() - timedelta(days=800)).strftime("%Y%m%d")
    data = client._get("list.json", corp_code=corp_code, bgn_de=bgn,
                       end_de=date.today().strftime("%Y%m%d"),
                       pblntf_ty="A", page_count=100)
    rows = [r for r in (data.get("list") or [])
            if re.search(r"(사업보고서|반기보고서|분기보고서)", r.get("report_nm", ""))]
    rows.sort(key=lambda r: r.get("rcept_dt", ""), reverse=True)
    return rows[:count]


def collect_biz_text(client: DartClient, corp_code: str, *, want_annual: bool = True) -> list[BizText]:
    """최근 정기보고서 본문에서 필요한 절만 뽑는다.

    최신 보고서 1건 + (그것이 분기·반기라면) 가장 최근 사업보고서 1건을 본다.
    분기보고서는 '사업의 내용'이 짧게 줄어 있으므로 사업보고서를 함께 봐야
    제품별 매출·생산능력·연구개발 같은 것이 채워진다.
    """
    picks: list[dict] = []
    try:
        recent = latest_periodic(client, corp_code, count=8)
    except Exception as e:                                   # noqa: BLE001
        raise DartError(f"정기보고서 목록 조회 실패: {e}") from e
    if not recent:
        return []
    picks.append(recent[0])
    if want_annual and "사업보고서" not in recent[0].get("report_nm", ""):
        for r in recent[1:]:
            if "사업보고서" in r.get("report_nm", ""):
                picks.append(r)
                break

    out: list[BizText] = []
    for row in picks:
        bt = BizText(rcept_no=row.get("rcept_no", ""),
                     report_nm=row.get("report_nm", "").strip(),
                     rcept_dt=row.get("rcept_dt", ""),
                     url=f"https://dart.fss.or.kr/dsaf001/main.do?rcpNo={row.get('rcept_no','')}")
        try:
            xml = fetch_document_xml(client, bt.rcept_no)
        except Exception as e:                               # noqa: BLE001
            bt.notes.append(f"원문 수집 실패: {e}")
            out.append(bt)
            continue

        secs = split_sections(xml)
        for spec in SECTION_SPECS:
            buf: list[str] = []
            for title, frag, wide in secs:
                if SKIP_TITLE.search(title):
                    continue
                if not any(re.search(p, title) for p in spec.pats):
                    continue
                # 대제목은 제 몸에 글이 없고 하위 절에 다 들어 있다. 둘 중 긴 쪽을 쓴다.
                # (대제목이 아니면 wide 와 frag 가 같으므로 결과가 달라지지 않는다)
                txt = max(_body_to_text(frag), _body_to_text(wide), key=len)
                if len(txt) < 30:
                    continue
                buf.append(f"[{title}]\n{txt}")
            if not buf:
                continue
            merged = "\n\n".join(buf)
            if len(merged) > spec.cap:
                merged = merged[: spec.cap] + f"\n\n…(이하 {len(merged) - spec.cap:,}자 생략 — 원문 링크에서 확인)"
            bt.sections[spec.key] = merged
        if not bt.sections:
            bt.notes.append("절 제목을 인식하지 못했습니다. 원문 링크에서 직접 확인하세요.")
        out.append(bt)
    return out


# ---------------------------------------------------------------------------
# 표로 떨어지는 것들 — 정기보고서 주요정보 API
# ---------------------------------------------------------------------------
MAJOR_APIS: list[tuple[str, str, str]] = [
    # (데이터팩 이름, API 경로, 왜 보는가)
    ("배당",       "alotMatter.json",
     "배당성향과 주당배당금의 방향. 이익이 늘었는데 배당이 그대로면 회사가 투자를 택한 것이다."),
    ("최대주주",   "hyslrSttus.json",
     "최대주주와 특수관계인 지분. 지분율이 낮으면 경영권 이슈, 높으면 유동주식 부족."),
    ("소액주주",   "mrhlSttus.json",
     "소액주주 비중 = 유통물량. 수급을 볼 때 쓴다."),
    ("직원",       "empSttus.json",
     "인원과 1인 평균급여. 인원이 줄면서 매출이 늘면 생산성 개선, 반대면 비용 압박."),
    ("자기주식",   "tesstkAcqsDspsSttus.json",
     "자기주식 취득·처분. 취득은 주주환원, 처분은 물량 출회다."),
    ("타법인출자", "otrCprInvstmntSttus.json",
     "지분법 손익과 우발 부담의 출처."),
    ("증자현황",   "irdsSttus.json",
     "유상증자·전환사채 전환 이력. 희석 요인."),
    ("감사의견",   "accnutAdtorNmNdAdtOpinion.json",
     "감사의견과 강조사항. **적정 이외 또는 강조사항이 있으면 레드팀 1순위.**"),
]


def collect_major_info(client: DartClient, corp_code: str, year: int, quarter: int) -> dict[str, Any]:
    """정기보고서 주요정보 API 를 한 번에 긁는다. 실패한 것은 조용히 건너뛴다."""
    out: dict[str, Any] = {}
    for name, path, why in MAJOR_APIS:
        try:
            data = client._cached(
                f"major_{path.split('.')[0]}_{corp_code}_{year}_{quarter}",
                lambda p=path: client._get(p, corp_code=corp_code, bsns_year=str(year),
                                           reprt_code=REPRT_CODE[quarter]),
            )
            rows = data.get("list") or []
            if rows:
                out[name] = {"왜보나": why, "행": rows[:40]}
        except Exception as e:                               # noqa: BLE001
            out.setdefault("_실패", []).append(f"{name}: {e}")
    return out


# ---------------------------------------------------------------------------
# 데이터팩용 마크다운 만들기
# ---------------------------------------------------------------------------
_MAJOR_COLS: dict[str, list[tuple[str, str]]] = {
    "배당":     [("se", "구분"), ("thstrm", "당기"), ("frmtrm", "전기"), ("lwfr", "전전기")],
    "최대주주": [("nm", "성명"), ("relate", "관계"), ("stock_knd", "주식종류"),
                ("trmend_posesn_stock_co", "기말 소유주식수"), ("trmend_posesn_stock_qota_rt", "지분율(%)")],
    "소액주주": [("se", "구분"), ("shrholdr_co", "주주수"), ("hold_stock_co", "보유주식수"),
                ("hold_stock_rate", "보유비율(%)")],
    "직원":     [("fo_bbm", "사업부문"), ("sm", "성별"), ("sm_sum", "합계"),
                ("avrg_cnwk_sdytrn", "평균근속연수"), ("fyer_salary_totamt", "연간급여총액"),
                ("jan_salary_am", "1인평균급여")],
    "자기주식": [("acqs_mth1", "취득방법"), ("stock_knd", "주식종류"),
                ("bsis_qy", "기초수량"), ("trmend_qy", "기말수량")],
    "타법인출자": [("inv_prm", "법인명"), ("trmend_blce_qy", "기말 주식수"),
                  ("trmend_blce_qota_rt", "지분율(%)"), ("trmend_blce_acntbk_amount", "장부가액"),
                  ("recent_bsns_year_fnnr_stt_tot_amount", "최근 사업연도 총자산")],
    "증자현황": [("isu_dcrs_de", "일자"), ("isu_dcrs_stle", "형태"),
                ("isu_dcrs_stock_knd", "종류"), ("isu_dcrs_qy", "수량"),
                ("isu_dcrs_mstvdv_fval_amount", "액면가"), ("isu_dcrs_mstvdv_amount", "발행가")],
    "감사의견": [("bsns_year", "사업연도"), ("adtor", "감사인"), ("adt_opinion", "감사의견"),
                ("adt_reprt_spcmnt_matter", "강조사항")],
}


def _rows_to_md(name: str, rows: list[dict]) -> str:
    cols = _MAJOR_COLS.get(name)
    if not cols:
        keys = list(rows[0].keys())[:6]
        cols = [(k, k) for k in keys]
    head = [label for _, label in cols]
    lines = ["| " + " | ".join(head) + " |",
             "|" + "|".join(["---"] * len(head)) + "|"]
    for r in rows:
        lines.append("| " + " | ".join(str(r.get(k, "") or "-").strip() for k, _ in cols) + " |")
    return "\n".join(lines)


def biz_markdown(biz: list[BizText], major: dict[str, Any]) -> str:
    """데이터팩에 붙일 '공시 본문' 절을 만든다."""
    buf: list[str] = []
    A = buf.append
    A("\n## 8. 공시 본문 — 재무 밖의 사실\n")
    if not biz and not major:
        A("정기보고서 본문을 수집하지 못했습니다.\n")
        return "\n".join(buf)

    A("> 여기 있는 것은 **회사가 직접 써서 공시한 문장**입니다. 1급 재료입니다.\n"
      "> 증권사 리포트보다 우선합니다. 보고서 본문에 반드시 녹여 쓰고, 숫자는 그대로 인용하세요.\n"
      "> 다만 회사의 자기 설명이므로 **낙관적 서술은 그대로 옮기지 말고 재무와 대조**하세요.\n")

    for bt in biz:
        A(f"\n### {bt.report_nm} ({bt.rcept_dt}) · [원문]({bt.url})\n")
        if bt.notes:
            A("> " + " / ".join(bt.notes) + "\n")
        why = {s.key: s.why for s in SECTION_SPECS}
        for key, text in bt.sections.items():
            A(f"\n<details><summary>{key} — {why.get(key,'')}</summary>\n")
            A("\n```\n" + text + "\n```\n")
            A("</details>\n")

    if major:
        A("\n### 정기보고서 주요정보 (표)\n")
        for name, blk in major.items():
            if name.startswith("_"):
                continue
            A(f"\n**{name}** — {blk.get('왜보나','')}\n")
            A(_rows_to_md(name, blk.get("행") or []))
            A("")
        if major.get("_실패"):
            A("\n> 수집 실패: " + " / ".join(major["_실패"]) + "\n")
    return "\n".join(buf)
