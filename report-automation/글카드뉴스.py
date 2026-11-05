#!/usr/bin/env python3
"""시황전략·브리핑을 카드 묶음(1080×1350)으로 만들어 텔레그램 채널에 보냅니다. (2026-10-04 신설)

    python3 글카드뉴스.py 전략 <브리핑/날짜/텔레그램전략_날짜.txt>      문단마다 한 장
    python3 글카드뉴스.py 브리핑 <am|mid|close|pm> [--날 2026-10-02]   5장 고정 — 소제목을 이어 붙이고 글씨를 맞춤 (2026-10-12)

    --대상 <chat_id>   다른 방으로 (시험: Poltracker -5437418963)
    --확인            굽기만 하고 보내지 않음
    --다시            이미 보낸 것도 다시 보냄

· 받는 곳은 `.env` 의 CARDNEWS_TELEGRAM_* (Awake Korea, @SaveKorea_bot). 제작 알림의 TELEGRAM_* 와 다릅니다.
· 브리핑은 `~/TM26_브리핑발송/브리핑발송.sh` 가 사이트에 글을 만들게 한 직후 부릅니다.
  전략은 `투자작업.sh` 가 시황전략을 다 쓴 뒤 부릅니다.
· 같은 글은 한 번만 보냅니다 — 캐시/글카드뉴스/ 에 보낸 표시를 남깁니다.
"""
import argparse, html, json, os, re, urllib.request
from pathlib import Path
import datetime as dt, time

뿌리 = Path(__file__).resolve().parent
표시 = 뿌리 / "캐시" / "글카드뉴스"

폭, 높이 = 1080, 1350
몸한도 = 높이 - 360            # 머리·꼬리를 뺀 본문 높이

틀 = """<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{width:%(폭)dpx;font-family:"Noto Sans CJK KR","Noto Sans KR","Apple SD Gothic Neo",sans-serif;word-break:keep-all}
.카드{width:%(폭)dpx;height:%(높이)dpx;background:#fffefb;position:relative;overflow:hidden}
.머리{background:#141311;padding:44px 64px 34px}
.갈피{color:#f0a868;font-size:26px;font-weight:700;display:flex;justify-content:space-between}
.갈피 span:last-child{color:#a8a29a;font-weight:400}
.제목{color:#fffefb;font-size:50px;font-weight:800;line-height:1.3;margin-top:22px}
.몸{padding:46px 64px 0;color:#26231f;font-size:37px;line-height:1.68}
.몸 p{margin-bottom:28px}
.몸 b.첫{color:#111}
.소제목{font-size:38px;font-weight:800;color:#111;margin:0 0 24px;display:flex;align-items:center;gap:16px}
.소제목::before{content:"";width:9px;height:38px;background:#c2410c;border-radius:2px}
.소제목 small{font-size:26px;color:#a8a29a;font-weight:500}
.점{position:relative;padding-left:32px;margin-bottom:20px}
.점::before{content:"";position:absolute;left:4px;top:25px;width:10px;height:10px;background:#c2410c;border-radius:50%%}
.주석{font-size:30px;color:#8a837a;line-height:1.6}
.꼬리{position:absolute;left:64px;right:64px;bottom:34px;display:flex;justify-content:space-between;
  color:#a8a29a;font-size:24px;border-top:2px solid #ece7de;padding-top:20px}
</style></head><body><div class="카드">
<div class="머리"><div class="갈피"><span>%(갈피)s</span><span>%(날)s</span></div>%(제목)s</div>
<div class="몸" id="몸">%(몸)s</div>
<div class="꼬리"><span>%(쪽)s</span><span>tradingmanagerkr.com</span></div>
</div></body></html>"""


def 덩이로(글, 첫문장굵게=False):
    """[(소제목|None, [html 덩이…])] — 빈 줄 문단, <b>소제목</b>, '· ' 점."""
    절들, 지금 = [], None
    for 줄 in 글.strip().split("\n"):
        줄 = 줄.strip()
        if not 줄:
            continue
        m = re.fullmatch(r"<b>(.+?)</b>", 줄)
        if m:
            지금 = (m.group(1), []); 절들.append(지금); continue
        안 = html.escape(줄).replace("&lt;b&gt;", "<b>").replace("&lt;/b&gt;", "</b>")
        if 줄.startswith(("· ", "- ", "• ")):
            덩 = f'<div class="점">{안[2:]}</div>'
        elif 줄.startswith("주석"):
            덩 = f'<p class="주석">{안}</p>'
        else:
            if 첫문장굵게:
                안 = re.sub(r"^(.+?[다요]\.)", r'<b class="첫">\1</b>', 안, count=1)
            덩 = f"<p>{안}</p>"
        if 지금 is None or 첫문장굵게:          # 전략: 문단마다 한 장
            지금 = (None, []); 절들.append(지금)
        지금[1].append(덩)
    return 절들


브리핑장수 = 5          # 브리핑은 5장으로 고정 (2026-10-12 Jun 지정 — 10~11장이 채널을 어지럽혔습니다)
최소배율 = 0.62         # 글씨를 이보다 작게는 줄이지 않습니다 (본문 약 23px)


def 카드들(갈피, 날, 큰제목, 절들, 장수=None, *, slot=None, facts=None):
    from 터미널카드 import 절카드
    return 절카드(갈피, 날, 큰제목, 절들, 장수, slot=slot, facts=facts)


def 열쇠():
    글 = (뿌리 / ".env").read_text(encoding="utf-8")
    값 = {k: (re.search(rf"^{k}=(.+)$", 글, re.M) or [None, ""])[1].strip().strip('"')
         for k in ("CARDNEWS_TELEGRAM_BOT_TOKEN", "CARDNEWS_TELEGRAM_CHAT_ID")}
    return 값["CARDNEWS_TELEGRAM_BOT_TOKEN"], 값["CARDNEWS_TELEGRAM_CHAT_ID"]


def 묶어보내기(방, 파일들, 설명):
    for k in range(0, len(파일들), 10):           # 앨범 한 묶음은 10장까지
        조 = 파일들[k:k + 10]
        경계 = "----tm26set" + os.urandom(8).hex(); 몸 = b""; media = []
        for i, f in enumerate(조):
            media.append({"type": "photo", "media": f"attach://p{i}",
                          **({"caption": 설명, "parse_mode": "HTML"} if k == 0 and i == 0 else {})})
            몸 += (f"--{경계}\r\nContent-Disposition: form-data; name=\"p{i}\"; filename=\"c{i}.png\"\r\n"
                   f"Content-Type: image/png\r\n\r\n").encode() + f.read_bytes() + b"\r\n"
        for kk, v in (("chat_id", 방), ("media", json.dumps(media, ensure_ascii=False))):
            몸 += f"--{경계}\r\nContent-Disposition: form-data; name=\"{kk}\"\r\n\r\n{v}\r\n".encode()
        몸 += f"--{경계}--\r\n".encode()
        r = urllib.request.Request(f"https://api.telegram.org/bot{열쇠()[0]}/sendMediaGroup", data=몸,
                                   headers={"Content-Type": f"multipart/form-data; boundary={경계}"})
        with urllib.request.urlopen(r, timeout=120) as res:
            assert json.loads(res.read())["ok"]


def 오늘브리핑(slot, 날=None):
    """사이트에 올라온 그 슬롯의 글. 중간 서버가 60초 묵혀 두므로 주소에 시각을 붙여 새로 받고,
    아직 없으면 1분 간격으로 최대 10분 기다립니다."""
    날 = 날 or dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).strftime("%Y-%m-%d")
    for _ in range(11):
        with urllib.request.urlopen(f"http://127.0.0.1:8766/api/brief?_={int(time.time())}", timeout=30) as r:
            for it in json.loads(r.read())["items"]:
                if it["slot"] == slot and it["day"] == 날:
                    return it
        time.sleep(60)
    raise SystemExit(f"{날} {slot} 브리핑이 사이트에 없습니다")


def main():
    ㅍ = argparse.ArgumentParser()
    ㅍ.add_argument("종류", choices=["전략", "브리핑"]); ㅍ.add_argument("대상물")
    ㅍ.add_argument("--날"); ㅍ.add_argument("--대상"); ㅍ.add_argument("--파일")
    ㅍ.add_argument("--확인", action="store_true"); ㅍ.add_argument("--다시", action="store_true")
    a = ㅍ.parse_args()
    if a.종류 == "전략":
        경로 = Path(a.대상물)
        글 = 경로.read_text(encoding="utf-8")
        첫줄, 나머지 = 글.split("\n", 1)
        m = re.match(r"\[시황·전략\]\s*(.+?)\s*·\s*(.+)$", 첫줄.strip())
        날, 제목 = (m.group(1), m.group(2)) if m else ("", 첫줄)
        열쇠값 = "전략_" + 경로.stem.split("_")[-1]
        덩이 = 덩이로(나머지, 첫문장굵게=True)
        갈피, 날표, 큰제목 = "시황 · 전략", 날, 제목
        설명 = f"📊 <b>[시황·전략] {html.escape(제목)}</b>"
    else:
        이름 = {"am": "장전 브리핑", "mid": "장중 브리핑", "close": "장마감 브리핑", "pm": "해외 브리핑"}[a.대상물]
        it = 오늘브리핑(a.대상물, a.날)
        #  AI 가 쓰지 못해 사이트가 숫자만 나열한 예비 틀(writer='틀')로 저장한 날은 채널에 보내지 않습니다.
        #  2026-10-05 23:00 해외 브리핑 — 사이트의 Anthropic API 크레딧이 떨어져 예비 틀이 카드로 나갔습니다.
        if it.get("writer") != "ai" and not a.파일 and not a.확인:
            print(f"{it['day']} {a.대상물}: AI 가 쓴 글이 아닙니다(writer={it.get('writer')}) — 채널에 보내지 않습니다")
            return
        월, 일 = int(it["day"][5:7]), int(it["day"][8:10])
        본문 = Path(a.파일).read_text(encoding="utf-8") if a.파일 else it["text"]
        열쇠값 = f"{it['day']}_{a.대상물}"
        덩이 = 덩이로(re.sub(r"^#.*\n", "", 본문))
        갈피, 날표, 큰제목 = f"TM2026 · {이름}", f"{it['day']} {it.get('at', '')}", f"{월}월 {일}일 {이름}"
        설명 = f"📰 <b>{월}월 {일}일 {이름}</b>"
    설명 += "\n\nTM26 로컬 리서치"          # 리포트 발송처럼 맨 아래에 주소 (2026-10-04 Jun 지정)
    표시.mkdir(parents=True, exist_ok=True)
    보낸표시 = 표시 / f"{열쇠값}.sent"
    if 보낸표시.exists() and not a.다시 and not a.대상 and not a.확인:
        print(f"이미 보냈습니다: {열쇠값}"); return
    파일들 = 카드들(갈피, 날표, 큰제목, 덩이, 장수=브리핑장수 if a.종류 == '브리핑' else None,
                   slot=a.대상물 if a.종류 == '브리핑' else None,
                   facts=it.get('facts') if a.종류 == '브리핑' else None)
    print(f"{열쇠값} · {len(파일들)}장")
    if a.확인:
        return
    방 = a.대상 or 열쇠()[1]
    if not 방:
        raise SystemExit("보낼 방이 없습니다 — .env 의 CARDNEWS_TELEGRAM_CHAT_ID")
    묶어보내기(방, 파일들, 설명)
    if not a.대상:
        보낸표시.write_text(dt.datetime.now().isoformat(timespec="seconds"))
    print(f"   보냈습니다 → {방}")


if __name__ == "__main__":
    main()
