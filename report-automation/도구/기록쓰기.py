#!/usr/bin/env python3
"""전략·심리 기록 창. 오늘 적은 것을 열어 고치고 저장한다.

  /usr/bin/python3 도구/기록쓰기.py [YYYY-MM-DD]

· 저장하는 곳 — 브리핑/<날짜>/전략심리기록_<날짜>.txt
· 장전 브리핑을 아직 안 만들었어도 바로 적을 수 있습니다. 먼저 적어 두면
  그날 매매평가가 이 기록을 실제 매매와 대조합니다.
· 세 가지 물음은 **참고로만** 적어 둡니다. 답을 꼭 그 자리에 쓰실 필요는 없고,
  하고 싶은 말을 그냥 쓰셔도 됩니다.
"""
import datetime
import pathlib
import sys

뿌리 = pathlib.Path(__file__).resolve().parent.parent

밑글 = """[전략]
· 오늘 반드시 지킬 것 하나는? 무엇을 보면 지켰다고 판정할 것인가?


· 오늘 할 일은 정확히 무엇인가? (없으면 '없음')


[심리]
· 오늘 가장 하기 쉬운 실수는 무엇이고, 그게 나오는 순간은 언제인가?


· 지금 마음 상태 (조급함 / 아쉬움 / 자신감 / 두려움 …)


[관심 종목 · 충동 기록]
· 사고 싶어진 종목 / 그 시각 / 피벗 대비 %
"""


def main() -> int:
    날짜 = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1][:2] == "20" \
        else datetime.date.today().isoformat()
    폴더 = 뿌리 / "브리핑" / 날짜
    폴더.mkdir(parents=True, exist_ok=True)
    파일 = 폴더 / f"전략심리기록_{날짜}.txt"

    처음글 = 파일.read_text(encoding="utf-8") if 파일.exists() else 밑글

    import tkinter as tk
    from tkinter import font as tkfont

    저장됨 = {"했다": False}
    창 = tk.Tk()
    창.title(f"전략·심리 기록 — {날짜}")

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
    tk.Label(바깥, anchor="w", justify="left", font=작은글꼴, fg="#333", wraplength=640,
             text="오늘 지킬 것과 지금 마음을 적어 두는 곳입니다. "
                  "형식은 자유입니다 — 아래 물음은 참고로만 적어 두었습니다.\n"
                  "저장하면 오늘 매매평가가 이 기록을 실제 매매와 대조합니다."
             ).pack(fill="x", pady=(0, 8))

    통 = tk.Frame(바깥)
    통.pack(fill="both", expand=True)
    막대 = tk.Scrollbar(통)
    막대.pack(side="right", fill="y")
    글칸 = tk.Text(통, font=글꼴, wrap="word", undo=True, bd=1, relief="solid",
                 yscrollcommand=막대.set, padx=8, pady=8)
    글칸.insert("1.0", 처음글)
    글칸.pack(side="left", fill="both", expand=True)
    막대.config(command=글칸.yview)
    글칸.focus_set()

    알림 = tk.Label(바깥, text="", anchor="w", font=작은글꼴, fg="#0a7")

    def 저장(*_):
        글 = 글칸.get("1.0", "end").rstrip() + "\n"
        파일.write_text(글, encoding="utf-8")
        저장됨["했다"] = True
        알림.config(text=f"저장했습니다 — {파일.name}")
        창.after(1200, lambda: 알림.config(text=""))

    def 저장하고닫기(*_):
        저장()
        창.after(200, 창.destroy)

    def 그냥닫기(*_):
        창.destroy()

    단추칸 = tk.Frame(바깥)
    단추칸.pack(fill="x", pady=(10, 0))
    알림.pack(in_=단추칸, side="left")
    tk.Button(단추칸, text="닫기", command=그냥닫기, width=8).pack(side="right", padx=(8, 0))
    tk.Button(단추칸, text="저장하고 닫기", command=저장하고닫기, width=13,
              default="active").pack(side="right")
    tk.Button(단추칸, text="저장", command=저장, width=8).pack(side="right", padx=(0, 8))

    창.protocol("WM_DELETE_WINDOW", 그냥닫기)
    창.bind("<Command-s>", lambda e: (저장(), "break")[1])
    창.bind("<Escape>", 그냥닫기)

    창.update_idletasks()
    너비, 높이 = 700, 620
    x = (창.winfo_screenwidth() - 너비) // 2
    y = max(40, (창.winfo_screenheight() - 높이) // 3)
    창.geometry(f"{너비}x{높이}+{x}+{y}")
    창.minsize(480, 360)
    창.lift()
    창.attributes("-topmost", True)
    창.after(400, lambda: 창.attributes("-topmost", False))
    try:
        import os
        import subprocess
        subprocess.run(["osascript", "-e",
                        'tell application "System Events" to set frontmost of the first '
                        f'process whose unix id is {os.getpid()} to true'],
                       capture_output=True, timeout=5)
    except Exception:
        pass

    if "--점검" in sys.argv:
        창.after(700, 그냥닫기)

    창.mainloop()
    print(str(파일) if 저장됨["했다"] else "")
    return 0


if __name__ == "__main__":
    sys.exit(main())
