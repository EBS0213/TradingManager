#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""증권사 계정 넣는 창 (2026-10-03)

  /usr/bin/python3 증권사계정.py          창을 띄웁니다
  /usr/bin/python3 증권사계정.py --확인    무엇이 들어 있는지만 찍습니다

왜 이 일곱 곳인가
  네이버 금융에 리포트를 내는 증권사는 로그인이 필요 없습니다 — 1년치 10,900건을
  훑어 확인했습니다(하나·키움·미래에셋·대신·유진·유안타·SK·한화·iM·교보·IBK·DS·삼성 등).
  계정이 필요한 곳은 아래 둘뿐입니다.

    ① 네이버에 아예 리포트를 안 내는 곳      NH · KB · LS · 신영 · BNK
    ② 네이버에 있어도 PDF 가 안 딸려 오는 곳  한국투자증권
                                       신한투자증권(가끔 자기 홈페이지로 넘깁니다)

  신한은 표본 세 건이 전부 PDF 로 받아졌지만, 홈페이지를 경유하게 해 둔 건이
  섞여 있다는 사용자 확인이 있어 넣었습니다.

  ★ 2026-10-04 에 한 곳씩 확인한 결과 (자세한 것은 `증권사리포트받기.py` 머리말)
    KB·BNK 는 **계정 없이** 목록·PDF 가 열려 있어 `증권사리포트받기.py` 가 받습니다.
    NH·LS·한국투자는 로그인이 보안모듈(ASTx2·IPinside)을 거쳐 아이디·비밀번호만으로는
    무인 수집이 안 됩니다. 계정은 사람이 브라우저로 받을 때 쓰는 자리로 남겨 둡니다.

비밀번호를 어디에 두는가
  **맥 키체인**입니다. 이 폴더의 어떤 파일에도 적지 않습니다.
  지금 한국투자 오픈API 키와 와이즈리포트 계정을 다루는 방식과 같습니다
  (`security add-generic-password`). 한 곳에 `{"id": …, "pw": …}` 한 벌씩 들어갑니다.

  ※ 이 창은 **저장만** 합니다. 저장한 비밀번호를 다시 보여주지 않습니다 —
    들어 있는지 여부만 표시합니다. 바꾸려면 새로 넣으면 덮어씁니다.

왜 Tk 인가
  Homebrew `python3.12`(Tk 9.0) 로 부르십시오. `/usr/bin/python3` 의 Tk 8.5.9 는
  macOS 26 에서 창 안을 그리지 못합니다(하얀 창).
  **`.venv` 파이썬에는 없습니다** — 바탕화면 앱이 알아서 고릅니다.
"""
from __future__ import annotations
import json
import subprocess
import sys

서비스틀 = "tm26-broker-{키}"

증권사 = [
    #  네이버는 **지금은 계정이 필요 없습니다.** 2026-10-03 에 리포트 191건을
    #  로그인 없이 받았습니다(`네이버리포트받기.py`). 그래도 칸을 둔 까닭은,
    #  네이버가 나중에 로그인을 요구하도록 바꾸면 그날 코드를 고치지 않고
    #  여기에 넣기만 하면 되게 하려는 것입니다. 비워 두셔도 아무 지장 없습니다.
    ("naver", "네이버 (지금은 불필요)", "로그인 없이 받힘"),
    ("shinhan", "신한투자증권", "네이버로 받힘"),
    ("truefriend", "한국투자증권", "IPinside 필요·자동 불가"),
    ("nh", "NH투자증권", "ASTx2 보안·자동 불가"),
    ("kb", "KB증권", "계정 불필요(공개)"),
    ("ls", "LS증권", "ASTx2 보안·자동 불가"),
    ("shinyoung", "신영증권", "휴대폰 인증·받지 않음"),
    ("bnk", "BNK투자증권", "계정 불필요(공개)"),
]


def 읽기(키: str):
    """키체인에서 {"id":…, "pw":…} 를 꺼냅니다. 없으면 None."""
    try:
        r = subprocess.run(["security", "find-generic-password",
                            "-s", 서비스틀.format(키=키), "-a", 키, "-w"],
                           capture_output=True, text=True, timeout=20)
    except Exception:
        return None
    if r.returncode != 0:
        return None
    try:
        d = json.loads(r.stdout.strip())
        return d if d.get("id") else None
    except Exception:
        return None


def 쓰기(키: str, 아이디: str, 비번: str) -> bool:
    값 = json.dumps({"id": 아이디, "pw": 비번}, ensure_ascii=False)
    try:
        r = subprocess.run(["security", "add-generic-password", "-U",
                            "-s", 서비스틀.format(키=키), "-a", 키,
                            "-w", 값], capture_output=True, text=True, timeout=20)
        return r.returncode == 0
    except Exception:
        return False


def 지우기(키: str) -> bool:
    try:
        r = subprocess.run(["security", "delete-generic-password",
                            "-s", 서비스틀.format(키=키), "-a", 키],
                           capture_output=True, text=True, timeout=20)
        return r.returncode == 0
    except Exception:
        return False


def 확인만() -> int:
    print("증권사 계정 (맥 키체인)")
    for 키, 이름, 까닭 in 증권사:
        d = 읽기(키)
        본 = f"{d['id']}  (비밀번호 {len(d.get('pw') or '')}자)" if d else "— 없음"
        print(f"  {이름:<12} {본:<34} {까닭}")
    return 0


def 창():
    """계정 넣는 창.

    **ttk 로 그립니다.** tkinter 기본 위젯은 맥 다크 모드에서 글씨가 안 보입니다 —
    Label 이 `bg=White · fg=systemButtonText(다크에선 흰색)` 이라 흰 바탕에 흰 글씨가
    되고, Entry 는 `bg=systemWindowBody(어두움) · fg=Black` 이라 검은 글씨가 묻힙니다.
    Button 만 네이티브로 그려져 멀쩡했고, 그래서 2026-10-03 첫 판이 「단추만 보이고
    가운데가 백지」였습니다. ttk 는 시스템 테마를 따라가 밝은·어두운 양쪽에서 보입니다.
    """
    import tkinter as tk
    from tkinter import ttk, font as tkfont, messagebox

    뿌리 = tk.Tk()
    뿌리.title("증권사 계정 넣기 — TM2026")

    있는것 = set(tkfont.families())
    한글 = next((x for x in ("Apple SD Gothic Neo", "AppleGothic", "Helvetica")
                if x in 있는것), None)
    기본 = tkfont.Font(family=한글, size=13) if 한글 else tkfont.Font(size=13)
    작게 = tkfont.Font(family=한글, size=11) if 한글 else tkfont.Font(size=11)
    굵게 = (tkfont.Font(family=한글, size=14, weight="bold") if 한글
           else tkfont.Font(size=14, weight="bold"))

    style = ttk.Style(뿌리)
    style.configure("머리.TLabel", font=굵게)
    style.configure("설명.TLabel", font=작게)
    style.configure("이름.TLabel", font=기본)
    style.configure("까닭.TLabel", font=작게)
    style.configure("있음.TLabel", font=작게, foreground="#1d6b34")
    style.configure("없음.TLabel", font=작게, foreground="#888888")
    style.configure("경고.TLabel", font=작게, foreground="#a05000")

    바깥 = ttk.Frame(뿌리, padding=(18, 16))
    바깥.pack(fill="both", expand=True)

    ttk.Label(바깥, text="증권사 리포트를 받아 올 계정",
              style="머리.TLabel").pack(anchor="w")
    ttk.Label(바깥, style="설명.TLabel", justify="left",
              text="비밀번호는 맥 키체인에 들어갑니다. 이 폴더의 파일에는 적지 않습니다.\n"
                   "아이디와 비밀번호를 함께 채운 줄만 저장됩니다. 빈 줄은 건드리지 않습니다."
                   ).pack(anchor="w", pady=(4, 14))

    표 = ttk.Frame(바깥)
    표.pack(fill="both", expand=True)
    for j, 제목 in enumerate(("증권사", "", "아이디", "비밀번호", "상태")):
        if 제목:
            ttk.Label(표, text=제목, style="까닭.TLabel").grid(
                row=0, column=j, sticky="w", padx=(0, 8), pady=(0, 4))

    칸들 = {}
    for i, (키, 이름, 까닭) in enumerate(증권사, start=1):
        ttk.Label(표, text=이름, style="이름.TLabel", width=18).grid(
            row=i, column=0, sticky="w", pady=3)
        ttk.Label(표, text=까닭, style="까닭.TLabel", width=18).grid(
            row=i, column=1, sticky="w", padx=(0, 10))
        아이디 = ttk.Entry(표, font=기본, width=16)
        아이디.grid(row=i, column=2, padx=3)
        비번 = ttk.Entry(표, font=기본, width=16, show="\u2022")
        비번.grid(row=i, column=3, padx=3)
        상태 = ttk.Label(표, text="", style="없음.TLabel", width=18)
        상태.grid(row=i, column=4, sticky="w", padx=(10, 0))
        칸들[키] = (아이디, 비번, 상태)

    def 새로그리기():
        for 키, _, _ in 증권사:
            아이디, 비번, 상태 = 칸들[키]
            d = 읽기(키)
            if d:
                상태.configure(text=f"저장됨 · {d['id'][:12]}", style="있음.TLabel")
                if not 아이디.get():
                    아이디.insert(0, d["id"])
            else:
                상태.configure(text="없음", style="없음.TLabel")
            비번.delete(0, "end")

    def 저장하기():
        둔것, 못한것 = [], []
        for 키, 이름, _ in 증권사:
            아이디, 비번, _ = 칸들[키]
            i, p = 아이디.get().strip(), 비번.get()
            if not i or not p:
                continue
            (둔것 if 쓰기(키, i, p) else 못한것).append(이름)
        새로그리기()
        if 둔것 or 못한것:
            messagebox.showinfo("저장", ((f"넣었습니다: {', '.join(둔것)}\n" if 둔것 else "")
                                      + (f"실패: {', '.join(못한것)}" if 못한것 else "")).strip())
        else:
            messagebox.showinfo("저장", "아이디와 비밀번호를 함께 채운 곳이 없습니다.")

    def 지우기누름():
        지운것 = [이름 for 키, 이름, _ in 증권사
                if 칸들[키][0].get().strip() and not 칸들[키][1].get()
                and 읽기(키) and 지우기(키)]
        새로그리기()
        messagebox.showinfo("지우기", ("지웠습니다: " + ", ".join(지운것)) if 지운것
                            else "지울 곳의 비밀번호 칸을 비운 채 아이디만 두고 누르십시오.")

    단추 = ttk.Frame(바깥)
    단추.pack(fill="x", pady=(16, 0))
    ttk.Button(단추, text="저장", command=저장하기).pack(side="left")
    ttk.Button(단추, text="지우기", command=지우기누름).pack(side="left", padx=6)
    ttk.Button(단추, text="닫기", command=뿌리.destroy).pack(side="right")

    ttk.Label(바깥, style="경고.TLabel", justify="left",
              text="※ 2단계 인증·공인인증서·캡차를 쓰는 곳은 아이디·비밀번호만으로\n"
                   "   자동 수집이 안 될 수 있습니다. 넣으신 뒤 한 곳씩 시험해 보겠습니다."
              ).pack(anchor="w", pady=(12, 0))

    새로그리기()
    뿌리.update_idletasks()
    뿌리.minsize(뿌리.winfo_reqwidth(), 뿌리.winfo_reqheight())
    뿌리.lift()
    뿌리.attributes("-topmost", True)
    뿌리.after(300, lambda: 뿌리.attributes("-topmost", False))
    뿌리.mainloop()
    return 0


if __name__ == "__main__":
    sys.exit(확인만() if "--확인" in sys.argv[1:] else 창())
