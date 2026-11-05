#!/usr/bin/env python3
"""TM26 의 목록 창. 고른 줄을 그대로 찍는다.

  /usr/bin/python3 고르기.py --제목 "TM26" --안내 "설명" --버튼 "실행" [--다중]
  (고를 것들은 줄 단위로 표준입력으로 넣는다)

닫히면(닫기 단추·빨간 단추·Esc) 아무것도 찍지 않고 1 로 끝난다.

왜 이렇게 만들었나 (2026-09-05)
  전에는 애플스크립트의 `choose from list` 를 썼는데, 그 창은 **빨간 닫기 단추와
  노란 최소화 단추가 잠겨** 있습니다(운영체제가 그렇게 만듭니다). 창을 마음대로
  닫지 못한다는 말씀이 있어, 세 단추가 다 살아 있는 보통 창으로 바꿨습니다.
  Tk 는 맥에 딸려 오는 /usr/bin/python3 에 들어 있습니다 (.venv 파이썬에는 없습니다).
"""
import sys

def main() -> int:
    제목, 안내, 버튼, 다중 = "TM26", "", "실행", False
    인자 = sys.argv[1:]
    i = 0
    while i < len(인자):
        a = 인자[i]
        if a == "--제목" and i + 1 < len(인자): 제목 = 인자[i + 1]; i += 2; continue
        if a == "--안내" and i + 1 < len(인자): 안내 = 인자[i + 1]; i += 2; continue
        if a == "--버튼" and i + 1 < len(인자): 버튼 = 인자[i + 1]; i += 2; continue
        if a == "--다중": 다중 = True; i += 1; continue
        if a == "--점검": 다중 = 다중; i += 1; continue
        i += 1

    항목 = [x.rstrip("\n") for x in sys.stdin.read().split("\n") if x.strip()]
    if not 항목:
        return 1

    import tkinter as tk
    from tkinter import font as tkfont

    고른것 = []
    창 = tk.Tk()
    창.title(제목)
    # 세 단추가 다 살아 있는 보통 창입니다 (닫기·최소화·최대화)
    창.protocol("WM_DELETE_WINDOW", lambda: (고른것.clear(), 창.destroy()))

    # 글꼴 이름은 **화면에 실제로 있는 것**으로 골라야 합니다 (2026-09-06).
    #  "AppleSDGothicNeo-Regular" 는 없는 이름이라 조용히 기본 글꼴로 떨어졌습니다.
    #  맞는 이름은 "Apple SD Gothic Neo" 입니다.
    있는것 = set(tkfont.families())
    한글 = next((x for x in ("Apple SD Gothic Neo", "AppleGothic", "Helvetica")
                if x in 있는것), None)
    글꼴 = tkfont.Font(family=한글, size=13) if 한글 else tkfont.Font(size=13)
    작은글꼴 = tkfont.Font(family=한글, size=11) if 한글 else tkfont.Font(size=11)

    바깥 = tk.Frame(창, padx=14, pady=12)
    바깥.pack(fill="both", expand=True)

    if 안내:
        tk.Label(바깥, text=안내, justify="left", anchor="w", font=작은글꼴,
                 wraplength=560, fg="#333").pack(fill="x", pady=(0, 8))

    통 = tk.Frame(바깥)
    통.pack(fill="both", expand=True)
    막대 = tk.Scrollbar(통)
    막대.pack(side="right", fill="y")
    목록 = tk.Listbox(통, font=글꼴, activestyle="none", height=min(20, max(6, len(항목))),
                    selectmode="extended" if 다중 else "browse",
                    yscrollcommand=막대.set, highlightthickness=0, bd=1, relief="solid")
    for x in 항목:
        목록.insert("end", x)
    목록.pack(side="left", fill="both", expand=True)
    막대.config(command=목록.yview)

    # 첫 줄이 구분선(─────)이면 고를 수 없게 하지는 않고, 그냥 넘어가게 둡니다.
    처음 = 0
    while 처음 < len(항목) and set(항목[처음].strip()) <= {"─", "-", " "}:
        처음 += 1
    if 처음 < len(항목):
        목록.selection_set(처음)
        목록.activate(처음)
    목록.focus_set()

    def 확인(*_):
        고른것.clear()
        for i in 목록.curselection():
            줄 = 항목[i]
            if set(줄.strip()) <= {"─", "-", " "}:      # 구분선은 고른 것으로 치지 않습니다
                continue
            고른것.append(줄)
        창.destroy()

    def 닫기(*_):
        고른것.clear()
        창.destroy()

    단추칸 = tk.Frame(바깥)
    단추칸.pack(fill="x", pady=(10, 0))
    tk.Button(단추칸, text="닫기", command=닫기, width=8).pack(side="right", padx=(8, 0))
    tk.Button(단추칸, text=버튼, command=확인, width=10, default="active").pack(side="right")

    목록.bind("<Double-Button-1>", 확인)
    창.bind("<Return>", 확인)
    창.bind("<KP_Enter>", 확인)
    창.bind("<Escape>", 닫기)

    # 창을 화면 가운데에, 그리고 맨 앞으로
    창.update_idletasks()
    너비 = max(520, min(760, 창.winfo_reqwidth()))
    높이 = min(720, max(300, 창.winfo_reqheight()))
    x = (창.winfo_screenwidth() - 너비) // 2
    y = max(60, (창.winfo_screenheight() - 높이) // 3)
    창.geometry(f"{너비}x{높이}+{x}+{y}")
    창.minsize(420, 260)
    창.lift()
    창.attributes("-topmost", True)
    창.after(400, lambda: 창.attributes("-topmost", False))
    try:
        # 다른 앱 뒤에 숨지 않게 맨 앞으로 끌어옵니다
        import subprocess
        subprocess.run(["osascript", "-e",
                        'tell application "System Events" to set frontmost of '
                        'the first process whose unix id is ' + str(__import__("os").getpid())
                        + ' to true'], capture_output=True, timeout=5)
    except Exception:
        pass

    if "--점검" in sys.argv:
        창.after(700, 닫기)          # 화면만 만들어 보고 끝냅니다 (시험용)

    창.mainloop()

    if not 고른것:
        return 1
    for x in 고른것:
        print(x)
    return 0


if __name__ == "__main__":
    sys.exit(main())
