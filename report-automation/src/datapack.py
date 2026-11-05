"""
데이터팩 만들기
---------------
수집한 것들을 한 곳에 모아 두 가지 파일로 떨군다.

  datapack.json  — 기계가 읽는 것 (나중에 다시 계산할 때)
  datapack.md    — 클로드가 읽는 것. 보고서는 이 파일 하나만 보고도 쓸 수 있어야 한다.

원칙: **모르는 값은 비워두고 '미확인'이라고 적는다.** 채워 넣지 않는다.
보고서에서 가장 위험한 건 틀린 숫자가 아니라, 출처 없이 그럴듯한 숫자다.
"""

from __future__ import annotations

import json
from dataclasses import asdict, is_dataclass
from datetime import datetime
from pathlib import Path
from typing import Any

억 = 1e8


def _n(v, digits=0, unit=""):
    if v is None:
        return "미확인"
    if isinstance(v, float) and digits:
        return f"{v:,.{digits}f}{unit}"
    return f"{v:,.0f}{unit}"


def _table(headers: list[str], rows: list[list[Any]]) -> str:
    out = ["| " + " | ".join(headers) + " |",
           "|" + "|".join(["---"] * len(headers)) + "|"]
    for r in rows:
        out.append("| " + " | ".join("" if c is None else str(c) for c in r) + " |")
    return "\n".join(out)


def _jsonable(obj):
    if is_dataclass(obj):
        return _jsonable(asdict(obj))
    if isinstance(obj, dict):
        return {k: _jsonable(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_jsonable(v) for v in obj]
    return obj


def build_datapack(outdir: Path, *, code: str, name: str, fs, metrics: dict,
                   price, trend: dict, vol: dict, peer_group, disclosures: list[dict],
                   reports: list, report_consensus: dict, charts: dict[str, str],
                   extra: dict | None = None,
                   biz: list | None = None, major: dict | None = None,
                   sec: dict | None = None) -> tuple[Path, Path]:
    outdir = Path(outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    now = datetime.now().strftime("%Y-%m-%d %H:%M")
    CUR = "달러" if getattr(fs, "currency", "KRW") == "USD" else "원"
    U = getattr(fs, "unit_div", 1e8)          # 표시 단위 나누는 값
    UL = getattr(fs, "unit_label", "억원")     # 표시 단위 이름

    payload = _jsonable({
        "생성시각": now, "종목코드": code, "종목명": name,
        "재무": {"연결여부": getattr(fs, "fs_div", None),
                "분기": getattr(fs, "quarters", []),
                "항목": getattr(fs, "data", {}),
                "미확인항목": getattr(fs, "missing", [])},
        "지표": metrics, "시세": price, "추세판정": trend, "변동성": vol,
        "피어그룹": peer_group, "공시": disclosures,
        "증권사리포트": [r.summary() for r in reports],
        "리포트컨센서스": report_consensus, "차트": charts, "기타": extra or {},
        "공시본문": [b.summary() for b in (biz or [])],
        "공시본문_절": {b.rcept_no: b.sections for b in (biz or [])},
        "주요정보": major or {},
        "SEC본문": [d.summary() for d in ((sec or {}).get("docs") or [])],
    })
    json_path = outdir / "datapack.json"
    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    md: list[str] = []
    A = md.append
    A(f"# {name}({code}) 데이터팩")
    A(f"\n생성 {now} · 이 파일은 보고서를 쓰기 위한 **재료**입니다. 그대로 옮기지 말고 해석해서 쓰세요.\n")

    # ---- 1. 시세 --------------------------------------------------------
    A("## 1. 시세 · 밸류에이션\n")
    if price:
        rows = [
            ["종가", f"{_n(price.last_close)}{CUR}", price.last_date or ""],
            ["52주 최고 / 최저", f"{_n(price.high_52w)} / {_n(price.low_52w)}{CUR}", "종가 기준"],
            ["시가총액", f"{_n((price.market_cap or 0) / U, 0)}{UL}" if price.market_cap else "미확인", ""],
            ["PER / PBR", f"{_n(price.per,2)} / {_n(price.pbr,2)}", "KRX 공시 기준"],
            ["EPS / BPS", f"{_n(price.eps)} / {_n(price.bps)}{CUR}", ""],
        ]
        for k, v in (price.ma or {}).items():
            rows.append([k, f"{_n(v)}{CUR}", ""])
        A(_table(["항목", "값", "비고"], rows))
        if price.consensus:
            c = price.consensus
            A(f"\n**공개 컨센서스**: 목표주가 {_n(c.get('목표주가'))}{CUR} · "
              f"투자의견 {c.get('투자의견') or '미확인'} · "
              f"현재가 대비 {c.get('현재가대비(%)', '미확인')}% (출처 {c.get('출처')})\n")
        if price.notes:
            A("\n> 수집 메모: " + " / ".join(price.notes) + "\n")

    # ---- 2. 재무 --------------------------------------------------------
    A("\n## 2. 분기 재무 (12분기)\n")
    qs = getattr(fs, "quarters", [])
    if qs:
        A(f"연결/별도: **{'연결' if fs.fs_div == 'CFS' else '별도'}** · 단위: {UL} · "
          "분기 값은 누적에서 앞 분기를 뺀 **해당 분기만의 금액**입니다.\n")
        keys = [("revenue", "매출액"), ("op_income", "영업이익"), ("net_income", "당기순이익"),
                ("assets", "자산총계"), ("liabilities", "부채총계"), ("equity", "자본총계"),
                ("cfo", "영업활동현금흐름"), ("inventories", "재고자산"),
                ("receivables", "매출채권"), ("contract_liab", "계약부채")]
        rows = []
        for key, label in keys:
            ser = fs.series(key)
            if all(v is None for v in ser):
                continue
            rows.append([label] + [_n(v / U) if v is not None else "-" for v in ser])
        A(_table(["항목"] + qs, rows))

        A("\n### 계산 지표\n")
        mrows = []
        for label in ("매출액YoY(%)", "영업이익YoY(%)", "영업이익률(%)", "순이익률(%)",
                      "부채비율(%)", "ROE(TTM,%)", "현금전환(CFO/영업이익)",
                      "영업이익률 변화(%p)"):
            ser = metrics.get(label)
            if not ser or all(v is None for v in ser):
                continue
            digits = 2 if "현금전환" in label else 1
            mrows.append([label] + [_n(v, digits) if v is not None else "-" for v in ser])
        A(_table(["지표"] + qs, mrows))
        A("\n- **현금전환** = 영업활동현금흐름 ÷ 영업이익. 1을 계속 밑돌면 이익이 현금이 아니라 "
          "매출채권·재고로 쌓이고 있다는 뜻이다. 레드팀 절에서 먼저 확인할 항목.")
        A("- **영업이익률 변화(%p)** 가 연속 플러스면 이익 가속, 연속 마이너스면 감속.")
        if getattr(fs, "missing", None):
            A(f"\n> DART 에서 찾지 못한 계정: {', '.join(fs.missing)} — 회사가 다른 이름을 쓰거나 "
              "해당 계정이 없는 경우입니다. 필요하면 원문 보고서에서 직접 확인하세요.")

    # ---- 3. 추세 --------------------------------------------------------
    A("\n## 3. 추세 판정 · 변동성 (미너비니 기준)\n")
    if trend:
        A(_table(["조건", "충족 여부"],
                 [[k, {True: "O", False: "X", None: "미확인"}[v]]
                  for k, v in trend.get("조건", {}).items()]))
        A(f"\n**판정: {trend.get('판정')}** (충족 {trend.get('충족')} / "
          f"미충족 {trend.get('미충족')} / 미확인 {trend.get('미확인')})\n")
    if vol:
        A(_table(["항목", "값"], [[k, v] for k, v in vol.items() if k != "설명"]))
        A(f"\n> {vol.get('설명', '')}\n")

    # ---- 4. 피어 --------------------------------------------------------
    A("\n## 4. 피어그룹\n")
    if peer_group and getattr(peer_group, "peers", None):
        A(f"선정 방식: {peer_group.method} · 업종: {peer_group.sector or '미확인'}\n")
        rows = [[p.name, p.code or "-",
                 _n((p.market_cap or 0) / U) if p.market_cap else "미확인",
                 _n(p.per, 2), _n(p.pbr, 2)] for p in peer_group.peers]
        A(_table(["회사", "코드", f"시가총액({UL})", "PER", "PBR"], rows))
        if peer_group.notes:
            A("\n> " + " / ".join(peer_group.notes) + "\n")
    else:
        A("피어를 자동으로 잡지 못했습니다. config.yaml 의 peers 에 직접 적어주세요.\n")

    # ---- 5. 공시 --------------------------------------------------------
    A("\n## 5. 최근 공시\n")
    if disclosures:
        rows = [[d.get("rcept_dt"), d.get("report_nm"), d.get("flr_nm"),
                 f"[원문]({d.get('url')})"] for d in disclosures[:30]]
        A(_table(["일자", "보고서명", "제출인", "링크"], rows))
    else:
        A("최근 공시 없음 또는 수집 실패\n")

    # ---- 6. 증권사 리포트 ------------------------------------------------
    A("\n## 6. 증권사 리포트\n")
    if reports:
        A(_table(["작성일", "증권사", "투자의견", "목표주가", "비고", "파일"],
                 [[r.published or "미확인", r.broker or "미확인",
                   r.opinion or "미확인", _n(r.target_price),
                   "⚠ 이미지 PDF — 사람이 직접 확인" if r.error else "",
                   r.file]
                  for r in sorted(reports, key=lambda x: x.published or "")]))
        broken = [r for r in reports if r.error]
        if broken:
            A(f"\n> **주의: {len(broken)}건은 표지가 이미지로 되어 있어 목표주가·투자의견을 자동으로 읽지 못했습니다.**\n"
              "> 아래 「리포트 원문」에도 텍스트가 거의 없습니다. 이 파일들은 **PDF 를 직접 열어서**\n"
              "> 목표주가와 투자의견을 확인해야 합니다. 자동 수집값이 '미확인'인 것을 "
              "'목표주가가 없다'로 읽으면 안 됩니다.\n>\n"
              "> 해당 파일: " + " · ".join(r.file for r in broken) + "\n")
        if report_consensus:
            c = report_consensus
            A(f"\n**목표주가 분포**: {c.get('리포트수')}건 · 평균 {_n(c.get('평균목표주가'))}원 · "
              f"최고 {_n(c.get('최고'))} / 최저 {_n(c.get('최저'))} · 분산폭 {c.get('분산폭(%)')}%")
            A("\n> 목표주가는 **수준**보다 **변화**를 본다. 같은 증권사의 직전 리포트 대비 "
              "올랐는지 내렸는지, 그리고 증권사 간 분산이 큰지를 먼저 확인할 것.\n")
        A("\n### 리포트 원문 (분석 재료 — 인용은 짧게, 재배포 금지)\n")
        for r in reports:
            A(f"\n<details><summary>{r.file}</summary>\n")
            if r.key_lines:
                A("\n소제목 후보: " + " · ".join(r.key_lines) + "\n")
            A("\n```\n" + (r.text[:20000] if r.text else "(텍스트 추출 실패)") + "\n```\n")
            A("</details>\n")
    else:
        A("`입력_리포트PDF` 폴더에 해당 종목 리포트가 없습니다.\n")
        if sec:
            A("\n> **해외 종목은 이게 정상입니다.** 국내 증권사가 커버하지 않는 기업이 대부분입니다.\n"
              "> 리포트가 없다고 보고서 밀도를 낮추지 말고, 아래 순서로 재료를 대체하세요.\n"
              "> (스킬 §1 「증권사 리포트가 없을 때」)\n>\n"
              "> 1. **8절의 Item 1A(Risk Factors)** → VII절 레드팀의 1차 재료\n"
              "> 2. **8절의 Item 7(MD&A)** → 실적 변화 원인에 대한 회사 자신의 설명\n"
              "> 3. **8절의 8-K EX-99.1** → 다음 분기 가이던스 숫자\n"
              "> 4. **컨퍼런스콜 전문** → 회사 IR 사이트에서 찾고, 재게시본은 3급으로 취급해 8-K 와 대조\n"
              "> 5. **공개 컨센서스 · bear case** → 웹 검색. `short thesis` · `bear case` · "
              "`overvalued` 를 따로 검색하지 않으면 VII절이 회사가 써 준 리스크 요약으로 끝납니다\n>\n"
              "> **VI절 제목을 「회사 가이던스와 시장 기대의 검증」으로 바꾸고 배점 15는 유지합니다.**\n"
              "> 직전 가이던스를 회사가 실제로 맞췄는지 2~3분기 치를 표로 만드는 것이 그 절의 핵심입니다.\n")
        else:
            A("\n> 국내 종목인데 리포트가 없다면 (1) 애초에 커버리지가 없는 종목이거나 "
              "(2) PDF 를 `입력_리포트PDF/<종목명>/` 폴더에 넣지 않은 것입니다.\n"
              "> 커버리지가 없는 종목이라면 VI절을 억지로 채우지 말고, 회사 IR 자료와 공개 컨센서스로 "
              "대체한 뒤 그 사실을 절 첫머리에 한 줄로 밝히세요.\n")

    # ---- 7. 차트 --------------------------------------------------------
    A("\n## 7. 생성된 차트\n")
    if charts:
        for k, v in charts.items():
            A(f"- `{k}` → {v}")
        A("\n보고서 HTML 에서는 `<img src=\"차트/파일명.png\">` 로 넣으면 됩니다.\n")

    # ---- 8. 공시 본문 (재무 밖의 사실) -----------------------------------
    if sec and (sec.get("docs") or sec.get("releases")):
        try:
            from .sec_text import sec_markdown
            A(sec_markdown(sec.get("docs") or [], sec.get("releases") or [],
                           sec.get("profile") or {}))
        except Exception as e:                       # noqa: BLE001
            A(f"\n## 8. SEC 공시 본문\n\n정리 중 오류: {e}\n")
    if biz or major:
        try:
            from .dart_biz import biz_markdown
            A(biz_markdown(biz or [], major or {}))
        except Exception as e:                       # noqa: BLE001
            A(f"\n## 8. 공시 본문\n\n정리 중 오류: {e}\n")

    md_path = outdir / "datapack.md"
    md_path.write_text("\n".join(md), encoding="utf-8")
    return json_path, md_path
