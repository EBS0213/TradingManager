#!/usr/bin/env python3
"""
자료 수집기 — 이 파일 하나만 실행하면 됩니다.

  python3 collect.py              관심종목 파일(watchlist.csv)에 있는 종목 전부
  python3 collect.py 119850       한 종목만
  python3 collect.py --demo       인터넷·인증키 없이 전 과정 점검 (가짜 데이터)

결과는 out/<종목코드>_<이름>/ 폴더에
  datapack.md    ← 클로드가 읽고 보고서를 쓰는 재료
  datapack.json  ← 같은 내용의 기계용 파일
  차트/*.png     ← 보고서에 넣을 그래프
로 떨어집니다.
"""

from __future__ import annotations

import argparse
import csv
import unicodedata
import sys
import traceback
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from src import charts as C                      # noqa: E402
from src.datapack import build_datapack          # noqa: E402


def load_config() -> dict:
    import yaml
    f = ROOT / "config.yaml"
    if not f.exists():
        raise SystemExit("config.yaml 이 없습니다. 같은 폴더에 두고 다시 실행하세요.")
    return yaml.safe_load(f.read_text(encoding="utf-8")) or {}


# watchlist.csv 의 열 이름은 사람마다 다르게 적는다. 아래 이름이면 모두 알아본다.
#   (열 이름 하나 다르다고 자동 실행이 통째로 헛돌면 안 된다)
_CODE_KEYS = ("종목코드", "코드", "code", "Code", "CODE", "티커", "ticker", "Ticker", "심볼", "symbol")
_NAME_KEYS = ("종목명", "이름", "회사명", "name", "Name", "종목")
_KIND_KEYS = ("구분", "보유구분", "분류", "상태", "kind", "type")


def _pick(row: dict, keys) -> str:
    for k in keys:
        v = row.get(k)
        if v and str(v).strip():
            return str(v).strip().strip('"')
    return ""


def _csv행읽기(f) -> tuple[list[dict], list[dict]]:
    """CSV 한 개를 읽어 (원본 행, 파싱된 종목) 을 돌려준다."""
    with f.open(encoding="utf-8-sig") as fp:
        rows = list(csv.DictReader(fp))
    out = []
    for row in rows:
        code = _pick(row, _CODE_KEYS)
        if not code or code.startswith("#"):
            continue
        out.append({"종목코드": code,
                    "종목명": _pick(row, _NAME_KEYS) or code,
                    "구분": _pick(row, _KIND_KEYS) or "관심",
                    "출처": f.name})
    return rows, out


def _nfc(x: str) -> str:
    """맥은 파일 이름을 자모 분해(NFD)로 저장한다. 비교 전에 NFC 로 맞춘다."""
    return unicodedata.normalize("NFC", x or "")


def load_watchlist() -> list[dict]:
    """관심종목을 읽는다.

    2026-08-23 개편 — **`워치리스트/` 폴더 안의 CSV 를 전부 읽는다.**
    파일을 여러 개로 나눠 두어도 되고(예: 국내.csv / 해외.csv / 신규.csv),
    파일 이름은 무엇이든 상관없다. `_` 나 `~$` 로 시작하는 파일만 건너뛴다.

    **같은 종목이 여러 파일에 있으면 한 번만 만든다.** 종목코드를 대문자로 맞춰
    비교하며, 먼저 읽은 쪽(파일명 순)을 남기고 뒤엣것은 버린다.
    다만 뒤엣것의 구분이 '보유'면 그쪽을 살린다 — 돈이 들어간 쪽이 우선이므로.

    폴더가 없으면 예전처럼 루트의 `watchlist.csv` 를 읽는다(하위 호환).
    """
    # 2026-08-24 고침 — 폴더 이름을 '워치리스트' 하나로만 봤더니, 사용자가
    # 'Watchlist' 폴더에 새 종목(팬오션·한국콜마·VLO)을 넣었는데도 못 읽었다.
    # 이제 이름이 다른 관심종목 폴더를 **모두** 읽어 합친다.
    이름후보 = {"워치리스트", "watchlist", "관심종목", "관심목록"}
    폴더들 = [d for d in sorted(ROOT.iterdir())
             if d.is_dir() and _nfc(d.name).lower() in 이름후보]
    파일들 = []
    for 폴더 in 폴더들:
        파일들 += sorted(x for x in 폴더.glob("*.csv")
                        if not x.name.startswith(("_", "~$", ".")))
    if (ROOT / "watchlist.csv").exists():
        파일들.append(ROOT / "watchlist.csv")
    if not 파일들:
        print("⚠ 관심종목 CSV 를 찾지 못했습니다.")
        print("   '워치리스트' 또는 'Watchlist' 폴더를 만들고 그 안에 CSV 를 넣어 주세요.")
        return []

    본 = {}          # 대문자 종목코드 -> 종목
    중복 = []
    빈파일 = []
    for f in 파일들:
        rows, got = _csv행읽기(f)
        if rows and not got:
            cols = ", ".join(rows[0].keys())
            print(f"⚠ {f.name} 에 {len(rows)}줄이 있는데 종목코드 열을 찾지 못했습니다.")
            print("   현재 열 이름: " + cols)
            print("   종목코드 열은 다음 중 하나여야 합니다: " + ", ".join(_CODE_KEYS[:5]))
        if not got:
            빈파일.append(f.name)
        for r in got:
            key = r["종목코드"].strip().upper()
            앞 = 본.get(key)
            if 앞 is None:
                본[key] = r
            else:
                중복.append((key, r["종목명"], 앞["출처"], f.name))
                # 뒤엣것이 '보유'면 그쪽으로 갈아탄다
                if r["구분"] == "보유" and 앞["구분"] != "보유":
                    r_ = dict(r); r_["출처"] = f"{앞['출처']}→{f.name}"
                    본[key] = r_

    if len(파일들) > 1 or 폴더.is_dir():
        print(f"· 워치리스트 CSV {len(파일들)}개: " + ", ".join(x.name for x in 파일들))
    if 중복:
        print(f"· 중복 {len(중복)}건은 한 번만 만듭니다:")
        for key, name, a, b in 중복:
            print(f"    {key} {name} — {a} 와 {b} 에 중복")
    if 빈파일:
        print("· 종목을 못 읽은 파일: " + ", ".join(빈파일))

    return list(본.values())


def safe_name(s: str) -> str:
    return "".join(ch for ch in s if ch.isalnum() or ch in " _-가-힣").strip() or "무명"


def periods_from_reports(biz, fs) -> list[tuple[int, int]]:
    """주요정보 API 에 넣을 (연도, 분기) 후보를 최신순으로.

    보고서명이 '반기보고서 (2026.06)' 형태라 여기서 연·분기를 읽는다.
    실패하면 재무 시계열의 마지막 분기를 쓰고, 그것도 없으면 작년 사업보고서를 본다.
    """
    import re as _re
    from datetime import date as _date
    out: list[tuple[int, int]] = []
    for b in biz or []:
        m = _re.search(r"\((\d{4})[.\-/](\d{2})", b.report_nm or "")
        if m:
            out.append((int(m.group(1)), max(1, min(4, int(m.group(2)) // 3))))
    for q in reversed(getattr(fs, "quarters", []) or []):
        m = _re.match(r"(\d{4})Q(\d)", str(q))
        if m:
            out.append((int(m.group(1)), int(m.group(2))))
    out.append((_date.today().year - 1, 4))
    seen, uniq = set(), []
    for p in out:
        if p not in seen:
            seen.add(p)
            uniq.append(p)
    return uniq[:6]


def make_charts(outdir: Path, fs, metrics, price, peer_group, demo=False) -> dict[str, str]:
    cdir = outdir / "차트"
    made: dict[str, str] = {}
    qs = fs.quarters
    UD = getattr(fs, "unit_div", 1e8)
    UL = getattr(fs, "unit_label", "억원")
    CUR = "달러" if getattr(fs, "currency", "KRW") == "USD" else "원"

    def try_chart(key, fn):
        try:
            made[key] = fn()
        except Exception as e:                       # noqa: BLE001
            print(f"   · 차트 '{key}' 생성 실패: {e}")

    try_chart("분기실적", lambda: C.chart_quarterly_pl(
        qs, fs.series("revenue"), fs.series("op_income"), cdir,
        unit_div=UD, unit_label=UL))
    try_chart("수익성", lambda: C.chart_margin(qs, metrics.get("영업이익률(%)", []), cdir))
    try_chart("성장률", lambda: C.chart_growth(
        qs, metrics.get("매출액YoY(%)", []), metrics.get("영업이익YoY(%)", []), cdir))
    try_chart("이익의질", lambda: C.chart_earnings_quality(
        qs, fs.series("op_income"), fs.series("cfo"), cdir,
        unit_div=UD, unit_label=UL))
    try_chart("재무안정성", lambda: C.chart_stability(
        qs, metrics.get("부채비율(%)", []), metrics.get("ROE(TTM,%)", []), cdir))
    if price and price.close:
        try_chart("주가추이", lambda: C.chart_price(
            price.dates, price.close, price.ma, cdir,
            high_52w=price.high_52w, low_52w=price.low_52w, cur=CUR))
    if peer_group and peer_group.peers:
        names = [p.name for p in peer_group.peers] + [peer_group.target_name]
        pers = [p.per for p in peer_group.peers] + [price.per if price else None]
        if any(v is not None for v in pers):
            try_chart("피어_밸류에이션", lambda: C.chart_peer_valuation(
                names, pers, peer_group.target_name, cdir))
        if not demo:
            try:
                dates, series_map = __import__("src.peers", fromlist=["x"]).peer_price_series(peer_group)
                if series_map:
                    try_chart("피어_주가", lambda: C.chart_peer_price(
                        series_map, dates, peer_group.target_name, cdir))
            except Exception as e:                   # noqa: BLE001
                print(f"   · 피어 주가 차트 건너뜀: {e}")
    return made


def run_one(code: str, name: str, cfg: dict, demo: bool = False) -> Path:
    code = str(code).zfill(6) if str(code).isdigit() else str(code).upper()
    outdir = ROOT / "out" / f"{code}_{safe_name(name)}"
    print(f"\n▶ {name}({code}) 수집 시작")
    biz, major = [], {}
    extra_sec = None

    if demo:
        from src.demo import demo_disclosures, demo_peers, demo_price, demo_series
        from src.dart_fin import derive_metrics
        fs = demo_series()
        metrics = derive_metrics(fs)
        price = demo_price()
        from src.price import trend_template, volatility_stats
        trend, vol = trend_template(price), volatility_stats(price)
        pg = demo_peers()
        disc = demo_disclosures()
    elif not code.isdigit():
        # ---- 해외(미국) 종목: SEC EDGAR ----
        from src.dart_fin import derive_metrics
        from src.edgar import EdgarClient, build_series_us
        from src.peers import PeerGroup, Peer, build_peer_group
        from src.price import fetch_price, trend_template, volatility_stats

        ticker = code.upper()
        outdir = ROOT / "out" / f"{ticker}_{safe_name(name)}"
        print("   · SEC EDGAR 재무 12분기…")
        ec = EdgarClient(cfg.get("sec_user_agent", ""), ROOT / "캐시")
        fs, prof = build_series_us(ec, ticker, n_quarters=int(cfg.get("분기수", 12)))
        metrics = derive_metrics(fs)
        name = prof.get("name") or name

        print("   · 시세…")
        price = fetch_price(ticker, years=int(cfg.get("주가연수", 3)))
        trend, vol = trend_template(price), volatility_stats(price)

        print("   · 피어그룹(직접 지정만)…")
        manual = (cfg.get("peers") or {}).get(ticker)
        if manual:
            pg = build_peer_group(ticker, name, manual=manual)
        else:
            pg = PeerGroup(target_code=ticker, target_name=name,
                           sector=prof.get("sic_desc"))
            pg.method = "미지정"
            pg.notes.append(f"SIC {prof.get('sic')} ({prof.get('sic_desc')}). "
                            "해외 피어는 config.yaml 의 peers 에 티커로 직접 적어주세요.")
        disc = [{"rcept_dt": f.get("filed", "").replace("-", ""),
                 "report_nm": f"{f.get('form')} — {f.get('desc') or ''}".strip(" —"),
                 "flr_nm": name, "url": f.get("url")}
                for f in (prof.get("filings") or [])
                if f.get("form") in ("10-K", "10-Q", "8-K", "S-8", "DEF 14A", "SC 13D", "SC 13G")][:30]

        # ---- SEC 공시 '본문' ----------------------------------------------
        # 해외 종목은 국내 증권사 리포트가 거의 없다. 재무 숫자만으로 보고서를 쓰면
        # 재무제표 해설서가 되므로, 10-K/10-Q 원문에서 사업·리스크·MD&A 를 가져온다.
        if cfg.get("공시본문수집", True):
            from src.sec_text import collect_earnings_release, collect_sec_text
            print("   · SEC 원문(사업·리스크·경영진분석)…")
            try:
                sec_docs = collect_sec_text(ec, ec.cik(ticker), prof.get("filings") or [])
                for d in sec_docs:
                    print(f"     - {d.form}({d.filed}): {len(d.items)}개 항목"
                          + (f" · {d.notes[0]}" if d.notes else ""))
            except Exception as e:                   # noqa: BLE001
                print(f"     SEC 원문 수집 실패: {e}")
                sec_docs = []
            print("   · 8-K 실적 보도자료…")
            try:
                sec_rel = collect_earnings_release(ec, ec.cik(ticker), prof.get("filings") or [])
                print(f"     - {len(sec_rel)}건")
            except Exception as e:                   # noqa: BLE001
                print(f"     실적 보도자료 수집 실패: {e}")
                sec_rel = []
            extra_sec = {"docs": sec_docs, "releases": sec_rel, "profile": prof}

    else:
        from src.dart_fin import DartClient, build_series, derive_metrics
        from src.peers import build_peer_group
        from src.price import fetch_price, trend_template, volatility_stats

        client = DartClient(다트인증키(cfg), ROOT / "캐시")
        print("   · DART 재무 12분기…")
        fs = build_series(client, code, n_quarters=int(cfg.get("분기수", 12)))
        metrics = derive_metrics(fs)

        print("   · 시세·밸류에이션…")
        price = fetch_price(code, years=int(cfg.get("주가연수", 3)))
        if price.name:
            name = price.name
        trend, vol = trend_template(price), volatility_stats(price)

        print("   · 피어그룹…")
        manual = (cfg.get("peers") or {}).get(code) or (cfg.get("peers") or {}).get(int(code))
        pg = build_peer_group(code, name, manual=manual,
                              max_peers=int(cfg.get("피어수", 6)))

        print("   · 공시 목록…")
        corp = None
        try:
            corp = client.corp_code(code)
            bgn = (date.today() - timedelta(days=int(cfg.get("공시조회일수", 180)))).strftime("%Y%m%d")
            disc = client.disclosures(corp, bgn, date.today().strftime("%Y%m%d"))
        except Exception as e:                       # noqa: BLE001
            print(f"     공시 수집 실패: {e}")
            disc = []
        # 종목코드만 주고 실행하면 이름이 코드 그대로 남는다. 공시의 회사명으로 채운다.
        if name.strip() == code and disc:
            got = (disc[0].get("corp_name") or "").strip()
            if got:
                name = got
                outdir = ROOT / "out" / f"{code}_{safe_name(name)}"
                print(f"     회사명 확인: {name}")

        # ---- 공시 '본문' — 사업의 내용·수주·연구개발·소송 등 재무 밖의 사실 ----
        if corp and cfg.get("공시본문수집", True):
            from src.dart_biz import collect_biz_text, collect_major_info
            print("   · 정기보고서 본문(사업의 내용·수주·연구개발·소송)…")
            try:
                biz = collect_biz_text(client, corp)
                for b in biz:
                    print(f"     - {b.report_nm}({b.rcept_dt}): {len(b.sections)}개 절"
                          + (f" · {b.notes[0]}" if b.notes else ""))
            except Exception as e:                   # noqa: BLE001
                print(f"     본문 수집 실패: {e}")
            print("   · 정기보고서 주요정보(배당·최대주주·직원·감사의견)…")
            try:
                for yy, qq in periods_from_reports(biz, fs):
                    major = collect_major_info(client, corp, yy, qq)
                    if [k for k in major if not k.startswith("_")]:
                        print(f"     - {yy}년 {qq}분기 기준 {len([k for k in major if not k.startswith('_')])}개 항목")
                        break
            except Exception as e:                   # noqa: BLE001
                print(f"     주요정보 수집 실패: {e}")

    print("   · 증권사 리포트 PDF…")
    from src.pdf_extract import collect_reports, consensus_from_reports
    pdf_dir = Path(cfg.get("리포트폴더") or (ROOT / "입력_리포트PDF"))
    if not pdf_dir.is_absolute():
        pdf_dir = ROOT / pdf_dir
    reports = collect_reports(pdf_dir, stock_code=code, stock_name=name) if not demo else []
    rc = consensus_from_reports(reports)

    print("   · 차트…")
    C.use_korean_font()
    made = make_charts(outdir, fs, metrics, price, pg, demo=demo)

    jp, mp = build_datapack(outdir, code=code, name=name, fs=fs, metrics=metrics,
                            price=price, trend=trend, vol=vol, peer_group=pg,
                            disclosures=disc, reports=reports, report_consensus=rc,
                            charts=made, biz=biz, major=major, sec=extra_sec)
    print(f"   ✔ 완료 → {mp}")
    return outdir


def check(cfg: dict) -> None:
    """네트워크를 쓰지 않고 준비 상태만 점검한다. 10초 안에 끝난다.

    '수집이 왜 안 돌았지'를 20분 기다린 뒤에 알게 되는 일이 없도록,
    실제로 받아오기 전에 확인할 수 있는 것을 먼저 다 본다.
    """
    print("=" * 62)
    print("  수집 준비 점검  (인터넷을 쓰지 않습니다)")
    print("=" * 62)
    problems = []

    # 1. DART 인증키
    key = 다트인증키(cfg)
    if not key or key.startswith("여기에"):
        print("✗ DART 인증키가 비어 있습니다 → .env 의 DART_API_KEY")
        problems.append("DART 인증키")
    else:
        print(f"✔ DART 인증키  {key[:6]}…{key[-4:]} ({len(key)}자)")

    # 2. 워치리스트
    wl = load_watchlist()
    if not wl:
        print("✗ 관심종목이 없습니다 → watchlist.csv")
        problems.append("watchlist.csv")
    else:
        held = [r for r in wl if r["구분"] == "보유"]
        print(f"✔ 관심종목  {len(wl)}종목 (보유 {len(held)} · 관심 {len(wl)-len(held)})")
        done = {d.name.split("_")[0] for d in (ROOT / "out").iterdir() if d.is_dir()} \
            if (ROOT / "out").exists() else set()
        for r in wl:
            mark = "이미 수집됨" if r["종목코드"] in done else "미수집"
            print(f"      {r['종목코드']}  {r['종목명']:<16s} {r['구분']:<4s} {mark}")

    # 3. 리포트 PDF 폴더
    pdf_dir = ROOT / (cfg.get("리포트폴더") or "입력_리포트PDF")
    if pdf_dir.exists():
        subs = [d for d in sorted(pdf_dir.iterdir()) if d.is_dir() and not d.name.startswith("_")]
        n_all = len(list(pdf_dir.glob("**/*.pdf")))
        print(f"✔ 리포트 PDF  전체 {n_all}개" + (f", 종목 폴더 {len(subs)}개" if subs else ""))
        for d in subs:
            print(f"      {d.name:<16s} {len(list(d.glob('*.pdf')))}개")
    else:
        print(f"· 리포트 PDF 폴더가 없습니다 ({pdf_dir.name}) — 없어도 수집은 됩니다")

    # 4. 필요한 파이썬 꾸러미
    for mod, why in (("requests", "DART 접속"), ("yaml", "설정 읽기"),
                     ("matplotlib", "차트"), ("pdfplumber", "리포트 PDF 읽기"),
                     ("pykrx", "시가총액(없어도 됨)")):
        try:
            __import__(mod)
            print(f"✔ {mod:<12s} ({why})")
        except ImportError:
            opt = "없어도" in why
            print(("· " if opt else "✗ ") + f"{mod:<12s} ({why}) — pip3 install {mod}")
            if not opt:
                problems.append(mod)

    # 5. 예상 소요 시간
    if wl:
        lo, hi = len(wl) * 40 // 60, len(wl) * 100 // 60
        print(f"\n  전체 수집 예상 시간: 약 {max(lo,1)}~{hi}분 ({len(wl)}종목)")
        print("  공시 원문은 한 번 받으면 '캐시' 폴더에 남아 다음부터 빨라집니다.")

    print("-" * 62)
    if problems:
        print("✗ 이대로는 수집이 안 됩니다. 위 항목을 먼저 고치세요: " + ", ".join(problems))
    else:
        print("✔ 준비 완료. 지금 수집을 시작해도 됩니다.")
    print("=" * 62)



def 다트인증키(cfg) -> str:
    """DART 인증키를 찾는다. 2026-09-08 — 예전에는 config.yaml 에 그대로 적혀 있었다.

    config.yaml 은 저장소에 올라가므로 키를 두면 안 된다. 이 차례로 찾는다.
      1) 환경변수 DART_API_KEY
      2) 이 폴더의 .env 의 DART_API_KEY 줄
      3) config.yaml 의 dart_api_key  (옛 방식. 아직 남아 있으면 그대로 쓴다)
    """
    import os as _os
    키 = (_os.environ.get("DART_API_KEY") or "").strip()
    if 키:
        return 키
    env = ROOT / ".env"
    if env.exists():
        for 줄 in env.read_text(encoding="utf-8", errors="ignore").splitlines():
            줄 = 줄.strip()
            if 줄.startswith("DART_API_KEY="):
                키 = 줄.split("=", 1)[1].strip().strip('"').strip("'")
                if 키:
                    return 키
    return str(cfg.get("dart_api_key") or "").strip()

def main() -> None:
    ap = argparse.ArgumentParser(description="기업분석 보고서용 자료 수집기")
    ap.add_argument("codes", nargs="*", help="종목코드 (비우면 watchlist.csv 전체)")
    ap.add_argument("--demo", action="store_true", help="가짜 데이터로 전 과정 점검")
    ap.add_argument("--check", action="store_true",
                    help="인터넷 없이 준비 상태만 점검 (10초)")
    args = ap.parse_args()

    cfg = load_config() if (ROOT / "config.yaml").exists() else {}

    if args.check:
        check(cfg)
        return

    if args.demo:
        run_one("000000", "데모전자", cfg, demo=True)
        return

    targets = ([{"종목코드": c, "종목명": c} for c in args.codes]
               if args.codes else load_watchlist())

    # 보유 종목 먼저, 그다음 관심 종목. 같은 종목이 두 번 적혀 있으면 한 번만.
    order = {v: i for i, v in enumerate(cfg.get("우선순위") or ["보유", "관심"])}
    targets.sort(key=lambda r: order.get((r.get("구분") or "").strip(), 99))
    seen, uniq = set(), []
    for r in targets:
        key = (r.get("종목코드") or "").strip().upper()
        if key and key not in seen:
            seen.add(key)
            uniq.append(r)
    targets = uniq
    if targets:
        held = [t for t in targets if (t.get("구분") or "").strip() == "보유"]
        print(f"대상 {len(targets)}종목 (보유 {len(held)} → 관심 {len(targets)-len(held)}) 순서로 진행합니다.")
    if not targets:
        raise SystemExit("대상 종목이 없습니다. watchlist.csv 를 채우거나 종목코드를 넣어주세요.")

    ok, fail = [], []
    for row in targets:
        code = (row.get("종목코드") or "").strip()
        name = (row.get("종목명") or code).strip()
        try:
            run_one(code, name, cfg)
            ok.append(f"{name}({code})")
        except Exception as e:                       # noqa: BLE001
            fail.append(f"{name}({code}): {e}")
            traceback.print_exc()
    print(f"\n완료 {len(ok)}건" + (f" / 실패 {len(fail)}건" if fail else ""))
    for f in fail:
        print("  ✗", f)


if __name__ == "__main__":
    main()
