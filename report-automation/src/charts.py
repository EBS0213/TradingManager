"""
차트 생성기
-----------
보고서에 넣을 그래프를 PNG 로 만든다. 규칙은 세 가지만 기억하면 된다.

1. 축은 하나만 쓴다. 매출(억원)과 영업이익률(%)처럼 단위가 다르면 그래프를 나눈다.
   (한 그림에 좌우 두 축을 쓰면 두 선의 교차점이 아무 의미도 없는데 의미가 있어 보인다)
2. 색은 정해진 순서대로만 쓴다. 시리즈가 늘어도 색을 새로 만들지 않는다.
3. 격자와 축은 흐리게, 데이터는 진하게.
"""

from __future__ import annotations

from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib import font_manager  # noqa: E402
from matplotlib.ticker import FuncFormatter  # noqa: E402

# --- 색 (검증된 기본 팔레트, 밝은 배경용) ---------------------------------
SURFACE = "#fcfcfb"
INK = "#0b0b0b"
INK2 = "#52514e"
MUTED = "#898781"
GRID = "#e1e0d9"
AXIS = "#c3c2b7"
SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100",
          "#e87ba4", "#008300", "#4a3aa7", "#e34948"]
GOOD, BAD = "#0ca30c", "#d03b3b"

억 = 1e8


def use_korean_font() -> str:
    """맥·윈도우·리눅스 어디서 돌려도 한글이 깨지지 않게 폰트를 고른다."""
    have = {f.name for f in font_manager.fontManager.ttflist}
    for name in ("Apple SD Gothic Neo", "AppleGothic", "Malgun Gothic",
                 "NanumGothic", "Noto Sans KR", "Noto Sans CJK KR",
                 "Noto Sans CJK JP", "IPAGothic"):
        if name in have:
            plt.rcParams["font.family"] = name
            plt.rcParams["axes.unicode_minus"] = False
            return name
    plt.rcParams["axes.unicode_minus"] = False
    return "(한글 폰트를 찾지 못했습니다 — 글자가 네모로 보이면 나눔고딕을 설치하세요)"


def _fig(width=9.0, height=4.2):
    fig, ax = plt.subplots(figsize=(width, height), dpi=160)
    fig.patch.set_facecolor(SURFACE)
    ax.set_facecolor(SURFACE)
    ax.grid(axis="y", color=GRID, linewidth=0.8, zorder=0)
    ax.set_axisbelow(True)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(AXIS)
        ax.spines[side].set_linewidth(0.8)
    ax.tick_params(colors=MUTED, labelsize=9, length=0)
    return fig, ax


def _finish(fig, ax, path: Path, title: str, subtitle: str = "", legend: bool = False):
    # SVG 로도 같이 저장한다. 보고서 HTML 에 SVG 를 그대로 붙여 넣으면
    # 파일이 하나로 끝나고(이미지 링크가 깨지지 않고) 인쇄 화질도 깨지지 않는다.
    matplotlib.rcParams["svg.fonttype"] = "path"   # 글자를 도형으로 저장 → 폰트 없는 PC 에서도 안 깨짐
    ax.set_title(title, color=INK, fontsize=13, fontweight="bold", loc="left", pad=18 if subtitle else 10)
    if subtitle:
        ax.text(0, 1.02, subtitle, transform=ax.transAxes, color=INK2, fontsize=9.5, va="bottom")
    if legend:
        leg = ax.legend(frameon=False, fontsize=9.5, loc="upper left",
                        bbox_to_anchor=(0, -0.12), ncol=4)
        for t in leg.get_texts():
            t.set_color(INK2)
    path.parent.mkdir(parents=True, exist_ok=True)
    fig.tight_layout()
    fig.savefig(path, facecolor=SURFACE, bbox_inches="tight")
    fig.savefig(path.with_suffix(".svg"), facecolor=SURFACE, bbox_inches="tight")
    plt.close(fig)
    return str(path)


def _clean(xs, ys):
    """None 을 빼고 (x, y) 만 남긴다 — 미공시 분기 때문에 선이 끊기는 걸 막는다."""
    return zip(*[(x, y) for x, y in zip(xs, ys) if y is not None]) if any(
        y is not None for y in ys) else ([], [])


# ---------------------------------------------------------------------------
def chart_quarterly_pl(quarters, revenue, op_income, outdir: Path, name="분기실적.png",
                       unit_div=억, unit_label="억원"):
    """분기 매출액·영업이익 (같은 단위라 한 그림에 넣어도 된다)"""
    억 = unit_div
    fig, ax = _fig()
    x = range(len(quarters))
    w = 0.38
    rev = [None if v is None else v / 억 for v in revenue]
    op = [None if v is None else v / 억 for v in op_income]
    ax.bar([i - w / 2 for i in x], [v or 0 for v in rev], w,
           label="매출액", color=SERIES[0], zorder=2)
    ax.bar([i + w / 2 for i in x], [v or 0 for v in op], w,
           label="영업이익", color=SERIES[1], zorder=2)
    ax.axhline(0, color=AXIS, linewidth=0.8)
    ax.set_xticks(list(x))
    ax.set_xticklabels(quarters, rotation=45, ha="right")
    ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:,.0f}"))
    # 마지막 분기만 값을 직접 적는다 (모든 막대에 숫자를 붙이지 않는다)
    for vals, off, col in ((rev, -w / 2, SERIES[0]), (op, w / 2, SERIES[1])):
        if vals and vals[-1] is not None:
            ax.text(len(quarters) - 1 + off, vals[-1], f"{vals[-1]:,.0f}",
                    ha="center", va="bottom", fontsize=9, color=INK2)
    return _finish(fig, ax, outdir / name, "분기 매출액 · 영업이익", f"단위: {unit_label}", legend=True)


def chart_margin(quarters, op_margin, outdir: Path, name="수익성.png"):
    """영업이익률 (%) — 단일 시리즈라 범례가 필요 없다"""
    fig, ax = _fig(height=3.4)
    xs, ys = _clean(range(len(quarters)), op_margin)
    ax.plot(list(xs), list(ys), color=SERIES[0], linewidth=2, marker="o",
            markersize=5, zorder=3)
    if list(ys):
        ax.text(list(xs)[-1], list(ys)[-1], f"  {list(ys)[-1]:.1f}%",
                va="center", fontsize=9.5, color=INK, fontweight="bold")
    ax.axhline(0, color=AXIS, linewidth=0.8)
    ax.set_xticks(range(len(quarters)))
    ax.set_xticklabels(quarters, rotation=45, ha="right")
    ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:.0f}%"))
    return _finish(fig, ax, outdir / name, "영업이익률 추이", "단위: %")


def chart_growth(quarters, rev_yoy, op_yoy, outdir: Path, name="성장률.png"):
    fig, ax = _fig(height=3.6)
    for vals, color, label in ((rev_yoy, SERIES[0], "매출액 YoY"),
                              (op_yoy, SERIES[1], "영업이익 YoY")):
        xs, ys = _clean(range(len(quarters)), vals)
        if list(xs):
            ax.plot(list(xs), list(ys), color=color, linewidth=2,
                    marker="o", markersize=4.5, label=label, zorder=3)
    ax.axhline(0, color=AXIS, linewidth=1.2)
    ax.set_xticks(range(len(quarters)))
    ax.set_xticklabels(quarters, rotation=45, ha="right")
    ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:.0f}%"))
    return _finish(fig, ax, outdir / name, "전년 동기 대비 성장률",
                   "0선 위 = 전년보다 성장 / 아래 = 역성장", legend=True)


def chart_earnings_quality(quarters, op_income, cfo, outdir: Path, name="이익의질.png",
                           unit_div=억, unit_label="억원"):
    """영업이익 vs 영업활동현금흐름 — 이익이 현금으로 들어오는지 본다"""
    억 = unit_div
    fig, ax = _fig(height=3.8)
    x = range(len(quarters))
    w = 0.38
    op = [None if v is None else v / 억 for v in op_income]
    cf = [None if v is None else v / 억 for v in cfo]
    ax.bar([i - w / 2 for i in x], [v or 0 for v in op], w, label="영업이익",
           color=SERIES[0], zorder=2)
    ax.bar([i + w / 2 for i in x], [v or 0 for v in cf], w, label="영업활동현금흐름",
           color=SERIES[2], zorder=2)
    ax.axhline(0, color=AXIS, linewidth=1.0)
    ax.set_xticks(list(x))
    ax.set_xticklabels(quarters, rotation=45, ha="right")
    ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:,.0f}"))
    return _finish(fig, ax, outdir / name, "이익의 질 — 영업이익 대비 현금흐름",
                   f"단위: {unit_label} · 현금흐름이 계속 이익을 밑돌면 매출채권·재고를 확인해야 한다",
                   legend=True)


def chart_stability(quarters, debt_ratio, roe, outdir: Path, name="재무안정성.png"):
    """부채비율과 ROE 는 둘 다 % 라 한 축에 놓아도 된다"""
    fig, ax = _fig(height=3.6)
    for vals, color, label in ((debt_ratio, SERIES[1], "부채비율"),
                              (roe, SERIES[0], "ROE(TTM)")):
        xs, ys = _clean(range(len(quarters)), vals)
        if list(xs):
            ax.plot(list(xs), list(ys), color=color, linewidth=2,
                    marker="o", markersize=4.5, label=label, zorder=3)
    ax.set_xticks(range(len(quarters)))
    ax.set_xticklabels(quarters, rotation=45, ha="right")
    ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:.0f}%"))
    return _finish(fig, ax, outdir / name, "재무 안정성 · 자본 수익성", "단위: %", legend=True)


def chart_price(dates, close, ma_map, outdir: Path, name="주가추이.png",
                high_52w=None, low_52w=None, cur="원"):
    fig, ax = _fig(height=4.0)
    ax.plot(range(len(close)), close, color=SERIES[0], linewidth=2, label="종가", zorder=3)
    # 이동평균은 전체 구간에 대해 다시 계산해서 선으로 그린다
    for (win, color, label) in ((50, SERIES[1], "50일선"),
                                (120, SERIES[2], "120일선"),
                                (200, SERIES[6], "200일선")):
        if len(close) >= win:
            ma = [None] * (win - 1) + [sum(close[i - win + 1:i + 1]) / win
                                       for i in range(win - 1, len(close))]
            xs, ys = _clean(range(len(close)), ma)
            ax.plot(list(xs), list(ys), color=color, linewidth=1.4, label=label, zorder=2)
    if high_52w:
        ax.axhline(high_52w, color=MUTED, linewidth=0.9, linestyle=":", zorder=1)
        ax.text(len(close) - 1, high_52w, " 52주 최고", fontsize=8.5, color=MUTED, va="bottom")
    if low_52w:
        ax.axhline(low_52w, color=MUTED, linewidth=0.9, linestyle=":", zorder=1)
        ax.text(len(close) - 1, low_52w, " 52주 최저", fontsize=8.5, color=MUTED, va="top")
    step = max(1, len(dates) // 8)
    ax.set_xticks(range(0, len(dates), step))
    ax.set_xticklabels([dates[i][:7] for i in range(0, len(dates), step)], rotation=0)
    ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:,.0f}"))
    return _finish(fig, ax, outdir / name, "주가 추이", f"단위: {cur}", legend=True)


def chart_peer_valuation(names, values, target_name, outdir: Path,
                         name="피어_밸류에이션.png", label="PER (배)"):
    """피어 비교 — 대상 기업만 색을 주고 나머지는 회색으로 눕힌다"""
    fig, ax = _fig(height=max(2.6, 0.42 * len(names) + 1.4))
    pairs = [(n, v) for n, v in zip(names, values) if v is not None]
    pairs.sort(key=lambda p: p[1])
    ys = range(len(pairs))
    colors = [SERIES[0] if n == target_name else "#cfcec7" for n, _ in pairs]
    ax.barh(list(ys), [v for _, v in pairs], color=colors, height=0.62, zorder=2)
    ax.set_yticks(list(ys))
    ax.set_yticklabels([n for n, _ in pairs], fontsize=9.5)
    ax.grid(axis="y", visible=False)
    ax.grid(axis="x", color=GRID, linewidth=0.8)
    for i, (n, v) in enumerate(pairs):
        ax.text(v, i, f" {v:,.1f}", va="center", fontsize=9,
                color=INK if n == target_name else INK2,
                fontweight="bold" if n == target_name else "normal")
    return _finish(fig, ax, outdir / name, f"피어그룹 {label}", "진한 막대가 분석 대상")


def chart_peer_price(series_map: dict[str, list[float]], dates, target_name,
                     outdir: Path, name="피어_주가.png"):
    """1년 전을 100 으로 맞춘 상대 주가 — 누가 더 올랐는지만 본다"""
    fig, ax = _fig(height=4.0)
    for i, (nm, closes) in enumerate(list(series_map.items())[:6]):
        if not closes or closes[0] in (None, 0):
            continue
        rebased = [c / closes[0] * 100 for c in closes]
        is_target = nm == target_name
        ax.plot(range(len(rebased)), rebased,
                color=SERIES[0] if is_target else SERIES[(i % 6) + 1],
                linewidth=2.4 if is_target else 1.4, label=nm, zorder=3 if is_target else 2)
    ax.axhline(100, color=AXIS, linewidth=1.0)
    step = max(1, len(dates) // 8)
    ax.set_xticks(range(0, len(dates), step))
    ax.set_xticklabels([dates[i][:7] for i in range(0, len(dates), step)])
    return _finish(fig, ax, outdir / name, "피어그룹 상대 주가",
                   "1년 전 = 100 으로 맞춤", legend=True)
