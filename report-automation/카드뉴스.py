#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""리포트 정리요약본을 텔레그램 카드뉴스로 만들어 보냅니다. (2026-10-03 신설)

    python3 카드뉴스.py out/092730_네오팜/요약_092730_2026-10-01.html
    python3 카드뉴스.py out/092730_네오팜/요약_092730_2026-10-01.html --보내기
    python3 카드뉴스.py --최신 3 --확인

왜 이렇게 하나 — 게시판에는 요약본 HTML 이 그대로 올라가지만, 텔레그램에서는
4,096자 글 한 통이 스크롤 지옥이 됩니다. 그래서 **같은 요약본을 쪼개** 1080×1350
카드 여러 장으로 굽고 `sendMediaGroup` 한 번으로 묶어 보냅니다. 한 번에 보낼 수
있는 사진은 **10장**이 한도지만, 2026-10-13 사용자 지시로 **5장 이내**로 묶고
설명(caption) 글 없이 사진만 보냅니다.

`make_images.py` 와 다른 일을 합니다. 그쪽은 **PDF 쪽을 그대로** 이미지로 뜨는
것이고(블로그용), 이쪽은 요약본을 **다시 조판**합니다. 폰 화면에서 읽히려면
한 장에 글 한 덩이만 올라가야 하므로 쪽을 뜨는 방식으로는 안 됩니다.

쓰는 글감은 **요약본뿐입니다.** 전문이나 PDF 를 다시 읽지 않습니다. 게시판에 올린
것과 텔레그램에 나간 것이 어긋나면 안 되기 때문입니다.
"""
from __future__ import annotations

import argparse
import html as _html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

뿌리 = Path(__file__).resolve().parent
카드폭, 카드높이 = 1080, 1350          # 4:5. 텔레그램이 폰에서 가장 크게 보여 주는 비율
사진한도 = 10                            # sendMediaGroup 한 묶음 한도
장수한도 = 5                             # 기업 카드는 5장 이내 (2026-10-13 사용자 지시)
설명한도 = 1024                           # 사진 묶음의 caption 한도


# ────────────────────────────────────────────────────────────
#  1. 요약본 읽기
# ────────────────────────────────────────────────────────────
def 태그떼기(조각: str) -> str:
    조각 = re.sub(r"<br\s*/?>", " ", 조각, flags=re.I)
    조각 = re.sub(r"<[^>]+>", "", 조각)
    return re.sub(r"\s+", " ", _html.unescape(조각)).strip()


def 굵게만살리기(조각: str) -> str:
    """<b> 는 카드에서도 강조로 살립니다. 나머지 태그는 떼어 냅니다."""
    조각 = re.sub(r"<br\s*/?>", " ", 조각, flags=re.I)
    조각 = re.sub(r"</?(b|strong)>", lambda m: "«" if m.group(0)[1] != "/" else "»", 조각, flags=re.I)
    조각 = re.sub(r"<[^>]+>", "", 조각)
    조각 = re.sub(r"\s+", " ", _html.unescape(조각)).strip()
    # 다시 HTML 로 — 본문은 이스케이프하고 강조만 태그로 되살립니다
    조각 = _html.escape(조각).replace("«", "<b>").replace("»", "</b>")
    return 조각


def 읽기(경로: Path) -> dict:
    """요약본을 절 단위로 가릅니다.

    요약본은 두 형식으로 나옵니다 — 독립 HTML(h1/h2 + p.meta)과 조각(h3/h4).
    어느 쪽인지 **미리 알 수 없으므로** 파일에 실제로 있는 가장 높은 머리글을
    제목으로 잡고 그 다음 단계를 절 머리글로 씁니다. 머리글이 아예 없는 요약본도
    있어서(실제로 둘 있었습니다) 그때는 문단 순서로 떨어뜨립니다.
    """
    글 = 경로.read_text(encoding="utf-8", errors="ignore")
    글 = re.sub(r"<(script|style|head)\b.*?</\1>", "", 글, flags=re.S | re.I)

    단계 = [h for h in ("h1", "h2", "h3", "h4") if re.search(rf"<{h}\b", 글, re.I)]
    제목단계 = 단계[0] if 단계 else None
    절단계 = 단계[1] if len(단계) > 1 else None

    결과: dict = {"제목": "", "곁들임": "", "리드": "", "절": [], "표": [],
                  "일정": [], "수치": {}}

    if 제목단계:
        m = re.search(rf"<{제목단계}[^>]*>(.*?)</{제목단계}>", 글, re.S | re.I)
        if m:
            제 = 태그떼기(m.group(1))
            # 「한미사이언스(008930) 분석보고서 요약」처럼 종목명만 적힌 제목이 있습니다.
            # 표지에는 종목명을 따로 싣기 때문에 그대로 두면 같은 말이 두 번 나옵니다.
            제 = re.sub(r"\s*[—–-]\s*$", "", re.sub(r"\s*(분석)?보고서(\s*요약)?\s*$", "", 제))
            제 = re.sub(r"^\s*[^—–-]{1,40}?\([A-Z0-9]{1,6}\)\s*[—–-]\s*", "", 제)
            결과["제목"] = 제.strip() or 태그떼기(m.group(1))

    # 기준일·종가 줄 (.meta/.sub 로 붙어 있습니다)
    m = re.search(r'<p[^>]*class="[^"]*(meta|sub)[^"]*"[^>]*>(.*?)</p>', 글, re.S | re.I)
    if m:
        결과["곁들임"] = 태그떼기(m.group(2))

    몸통 = 글
    if 제목단계:
        몸통 = 글[글.lower().find(f"</{제목단계}>") + len(제목단계) + 3:]

    # 절 가르기
    if 절단계:
        조각들 = re.split(rf"<{절단계}[^>]*>(.*?)</{절단계}>", 몸통, flags=re.S | re.I)
        결과["리드"] = 문단모으기(조각들[0])
        for i in range(1, len(조각들) - 1, 2):
            결과["절"].append({"이름": 태그떼기(조각들[i]),
                              "덩이": 덩이모으기(조각들[i + 1])})
    else:
        결과["리드"] = 문단모으기(몸통)
        결과["절"].append({"이름": "", "덩이": 덩이모으기(몸통)[1:]})

    # 시나리오 표 — 첫 표만 씁니다
    t = re.search(r"<table\b.*?</table>", 글, re.S | re.I)
    if t:
        for 줄 in re.findall(r"<tr\b.*?</tr>", t.group(0), re.S | re.I):
            # colspan 을 버리면 「확률가중」 행이 칸 수가 안 맞아 표가 어긋납니다
            칸 = [(굵게만살리기(c), int((re.search(r'colspan="?(\d+)', 여 or "") or [0, 1])[1]))
                  for 여, c in re.findall(r"<t[dh]\b([^>]*)>(.*?)</t[dh]>", 줄, re.S | re.I)]
            if any(c for c, _ in 칸):
                결과["표"].append(칸)

    # 표지에 올릴 핵심 수치 — 조각 요약본에는 .meta 줄이 없어 본문에서 캡니다
    평문 = 태그떼기(글)
    수치 = {}
    m = re.search(r"(\d{4}[-.]\d{1,2}[-.]\d{1,2}|\d{4}년 \d{1,2}월 \d{1,2}일)\s*종가\s*"
                  r"([\d,.]+\s*(?:원|달러))", 평문)
    if m:
        수치["기준일"], 수치["종가"] = m.group(1), m.group(2).replace(" ", "")
    m = re.search(r"확률가중[^\d]{0,40}([\d,.]+\s*(?:원|달러))", 평문)
    if m:
        수치["적정가"] = m.group(1).replace(" ", "")
    m = re.search(r"종가[^)]{0,40}대비\s*([+-][\d.]+%)", 평문)
    if m:
        수치["여력"] = m.group(1)
    결과["수치"] = 수치

    # 일정 — 「분수령」 류 절의 ul
    for 절 in 결과["절"]:
        if re.search(r"분수령|일정|확인할|점검", 절["이름"]):
            결과["일정"] = [d for d in 절["덩이"]]
            break
    return 결과


def 문단모으기(조각: str) -> str:
    문단 = [태그떼기(p) for p in re.findall(r"<p\b[^>]*>(.*?)</p>", 조각, re.S | re.I)]
    문단 = [p for p in 문단 if len(p) > 40 and not p.startswith("기준일")]
    return 문단[0] if 문단 else 태그떼기(조각)[:400]


def 덩이모으기(조각: str) -> list[str]:
    """한 절 안의 문단과 목록 항목을 **나온 순서대로** 모읍니다."""
    덩이 = []
    for m in re.finditer(r"<(p|li)\b[^>]*>(.*?)</\1>", 조각, re.S | re.I):
        글 = 굵게만살리기(m.group(2))
        if len(태그떼기(글)) >= 25:
            덩이.append(글)
    return 덩이


# ────────────────────────────────────────────────────────────
#  2. 카드 짜기
# ────────────────────────────────────────────────────────────
def 종목이름(경로: Path, 글: str = "") -> tuple[str, str]:
    """폴더가 `코드_이름` 꼴입니다. 다만 미국 종목은 `KN_KN` 처럼 코드가 둘이라
    이름이 비어 있는 것과 같습니다. 그때는 요약본의 <title>·머리글에서 캡니다."""
    폴더 = 경로.parent.name
    코드, 이름 = (폴더.split("_", 1) + [""])[:2] if "_" in 폴더 else (폴더, "")
    코드, 이름 = 코드.strip(), 이름.strip()
    if 글 and (not 이름 or 이름 == 코드):
        m = re.search(rf"([A-Za-z가-힣][\w.&,\- ]{{1,40}}?)\(\s*{re.escape(코드)}\s*\)", 글)
        if m:
            이름 = 태그떼기(m.group(1)).strip()
    return (이름 or 코드), 코드


def 첫문장(글: str, 최대: int = 180) -> str:
    평 = 태그떼기(글)
    m = re.match(r"^(.{20,}?[.。])\s", 평 + " ")
    한문장 = m.group(1) if m else 평
    return 한문장 if len(한문장) <= 최대 else 한문장[: 최대 - 1] + "…"


def 떼어내기(글: str, 머리: str) -> str:
    """제목으로 쓴 앞머리를 본문에서 덜어 냅니다. 태그가 섞여 있어 평문으로 맞춰 셉니다."""
    머리 = 머리.rstrip("…").strip()
    if not 머리:
        return 글
    자리 = 태그떼기(글).find(머리)
    if 자리 != 0:
        return 글
    # 평문 기준 길이만큼을 태그를 건너뛰며 앞에서 덜어 냅니다
    남길, 셈, 안에 = [], 0, False
    for 글자 in 글:
        if 글자 == "<":
            안에 = True
        if 셈 >= len(머리):
            남길.append(글자)
        elif not 안에:
            셈 += 1
        if 글자 == ">":
            안에 = False
    남 = "".join(남길).strip()
    남 = re.sub(r"^</?(b|strong)>\s*", "", 남, flags=re.I).strip()
    return 남 if len(태그떼기(남)) > 40 else ""


def 줄이기(글: str, 최대: int) -> str:
    """문장 끝에서 자릅니다. 글자 수로 끊으면 말이 잘려 카드가 못 쓰게 됩니다."""
    if len(태그떼기(글)) <= 최대:
        return 글
    평 = 태그떼기(글)
    자른 = 평[:최대]
    끝 = max(자른.rfind(". "), 자른.rfind("다. "), 자른.rfind("습니다."))
    return (자른[: 끝 + 1] if 끝 > 최대 * 0.5 else 자른.rstrip() + "…")


def 카드만들기(자료: dict, 이름: str, 코드: str) -> list[dict]:
    """카드 목록을 만듭니다. 각 카드는 {갈피, 제목, 몸통html} 입니다."""
    카드 = []
    꼬리 = f"{이름}({코드})" if 코드 and 코드 != 이름 else 이름

    # ① 표지
    수 = 자료["수치"]
    칸들 = []
    if 수.get("종가"):
        칸들.append(("종가" + (f' ({수["기준일"]})' if 수.get("기준일") else ""), 수["종가"]))
    if 수.get("적정가"):
        칸들.append(("확률가중 적정가", 수["적정가"]))
    if 수.get("여력"):
        칸들.append(("종가 대비", 수["여력"]))
    띠 = ("".join(f'<div class="수칸"><div class="수이름">{_html.escape(ㄱ)}</div>'
                  f'<div class="수값">{_html.escape(ㄴ)}</div></div>' for ㄱ, ㄴ in 칸들))
    # 머리글이 따로 없는 요약본이 있습니다(제목이 「○○(코드) 분석보고서 요약」뿐).
    # 그때는 리드 첫 문장을 억지로 올리지 않습니다 — 문장 가운데가 잘려 더 나빠집니다.
    # 종목명을 제목으로 쓰고 아래 이름줄을 비웁니다.
    표지제목 = 자료["제목"] or ""
    벗긴 = re.sub(r"[()\s]", "", 표지제목)
    머리글없음 = (not 표지제목) or 벗긴 in re.sub(r"[()\s]", "", 꼬리) or len(표지제목) < 12
    if 머리글없음:
        표지제목 = 꼬리
    카드.append({
        "종류": "표지",
        "갈피": "기업분석 요약",
        "제목": 표지제목,
        "몸통": '<div class="표지아래">'
                + ("" if 머리글없음
                   else f'<div class="표지이름">{_html.escape(꼬리)}</div>')
                + (f'<div class="표지곁">{_html.escape(줄이기(자료["곁들임"], 160))}</div>'
                   if 자료["곁들임"] else "")
                + (f'<div class="수치띠">{띠}</div>' if 띠 else "")
                + "</div>",
    })

    # ①-2 차트 카드 — 표지 다음 장 (2026-10-05 사용자 지시)
    try:
        import 카드보탬
        차트 = 카드보탬.차트카드(코드)
        if 차트:
            카드.append(차트)
    except Exception as e:                                    # noqa: BLE001
        print(f"   차트 카드를 건너뜁니다: {e}")
        카드보탬 = None

    # ② 한 눈에 — 키워드를 먼저 세우고 설명을 붙입니다 (2026-10-05 사용자 지시).
    #    산문 한 문단은 눈에 잘 안 들어왔습니다. 정리에 실패하면 예전처럼 문단으로 둡니다.
    if 자료["리드"]:
        키워드 = 카드보탬.한눈에(자료["리드"]) if 카드보탬 else []
        몸 = ('<div class="키목록">' + "".join(
                f'<div class="키"><div class="키말">{_html.escape(ㄱ)}</div>'
                f'<div class="키설명">{_html.escape(ㄴ)}</div></div>' for ㄱ, ㄴ in 키워드) + "</div>"
              if 키워드 else f'<p class="큰글">{_html.escape(줄이기(자료["리드"], 420))}</p>')
        카드.append({"종류": "리드", "갈피": "한 눈에", "제목": "", "몸통": 몸})

    # ③ 절 — 「<b>투자포인트 1</b>은 ○○입니다. …」처럼 굵은 표지어로 시작하는 문단은
    #    표지어를 갈피, ○○를 소제목으로 올리고 나머지를 그 아래 문단으로 둡니다 (2026-10-05).
    #    전에는 소제목 없이 문장 속에 그대로 두어 투자포인트가 눈에 띄지 않았습니다.
    표설명 = []
    for 절 in 자료["절"]:
        남김 = []
        for 덩이 in 절["덩이"]:
            m = re.match(r"\s*<b>([^<]{2,24})</b>\s*(?:은|는|이|가)?\s*(.+)$", 덩이, re.S)
            if not m:
                남김.append(덩이); continue
            표지, 뒤 = m.group(1).strip(), m.group(2).strip()
            첫 = re.match(r"(.+?(?:입니다|이다|습니다|다)\.)\s*(.*)$", 뒤, re.S)
            제목 = 첫.group(1) if 첫 else ""
            제목 = re.sub(r"\s*(?:입니다|이다)\.$", "", 제목).strip()
            나머지 = (첫.group(2) if 첫 else 뒤).strip()
            if not 제목 or len(태그떼기(제목)) > 48:            # 소제목으로 쓰기에 길면 표지어만 제목으로
                제목, 나머지 = "", 뒤
            문장 = re.split(r"(?<=[다요]\.)\s+", 나머지) if 나머지 else []
            문단 = [" ".join(문장[i:i + 2]) for i in range(0, len(문장), 2)]
            카드.append({"종류": "논거", "갈피": 표지,
                         "제목": 태그떼기(제목),
                         "몸통": "".join(f"<p>{줄이기(x, 300)}</p>" for x in 문단[:3])})
        if 남김 != 절["덩이"]:
            # 표지어 없는 문단은 시나리오 표 아래 설명으로 붙이고, 표가 없으면 따로 한 장
            if 자료["표"]:
                표설명 += 남김
            elif 남김:
                카드.append({"종류": "절", "갈피": 절["이름"] or "짚을 것", "제목": "",
                             "몸통": "".join(f"<p>{줄이기(d, 300)}</p>" for d in 남김[:2])})
            continue

        이름절 = 절["이름"]
        if re.search(r"분수령|일정", 이름절):
            continue                                  # 일정은 뒤에서 따로 굽습니다
        if re.search(r"시나리오|밸류|적정", 이름절) and 자료["표"]:
            표설명 += 절["덩이"]                      # 설명 문단은 표 아래에 붙입니다
            continue                                  # 표로 굽습니다
        if re.search(r"논거|투자 포인트", 이름절):
            for i, 덩이 in enumerate(절["덩이"][:3], 1):
                머리 = 첫문장(덩이, 80)
                # 머리를 제목으로 올렸으니 본문에서는 뗍니다. 안 떼면 같은 문장이
                # 한 카드에 두 번 나옵니다(첫 시험에서 실제로 그랬습니다).
                남은 = 떼어내기(덩이, 머리)
                카드.append({"종류": "논거", "갈피": f"투자 논거 {i}",
                             "제목": 머리,
                             "몸통": f'<p>{줄이기(남은 or 덩이, 360)}</p>'})
        else:
            몸 = "".join(f"<p>{줄이기(d, 300)}</p>" for d in 절["덩이"][:2])
            if 몸:
                카드.append({"종류": "절", "갈피": 이름절 or "짚을 것",
                             "제목": "", "몸통": 몸})

    # ④ 시나리오 표
    if len(자료["표"]) >= 2:
        줄들 = "".join(
            "<tr>" + "".join(
                f'<{"th" if r == 0 else "td"}{f" colspan={n}" if n > 1 else ""}>'
                f'{c}</{"th" if r == 0 else "td"}>'
                for c, n in 칸) + "</tr>"
            for r, 칸 in enumerate(자료["표"][:6]))
        카드.append({"종류": "표", "갈피": "시나리오", "제목": "",
                     "몸통": f'<table class="카드표">{줄들}</table>'
                             + "".join(f'<p class="표설명">{줄이기(d, 220)}</p>' for d in 표설명[:2])})

    # ⑤ 일정
    if 자료["일정"] and not any(k["갈피"] == "다음 분수령" for k in 카드):   # 표지어 카드가 있으면 겹치지 않게
        항목 = "".join(f"<li>{줄이기(d, 150)}</li>" for d in 자료["일정"][:5])
        카드.append({"종류": "일정", "갈피": "다음 분수령", "제목": "",
                     "몸통": f'<ul class="카드목록">{항목}</ul>'})

    # ⑥ 맺음 카드는 2026-10-05 에 뺐습니다 — 홈페이지 안내는 메시지 설명에 이미 있습니다.
    return 다섯장으로(카드)


def 다섯장으로(카드: list[dict]) -> list[dict]:
    """5장 이내로 묶습니다 (2026-10-13 사용자 지시 — 9장은 너무 많았습니다).

    표지 · 차트 · 한눈에는 그대로 두고, 투자포인트 여러 장을 한 장에, 위험 · 분수령 ·
    나머지 절을 한 장에 모읍니다. 시나리오 표는 뺍니다 — 확률가중 적정가와 여력이
    표지 수치띠에 이미 있습니다. 넘치는 글씨는 틀의 자동 줄임이 맞춥니다.
    """
    if len(카드) <= 장수한도:
        return 카드
    앞 = [c for c in 카드 if c["종류"] in ("표지", "차트", "리드")]
    논거 = [c for c in 카드 if c["종류"] == "논거" and re.match(r"투자\s*(?:포인트|논거)", c["갈피"])]
    나머지 = [c for c in 카드 if c not in 앞 and c not in 논거 and c["종류"] != "표"]

    def 묶기(갈피: str, 묶을것: list[dict]) -> dict:
        블록 = []
        for c in 묶을것:
            말 = f'{c["갈피"]} · {c["제목"]}' if c["제목"] else c["갈피"]
            첫 = re.search(r"<p[^>]*>(.*?)</p>", c["몸통"], re.S)
            설명 = 첫.group(1) if 첫 else ""
            if c["종류"] == "일정":                         # 목록은 앞 두 줄만 이어 씁니다
                설명 = " · ".join(re.findall(r"<li>(.*?)</li>", c["몸통"], re.S)[:2])
            블록.append(f'<div class="키"><div class="키말">{_html.escape(말)}</div>'
                        f'<div class="키설명">{줄이기(설명, 200)}</div></div>')
        return {"종류": "묶음", "갈피": 갈피, "제목": "",
                "몸통": '<div class="키목록">' + "".join(블록) + "</div>"}

    뒤 = []
    if 논거:
        뒤.append(묶기("투자포인트", 논거) if len(논거) > 1 else 논거[0])
    if 나머지:
        뒤.append(묶기("위험 · 분수령", 나머지) if len(나머지) > 1 else 나머지[0])
    return (앞 + 뒤)[:장수한도]


틀 = """<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:%(폭)dpx;background:#f4f2ed;
  font-family:"Noto Sans CJK KR","Noto Sans KR","Apple SD Gothic Neo",sans-serif;
  word-break:keep-all;-webkit-font-smoothing:antialiased}
.카드{width:%(폭)dpx;height:%(높이)dpx;background:#fffefb;position:relative;
  display:flex;flex-direction:column;padding:78px 76px 96px;overflow:hidden}
.갈피{font-size:30px;font-weight:700;color:#c2410c;letter-spacing:-.01em;margin-bottom:26px}
.갈피::after{content:"";display:block;width:62px;height:5px;background:#c2410c;margin-top:16px}
.제목{font-size:62px;font-weight:800;line-height:1.26;letter-spacing:-.035em;color:#121212;
  margin-bottom:30px}
.몸{flex:1;display:flex;flex-direction:column;justify-content:flex-start;
  font-size:37px;line-height:1.68;letter-spacing:-.022em;color:#2c2a26;overflow:hidden}
.몸.가운데{justify-content:center}
.몸>*:last-child{margin-bottom:0}
.몸 p{margin-bottom:24px}
.몸 b{font-weight:800;color:#0b0b0b}
.큰글{font-size:41px;line-height:1.62}
.쪽{position:absolute;left:76px;bottom:46px;font-size:25px;color:#8c877d;
  font-variant-numeric:tabular-nums}
.꼬리{position:absolute;right:76px;bottom:46px;font-size:25px;color:#8c877d;font-weight:600}
/* 표지 */
.카드.표지{background:#141311;padding-top:120px}
.표지 .갈피{color:#f0a868}.표지 .갈피::after{background:#f0a868}
.표지 .제목{font-size:76px;color:#fffefb;margin-top:14px}
.표지 .몸{color:#cfc9bd}
.표지 .몸{justify-content:flex-end}
.표지아래{width:100%%}
.표지이름{font-size:44px;font-weight:700;color:#fffefb;
  padding-top:34px;border-top:3px solid #45413a}
.표지곁{font-size:28px;line-height:1.55;color:#a39d91;margin-top:14px}
.수치띠{display:flex;gap:18px;margin-top:40px}
.수칸{flex:1;background:#201e1b;border-radius:14px;padding:26px 22px}
.수이름{font-size:23px;color:#a39d91;margin-bottom:12px;line-height:1.35}
.수값{font-size:42px;font-weight:800;color:#f0a868;letter-spacing:-.03em;
  font-variant-numeric:tabular-nums}
.표지 .쪽,.표지 .꼬리{color:#7d786e}
/* 표 */
.카드표{width:100%%;border-collapse:collapse;font-size:33px;
  font-variant-numeric:tabular-nums;margin-top:6px}
.카드표 th{background:#141311;color:#fffefb;padding:18px 12px;font-weight:700;font-size:30px}
.카드표 td{padding:19px 12px;border-bottom:2px solid #e8e4da;text-align:center}
.카드표 tr:last-child td{background:#fdf3e8;font-weight:800;border-bottom:none}
/* 목록 */
.카드목록{list-style:none}
.카드목록 li{position:relative;padding-left:40px;margin-bottom:26px;font-size:34px;line-height:1.56}
.카드목록 li::before{content:"";position:absolute;left:4px;top:18px;width:14px;height:14px;
  background:#c2410c;border-radius:50%%}
/* 차트 카드 (2026-10-05) */
.카드.차트{padding:64px 60px 90px}
.차트그림{width:100%%;border-radius:12px;border:2px solid #ece7de;margin-bottom:22px}
.지표{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.지칸{background:#f5f1e8;border-radius:12px;padding:16px 14px}
.지이름{font-size:22px;color:#8c877d;margin-bottom:6px}
.지값{font-size:30px;font-weight:800;color:#141311;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.지값.up{color:#e0333a}.지값.dn{color:#2f6fd6}
.상태상자{display:inline-block;border-radius:10px;padding:4px 14px;font-size:28px;font-weight:800}
.지기준{font-size:21px;color:#8c877d;margin-top:14px}
/* 한눈에 — 키워드 먼저 */
.키{margin-bottom:34px;padding-left:22px;border-left:7px solid #c2410c}
.키말{font-size:42px;font-weight:800;color:#121212;letter-spacing:-.03em;margin-bottom:8px}
.키설명{font-size:33px;line-height:1.55;color:#3a3732}
.표설명{font-size:28px;line-height:1.6;color:#55514a;margin-top:26px}
/* 맺음 */
.맺음{font-size:36px;line-height:1.66;margin-bottom:28px}
.맺음작게{font-size:28px;line-height:1.6;color:#6e6a62}
.맺음주소{margin-top:auto;font-size:34px;font-weight:800;color:#c2410c}
</style></head><body>
<div class="카드 %(종류)s">
  %(갈피)s
  %(제목)s
  <div class="몸%(가운데)s" id="몸">%(몸통)s</div>
  <div class="쪽">%(쪽)s</div>
  <div class="꼬리">%(꼬리)s</div>
</div>
<script>
/* 카드마다 글 길이가 달라서 넘칠 수 있습니다. 넘치면 넘치지 않을 때까지 줄입니다.
   — 글을 더 자르는 쪽보다 글자를 줄이는 쪽이 낫습니다. 뜻이 잘리지 않으니까요. */
(function(){
  var 몸=document.getElementById('몸'), 배=1.0;
  if(document.querySelector('.표지')){/* 표지는 띠가 있어 줄임 대상이 아닙니다 */}
  for(var i=0;i<28 && 몸.scrollHeight>몸.clientHeight+2;i++){
    배-=0.035;
    몸.style.fontSize=(37*배)+'px';
    몸.querySelectorAll('.큰글').forEach(function(e){e.style.fontSize=(41*배)+'px'});
    몸.querySelectorAll('.카드표').forEach(function(e){e.style.fontSize=(33*배)+'px'});
    몸.querySelectorAll('.카드목록 li').forEach(function(e){e.style.fontSize=(34*배)+'px'});
    몸.querySelectorAll('.키말').forEach(function(e){e.style.fontSize=(42*배)+'px'});
    몸.querySelectorAll('.키설명').forEach(function(e){e.style.fontSize=(33*배)+'px'});
  }
  /* 제목도 길면 줄입니다 */
  var 제=document.querySelector('.제목');
  if(제){var ㅂ=1.0, 기=parseFloat(getComputedStyle(제).fontSize);
    for(var j=0;j<14 && 제.getBoundingClientRect().height>420;j++){ㅂ-=0.05;제.style.fontSize=(기*ㅂ)+'px';}}
})();
</script></body></html>"""


def 굽기(카드들: list[dict], 낼곳: Path, 꼬리: str) -> list[Path]:
    낼곳.mkdir(parents=True, exist_ok=True)
    for 옛것 in 낼곳.glob("카드_*.png"):
        try:
            옛것.unlink()
        except OSError:
            pass

    html들 = []
    for i, c in enumerate(카드들, 1):
        html들.append(틀 % {
            "폭": 카드폭, "높이": 카드높이, "종류": c["종류"],
            "갈피": f'<div class="갈피">{_html.escape(c["갈피"])}</div>' if c["갈피"] else "",
            "제목": f'<div class="제목">{_html.escape(c["제목"])}</div>' if c["제목"] else "",
            "몸통": c["몸통"],
            "가운데": "" if c["제목"] else " 가운데",
            "쪽": f"{i} / {len(카드들)}",
            "꼬리": _html.escape(꼬리),
        })

    낸것 = _플레이라이트(html들, 낼곳) or _크롬(html들, 낼곳)
    if not 낸것:
        raise SystemExit("카드를 그리지 못했습니다. playwright 나 크롬이 필요합니다.")
    return 낸것


def _플레이라이트(html들: list[str], 낼곳: Path) -> list[Path] | None:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        return None
    낸것 = []
    try:
        with sync_playwright() as p:
            브 = p.chromium.launch()
            쪽 = 브.new_page(viewport={"width": 카드폭, "height": 카드높이},
                            device_scale_factor=1)
            for i, h in enumerate(html들, 1):
                쪽.set_content(h, wait_until="load")
                길 = 낼곳 / f"카드_{i:02d}.png"
                쪽.locator(".카드").screenshot(path=str(길))
                낸것.append(길)
            브.close()
        return 낸것
    except Exception as e:                                    # noqa: BLE001
        print(f"   playwright 실패: {e} — 크롬으로 넘어갑니다")
        return None


def _크롬(html들: list[str], 낼곳: Path) -> list[Path] | None:
    후보 = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            "google-chrome", "chromium"]
    exe = next((c for c in 후보 if Path(c).exists() or shutil.which(c)), None)
    if not exe:
        return None
    exe = exe if Path(exe).exists() else shutil.which(exe)
    낸것 = []
    with tempfile.TemporaryDirectory() as tmp:
        for i, h in enumerate(html들, 1):
            원본 = Path(tmp) / f"c{i}.html"
            원본.write_text(h, encoding="utf-8")
            길 = 낼곳 / f"카드_{i:02d}.png"
            subprocess.run([exe, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                            f"--user-data-dir={tmp}/u", f"--window-size={카드폭},{카드높이}",
                            f"--screenshot={길.resolve()}", 원본.resolve().as_uri()],
                           check=False, timeout=120,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if 길.exists():
                낸것.append(길)
    return 낸것 or None


# ────────────────────────────────────────────────────────────
#  3. 보내기
# ────────────────────────────────────────────────────────────
def 열쇠읽기() -> tuple[str, str]:
    #  카드뉴스는 **CARDNEWS_** 열쇠만 읽습니다 (2026-10-03). `TELEGRAM_*` 는 `알림.sh`·
    #  `코덱스보고.sh` 의 제작 알림 몫이라, 같은 값을 쓰면 알림이 독자 채널로 새어 나갑니다.
    #  열쇠는 `./텔레그램채널찾기.sh --카드 <봇토큰>` 이 적습니다.
    토큰 = os.environ.get("CARDNEWS_TELEGRAM_BOT_TOKEN", "").strip()
    방 = os.environ.get("CARDNEWS_TELEGRAM_CHAT_ID", "").strip()
    env = 뿌리 / ".env"
    if env.exists() and (not 토큰 or not 방):
        글 = env.read_text(encoding="utf-8", errors="ignore")
        for 열쇠, 이름 in (("CARDNEWS_TELEGRAM_BOT_TOKEN", "토큰"), ("CARDNEWS_TELEGRAM_CHAT_ID", "방")):
            m = re.search(rf"^[ \t]*{열쇠}=(.+)$", 글, re.M)   # 주석(#) 줄은 안 읽습니다
            if m:
                값 = m.group(1).strip().strip('"').strip("'")
                if 이름 == "토큰" and not 토큰:
                    토큰 = 값
                elif 이름 == "방" and not 방:
                    방 = 값
    return 토큰, 방


def 설명짜기(자료: dict, 이름: str, 코드: str) -> str:
    꼬리 = f"{이름}({코드})" if 코드 and 코드 != 이름 else 이름
    줄 = [f"📊 <b>{_html.escape(꼬리)}</b> — {_html.escape(자료['제목'])}"]
    if 자료["곁들임"]:
        줄 += ["", f"<i>{_html.escape(줄이기(자료['곁들임'], 150))}</i>"]
    if 자료["리드"]:
        줄 += ["", _html.escape(줄이기(자료["리드"], 420))]
    # 맨 끝은 주소와 탭 이름만 (2026-10-05 사용자 지시)
    줄 += ["", "tradingmanagerkr.com 「리포트」"]
    글 = "\n".join(줄)
    return 글 if len(글) <= 설명한도 else 글[: 설명한도 - 2] + "…"


def 보내기(사진들: list[Path], 설명: str, 토큰: str, 방: str) -> None:
    """sendMediaGroup — 사진 여러 장을 한 묶음으로. 설명은 첫 장에만 붙습니다."""
    # 경계는 HTTP 머리말에 들어가므로 ASCII 만 씁니다 (2026-10-04 — 한글을 넣어 첫 발송이 죽었습니다)
    경계 = "----tm26card" + os.urandom(8).hex()
    묶음 = []
    몸 = b""
    for i, 길 in enumerate(사진들):
        이름 = f"사진{i}"
        # 설명 글은 붙이지 않습니다 — 카드만 나갑니다 (2026-10-13 사용자 지시)
        묶음.append({"type": "photo", "media": f"attach://{이름}"})
        몸 += (f"--{경계}\r\nContent-Disposition: form-data; name=\"{이름}\"; "
               f"filename=\"card_{i+1:02d}.png\"\r\nContent-Type: image/png\r\n\r\n").encode()
        몸 += 길.read_bytes() + b"\r\n"
    for 열쇠, 값 in (("chat_id", 방), ("media", json.dumps(묶음, ensure_ascii=False))):
        몸 += (f"--{경계}\r\nContent-Disposition: form-data; name=\"{열쇠}\"\r\n\r\n"
               f"{값}\r\n").encode()
    몸 += f"--{경계}--\r\n".encode()

    청 = urllib.request.Request(
        f"https://api.telegram.org/bot{토큰}/sendMediaGroup", data=몸,
        headers={"Content-Type": f"multipart/form-data; boundary={경계}"})
    # 아침 일괄 발송(2026-10-13)은 앨범 여러 개를 잇달아 보내 429 를 맞을 수 있습니다 — 기다렸다 다시
    #  2026-10-16 — 여기에 `import time, urllib.error` 를 두었더니 함수 안에서 urllib 가 지역 이름이 되어
    #  위의 urllib.request.Request 가 UnboundLocalError 로 죽었습니다. 10/14~16 아침 발송이 전부 실패. 맨 위로 옮겼습니다.
    for 번 in range(3):
        try:
            with urllib.request.urlopen(청, timeout=180) as r:
                답 = json.loads(r.read().decode())
            break
        except urllib.error.HTTPError as e:
            if e.code != 429 or 번 == 2:
                raise
            쉼 = json.loads(e.read().decode() or "{}").get("parameters", {}).get("retry_after", 30)
            print(f"   429 — {쉼}초 기다렸다 다시 보냅니다")
            time.sleep(int(쉼) + 2)
    if not 답.get("ok"):
        raise SystemExit(f"텔레그램이 거절했습니다: {답.get('description')}")


# ────────────────────────────────────────────────────────────
def 한건(경로: Path, 보낼까: bool, 대상: str | None) -> None:
    자료 = 읽기(경로)
    이름, 코드 = 종목이름(경로, 경로.read_text(encoding="utf-8", errors="ignore"))
    카드들 = 카드만들기(자료, 이름, 코드)
    꼬리 = f"{이름}({코드})" if 코드 and 코드 != 이름 else 이름
    낼곳 = 경로.parent / "카드"
    print(f"▶ {꼬리} — 카드 {len(카드들)}장")
    for i, c in enumerate(카드들, 1):
        print(f"   {i:>2}. [{c['갈피'] or c['종류']}] {c['제목'][:46]}")
    사진들 = 굽기(카드들, 낼곳, 꼬리)
    print(f"   구웠습니다 → {낼곳}  ({len(사진들)}장)")

    설명 = 설명짜기(자료, 이름, 코드)
    if not 보낼까:
        print("   (설명 글 없이 카드만 나갑니다 · --보내기 를 주지 않아 보내지 않았습니다)")
        return

    토큰, 방 = 열쇠읽기()
    방 = 대상 or 방
    if not 토큰:
        raise SystemExit("봇 토큰이 없습니다 — ./텔레그램채널찾기.sh --카드 <봇토큰> 을 돌리십시오.")
    if not 방:
        raise SystemExit("보낼 방이 없습니다 — --대상 <chat_id> 나 CARDNEWS_TELEGRAM_CHAT_ID 가 필요합니다.")
    보내기(사진들, 설명, 토큰, 방)
    print(f"   ✔ 보냈습니다 — 사진 {len(사진들)}장")


def main() -> None:
    ㅍ = argparse.ArgumentParser(description="요약본을 텔레그램 카드뉴스로")
    ㅍ.add_argument("요약본", nargs="*", help="요약_*.html 경로")
    ㅍ.add_argument("--최신", type=int, metavar="N", help="가장 최근 요약본 N 건을 자동으로 고릅니다")
    ㅍ.add_argument("--보내기", action="store_true", help="실제로 텔레그램에 보냅니다")
    ㅍ.add_argument("--확인", action="store_true", help="굽기만 하고 보내지 않습니다(기본)")
    ㅍ.add_argument("--대상", metavar="chat_id", help="TELEGRAM_CHAT_ID 대신 이 방으로")
    ㄱ = ㅍ.parse_args()

    경로들 = [Path(p) for p in ㄱ.요약본]
    if ㄱ.최신:
        후보 = sorted((뿌리 / "out").glob("*/요약_*.html"),
                      key=lambda p: p.stat().st_mtime, reverse=True)
        후보 = [p for p in 후보 if "수정전" not in p.name]
        경로들 += 후보[: ㄱ.최신]
    if not 경로들:
        ㅍ.error("요약본 경로나 --최신 N 이 필요합니다.")

    for p in 경로들:
        if not p.exists():
            print(f"✗ 없는 파일입니다: {p}", file=sys.stderr)
            continue
        한건(p, ㄱ.보내기 and not ㄱ.확인, ㄱ.대상)


if __name__ == "__main__":
    main()
