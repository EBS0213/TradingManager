#!/usr/bin/env python3
"""카드뉴스에 보태는 두 가지 (2026-10-05 신설, 사용자 지시).

  ① 차트 카드 — 표지 다음 장. 6개월 일봉 차트와 그 아래 현재가·시가총액·등락률·거래량·
     거래대금·스카우트 점수·상태. 수치는 홈페이지 스카우트 결과(/api/screener/latest),
     일봉은 네이버 증권에서 받습니다. 상태 상자는 웹페이지 상태 박스와 같은 색입니다.
  ② 한눈에 — 산문 한 문단을 「키워드 — 설명」 3~4줄로. Claude 에게 정리만 맡기고
     새 사실을 보태지 못하게 합니다. 같은 글은 캐시/카드뉴스/ 에 남겨 다시 부르지 않습니다.
"""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import io
import json
import os
import re
import subprocess
import urllib.request
from pathlib import Path
from 코덱스실행 import run as codex_run

뿌리 = Path(__file__).resolve().parent
캐시 = 뿌리 / "캐시" / "카드뉴스"
UA = {"user-agent": "Mozilla/5.0"}
SITE = "http://127.0.0.1:8766"

# 웹페이지 상태 박스 색 (public/screener/app.html .stage.*) — 배경, 글자, 테두리
상태색 = {
    "돌파구간": ("#FEF6C3", "#8A6A00", "#F2E08A"), "피벗권": ("#FEF6C3", "#8A6A00", "#F2E08A"),
    "돌파": ("#BFE9CE", "#10693A", "#7FCFA0"), "추세유지": ("#DFF3C2", "#46700F", "#B4DE84"),
    "연장": ("#DFF3C2", "#46700F", "#B4DE84"), "재시도": ("#E4F4DA", "#12703A", "#12703A"),
    "되돌림": ("#FFE1CE", "#B03A0B", "#EFA97F"), "베이스": ("#EEF1F6", "#5A6577", "#DFE4EC"),
}
별칭 = {"피벗권": "돌파구간", "매수구간": "돌파구간", "연장": "추세유지"}


def _받기(url, timeout=30):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return json.loads(r.read().decode())


def _수(v):
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None


# ───────────────────────── ① 차트 카드 ─────────────────────────
def 스카우트행(코드: str) -> tuple[dict | None, str]:
    """그 종목의 최신 스카우트 결과 한 줄과 기준 시각."""
    시장 = "KR" if 코드.isdigit() else "US"
    try:
        d = _받기(f"{SITE}/api/screener/latest" + ("?market=US" if 시장 == "US" else ""), 60)
        m = re.match(r"(\d{4}-\d{2}-\d{2} \d{2}:\d{2})", str(d.get("stamp") or ""))
        return next((r for r in d.get("result", []) if str(r.get("코드")) == 코드), None), (m.group(1) if m else "")
    except Exception:
        return None, ""


def 일봉(코드: str) -> list[dict]:
    끝 = dt.date.today() + dt.timedelta(days=1)
    처음 = 끝 - dt.timedelta(days=400)
    기간 = f"startDateTime={처음:%Y%m%d}0000&endDateTime={끝:%Y%m%d}0000"
    if 코드.isdigit():
        return _받기(f"https://api.stock.naver.com/chart/domestic/item/{코드}/day?{기간}")
    for 끝자리 in (".O", "", ".K", ".N"):        # 미국은 거래소마다 끝자리가 다릅니다
        try:
            봉 = _받기(f"https://api.stock.naver.com/chart/foreign/item/{코드}{끝자리}/day?{기간}")
            if isinstance(봉, list) and 봉:
                return 봉
        except Exception:
            pass
    return []


def _차트png(봉: list[dict], 피벗: float | None, 미국: bool) -> bytes:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib import font_manager
    for f in (os.path.expanduser("~/Library/Fonts/NotoSansCJK.ttc"), "/System/Library/Fonts/AppleSDGothicNeo.ttc"):
        if os.path.exists(f):
            font_manager.fontManager.addfont(f)
            plt.rcParams["font.family"] = font_manager.FontProperties(fname=f).get_name()
            break
    plt.rcParams["axes.unicode_minus"] = False
    빨, 파 = "#e0333a", "#2f6fd6"
    봉 = 봉[-260:]
    보일 = 봉[-125:]
    n = len(보일)
    종 = [b["closePrice"] for b in 봉]
    def 이평(k):
        return [sum(종[i - k + 1:i + 1]) / k if i >= k - 1 else None for i in range(len(종))][-n:]
    고52 = max(b["highPrice"] for b in 봉)
    돈 = (lambda v: f"${v:,.2f}") if 미국 else (lambda v: f"{v:,.0f}")
    fig = plt.figure(figsize=(9.28, 5.6), dpi=100)
    위 = fig.add_axes([0.085, 0.30, 0.9, 0.66])
    아래 = fig.add_axes([0.085, 0.07, 0.9, 0.19], sharex=위)
    for i, b in enumerate(보일):
        o, h, l, c = b["openPrice"], b["highPrice"], b["lowPrice"], b["closePrice"]
        색 = 빨 if c >= o else 파
        위.vlines(i, l, h, color=색, linewidth=1)
        위.add_patch(plt.Rectangle((i - 0.32, min(o, c)), 0.64, max(abs(c - o), (h - l) * 0.01 or 1e-6),
                                   color=색, linewidth=0))
        아래.bar(i, b["accumulatedTradingVolume"], width=0.7, color=색, alpha=0.75)
    for k, 색 in ((20, "#f2a33a"), (50, "#34a36b")):
        y = 이평(k)
        위.plot([i for i in range(n) if y[i]], [v for v in y if v], color=색, linewidth=1.6, label=f"{k}일선")
    같음 = 피벗 and abs(피벗 / 고52 - 1) < 0.005
    상자 = dict(facecolor="white", edgecolor="none", pad=1.5)
    if 피벗 and not 같음:
        위.axhline(피벗, color="#555", linestyle=(0, (6, 3)), linewidth=1.2)
        위.text(n - 1, 피벗, f"피벗 {돈(피벗)}", color="#555", fontsize=11, ha="right",
               va="top" if 피벗 < 고52 else "bottom", bbox=상자, zorder=6)
    위.axhline(고52, color=빨, linestyle=(0, (2, 3)), linewidth=1.2)
    위.text(n - 1, 고52, f"피벗 = 52주 최고 {돈(고52)}" if 같음 else f"52주 최고 {돈(고52)}",
           color=빨, fontsize=11, va="bottom", ha="right", bbox=상자, zorder=6)
    for ax in (위, 아래):
        for s in ("top", "right"):
            ax.spines[s].set_visible(False)
        ax.spines["left"].set_color("#ccc"); ax.spines["bottom"].set_color("#ccc")
        ax.tick_params(colors="#666", labelsize=11)
        ax.grid(axis="y", color="#eee", linewidth=0.8)
    위.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(lambda v, _: f"{v:,.0f}"))
    아래.yaxis.set_major_formatter(matplotlib.ticker.FuncFormatter(
        lambda v, _: f"{v / 1e6:.0f}M" if v >= 1e6 else f"{v / 1e3:.0f}K"))
    눈 = [i for i, b in enumerate(보일) if i > 0 and 보일[i - 1]["localDate"][4:6] != b["localDate"][4:6]]
    아래.set_xticks(눈, [f"{int(보일[i]['localDate'][4:6])}월" for i in 눈])
    plt.setp(위.get_xticklabels(), visible=False)
    위.set_xlim(-1, n)
    위.legend(loc="upper left", frameon=True, facecolor="white", edgecolor="white", framealpha=1,
             fontsize=11).set_zorder(5)
    쪽 = io.BytesIO()
    fig.savefig(쪽, format="png")
    plt.close(fig)
    return 쪽.getvalue()


def 차트카드(코드: str) -> dict | None:
    """차트 카드 한 장(dict). 일봉을 못 받으면 None — 카드를 빼고 나머지는 그대로 굽습니다."""
    if not 코드:
        return None
    봉 = 일봉(코드)
    if not 봉:
        return None
    r, 기준 = 스카우트행(코드)
    미국 = not 코드.isdigit()
    r = r or {}
    마지막 = 봉[-1]
    현재 = _수(r.get("현재가")) or 마지막["closePrice"]
    등락 = _수(r.get("등락률"))
    if 등락 is None and len(봉) >= 2:
        등락 = 마지막["closePrice"] / 봉[-2]["closePrice"] - 1
    거래량 = 마지막.get("accumulatedTradingVolume")
    거래대금 = _수(r.get("거래대금"))
    시총 = _수(r.get("시가총액"))
    점수 = _수(r.get("종합점수"))
    상태원 = str(r.get("피벗상태") or "")
    상태 = 별칭.get(상태원, 상태원)
    피벗 = _수(r.get("피벗가격"))

    def 원화(v):
        if v is None:
            return "-"
        return f"{v / 1e12:,.1f}조원" if v >= 1e12 else f"{v / 1e8:,.0f}억원"
    def 달러(v):
        if v is None:
            return "-"
        return f"{v / 1e8:,.0f}억달러" if v >= 1e10 else f"{v / 1e8:,.1f}억달러"
    def 주(v):
        if v is None:
            return "-"
        return f"{v / 1e6:,.2f}백만주" if v >= 1e6 else f"{v:,.0f}주"
    칸 = [
        ("현재가", f"${현재:,.2f}" if 미국 else f"{현재:,.0f}원", ""),
        ("등락률", "-" if 등락 is None else f"{등락 * 100:+.2f}%",
         "" if 등락 is None else ("up" if 등락 >= 0 else "dn")),
        ("시가총액", 달러(시총) if 미국 else 원화(시총), ""),
        ("거래량", 주(거래량), ""),
        ("거래대금", 달러(거래대금) if 미국 else 원화(거래대금), ""),
        ("스카우트 점수", "-" if 점수 is None else f"{점수:.0f}점", ""),
    ]
    # 상태 낱말을 감싸던 색 상자는 뺐습니다 (2026-10-05 사용자 지시). 글자색만 웹 상태 색을 따릅니다.
    _, 글, _ = 상태색.get(상태원, 상태색.get(상태, ("#EEF1F6", "#5A6577", "#DFE4EC")))
    상태칸 = (f'<div class="지칸 상태칸"><div class="지이름">상태</div>'
              f'<div class="지값" style="color:{글}">{상태 or "-"}</div></div>')
    그림 = base64.b64encode(_차트png(봉, 피벗, 미국)).decode()
    몸 = (f'<img class="차트그림" src="data:image/png;base64,{그림}">'
          '<div class="지표">'
          + "".join(f'<div class="지칸"><div class="지이름">{ㄱ}</div>'
                    f'<div class="지값 {cls}">{ㄴ}</div></div>' for ㄱ, ㄴ, cls in 칸)
          + 상태칸 + "</div>"
          + (f'<div class="지기준">스카우트 {기준} 기준 · 차트는 최근 6개월 일봉</div>' if 기준 else ""))
    return {"종류": "차트", "갈피": "주가 · 스카우트", "제목": "", "몸통": 몸}


# ───────────────────────── ② 한눈에 ─────────────────────────
지시 = """아래 문단을 투자 카드뉴스의 '한눈에' 장으로 정리하세요.
- 3~4줄. 각 줄은 「키워드|설명」 형식으로, 가운데에 | 하나만 씁니다.
- 키워드: 4~12자 명사구 (예: 정제마진 의존 구조, 2분기 이익 급증, 밸류에이션 부담).
- 설명: 한 문장, 습니다체, 60자 안팎. 원문에 있는 숫자와 사실만 씁니다. 새 사실·전망·해석을 보태지 마십시오.
- 쓰지 않는 표현: 갈래, 닿다, 논거, 걸려 있는 질문, 「~인가입니다」 같은 묻는 꼴 맺음, 방향이 엇갈렸다.
- 출력은 그 줄들만. 번호·머리말·설명을 붙이지 마십시오.

문단:
"""


def 한눈에(리드: str) -> list[tuple[str, str]]:
    """[(키워드, 설명)] — 실패하면 [] (그러면 원래처럼 문단으로 둡니다)."""
    if not 리드.strip():
        return []
    캐시.mkdir(parents=True, exist_ok=True)
    키 = 캐시 / f"한눈에_{hashlib.sha1(리드.encode()).hexdigest()[:16]}.json"
    if 키.exists():
        try:
            return [tuple(x) for x in json.loads(키.read_text(encoding="utf-8"))]
        except Exception:
            pass
    try:
        r = codex_run(지시 + 리드, role="summary", timeout=240)
        if r.returncode:
            return []
        out = r.stdout
    except Exception:
        return []
    줄 = []
    for l in out.splitlines():
        l = l.strip().lstrip("-•·0123456789.) ").strip()
        if "|" in l:
            ㄱ, ㄴ = [x.strip() for x in l.split("|", 1)]
            if ㄱ and ㄴ and len(ㄱ) <= 20:
                줄.append((ㄱ, ㄴ))
    if not 2 <= len(줄) <= 5:
        return []
    키.write_text(json.dumps(줄, ensure_ascii=False), encoding="utf-8")
    return 줄
