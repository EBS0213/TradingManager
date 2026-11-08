#!/usr/bin/env python3
"""오늘 시황·전략 보고서를 TM26 게시판 「전략」 갈래에 올린다.

  python3 게시하기.py                 오늘 것
  python3 게시하기.py 2026-09-02      날짜를 직접
  python3 게시하기.py --확인          올리지 않고 무엇을 올릴지만 보여준다

올라가는 모양 (2026-09-03 에 바꿨습니다)
  · 글 본문 — 「시황전략요약_<날짜>.html」 (2,000자 안팎의 요약)
  · 첨부   — 「시황전략_<날짜>.pdf」 (보고서 전문)
  요약 파일이 없으면 예전처럼 보고서 HTML 전문을 본문으로 올립니다.

키는 이 순서로 찾는다.
  1) 환경변수 SCREENER_KEY
  2) 이 폴더의 .env  (SCREENER_KEY=... 한 줄)
  3) ~/.tm26_key    (키만 한 줄)

키는 파일에만 두고 이 스크립트에는 적지 않는다. 화면에도 찍지 않는다.
"""
from 로컬설정 import 사이트주소
import sys, os, json, datetime, pathlib, re, uuid, html
import unicodedata as u
import urllib.request, urllib.error, urllib.parse

# 맨주소(tradingmanagerkr.com)는 www 로 308 로 넘깁니다. 넘어가도 따라가게 해 뒀지만
#  (아래 _리다이렉트), 처음부터 www 로 두는 편이 한 번 덜 오갑니다. (2026-09-05)
사이트 = 사이트주소()
뿌리 = pathlib.Path(__file__).resolve().parent

# 첨부 한 개 한도. 사이트가 4MB 에서 막습니다(Vercel 이 한 번에 받는 본문이 4.5MB).
첨부한도 = 4 * 1024 * 1024


def nfc(x): return u.normalize("NFC", x or "")


def 키찾기():
    k = os.environ.get("SCREENER_KEY", "").strip()
    if k: return k
    env = 뿌리 / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8", errors="ignore").splitlines():
            if line.strip().startswith("SCREENER_KEY"):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    p = pathlib.Path.home() / ".tm26_key"
    if p.exists(): return p.read_text(encoding="utf-8").strip()
    return ""


def 찾기(폴더: pathlib.Path, 앞말: str, 확장자: str):
    """이름이 NFD 로 저장돼 있어도 찾아낸다."""
    if not 폴더.exists(): return None
    바로 = 폴더 / f"{앞말}.{확장자}"
    if 바로.exists(): return 바로
    for p in sorted(폴더.iterdir()):
        if p.suffix.lower() == "." + 확장자 and nfc(p.name) == nfc(f"{앞말}.{확장자}"):
            return p
    return None


def 본문뽑기(문서: str) -> str:
    """보고서 HTML 을 그대로 쓰되, 게시판 틀 안에서 어색한 것만 손본다."""
    # 인쇄용 여백 규칙은 화면에서 위아래 빈칸만 만든다
    문서 = re.sub(r"@page\s*\{[^}]*\}", "", 문서)
    # 화면에서는 본문 폭을 틀에 맞춘다
    문서 = 문서.replace("<body>", '<body style="margin:0;padding:18px 20px;">', 1)
    return 문서


def 글씨를틀에(글: str) -> str:
    """요약을 txt 로만 만들었을 때 — 읽을 만한 HTML 로 감싼다."""
    문단 = [html.escape(p.strip()) for p in re.split(r"\n\s*\n", 글.strip()) if p.strip()]
    속 = "\n".join(f"<p>{p.replace(chr(10), '<br>')}</p>" for p in 문단) or "<p></p>"
    return ('<!doctype html><meta charset="utf-8">'
            '<body style="margin:0;padding:18px 20px;'
            "font:11pt/1.8 'Noto Sans CJK KR',sans-serif;color:#1a1a1a\">"
            + 속 + "</body>")


def 제목만들기(문서: str, 날짜: str) -> str:
    등급 = ""
    g = re.search(r"(다소 우호적|다소 불안|우호적|중립|불안)", 문서)
    if g: 등급 = " · 투자환경 " + g.group(1)
    점수 = ""
    m = re.search(r'<meta\s+name=["\']tm26-strategy-score["\']\s+content=["\']([+-]?[0-5])["\']\s*/?>', 문서, re.I)
    if m:
        값 = int(m.group(1))
        점수 = f" [{값:+d}]" if 값 else " [0]"
    return f"[시황·전략] {날짜}{점수}{등급}"


class _리다이렉트(urllib.request.HTTPRedirectHandler):
    """주소가 www 로 넘어갈 때 POST 를 **그대로** 다시 보냅니다 (2026-09-05).

    파이썬이 스스로 하는 일은 둘 다 글을 못 올립니다.
      · 308 → 오류를 내고 멈춥니다 (9월 4일 아침에 여기서 막혔습니다)
      · 301·302 → GET 으로 바꿔 보냅니다. 그러면 글 목록만 받아 오고 글은 안 올라가는데
        답이 ok:true 라서 올라간 줄 알게 됩니다 — 더 나쁩니다.
    그래서 방식·본문·머리(x-screener-key 포함)를 그대로 옮겨 다시 보냅니다."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if req.get_method() != "POST":
            return super().redirect_request(req, fp, code, msg, headers, newurl)
        # Host 와 Content-length 는 파이썬이 보낼 때 스스로 채우는 것입니다. 그대로 옮기면
        #  새 주소로 보내면서 옛 Host(맨주소)를 들고 가서, 사이트가 또 www 로 넘기고,
        #  그것이 끝없이 되풀이됩니다 (2026-09-05 에 여기서 한 번 헤맸습니다).
        머리 = {k: v for k, v in req.header_items()
                if k.lower() not in ("host", "content-length")}
        return urllib.request.Request(urllib.parse.urljoin(req.full_url, newurl),
                                      data=req.data, headers=머리, method="POST")


_열개 = urllib.request.build_opener(_리다이렉트)


def 부르기(주소: str, 자료: bytes, 머리: dict, 초: int = 180):
    요청 = urllib.request.Request(주소, data=자료, method="POST", headers=머리)
    with _열개.open(요청, timeout=초) as r:
        return json.loads(r.read().decode("utf-8"))


def 첨부올리기(파일: pathlib.Path, 키: str, 제목: str):
    """PDF 를 사이트에 올리고 파일 번호를 돌려준다. 실패하면 (None, 까닭)."""
    크기 = 파일.stat().st_size
    if 크기 > 첨부한도:
        return None, f"{크기/1024/1024:.1f}MB 라 첨부 한도(4MB)를 넘습니다"

    경계 = "----TM26" + uuid.uuid4().hex
    이름 = nfc(파일.name)
    몸 = bytearray()

    def 칸(이름칸: str, 값: str):
        몸.extend(f"--{경계}\r\n".encode())
        몸.extend(f'Content-Disposition: form-data; name="{이름칸}"\r\n\r\n'.encode())
        몸.extend(값.encode("utf-8")); 몸.extend(b"\r\n")

    칸("title", 제목)
    칸("note", "보고서 전문 (PDF)")
    몸.extend(f"--{경계}\r\n".encode())
    몸.extend(f'Content-Disposition: form-data; name="file"; filename="{이름}"\r\n'.encode())
    몸.extend(b"Content-Type: application/pdf\r\n\r\n")
    몸.extend(파일.read_bytes()); 몸.extend(b"\r\n")
    몸.extend(f"--{경계}--\r\n".encode())

    try:
        답 = 부르기(사이트 + "/api/files", bytes(몸),
                  {"content-type": f"multipart/form-data; boundary={경계}",
                   "x-screener-key": 키})
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code} {e.read().decode('utf-8', 'ignore')[:200]}"
    except Exception as e:
        return None, str(e)

    if not 답.get("ok"):
        return None, str(답.get("error"))
    올림 = 답.get("올림") or []
    if not 올림:
        return None, "; ".join(답.get("건너뜀") or ["까닭을 알 수 없습니다"])
    return int(올림[0]["id"]), ""


def main():
    인자 = [a for a in sys.argv[1:] if not a.startswith("--")]
    확인만 = "--확인" in sys.argv
    날짜 = 인자[0] if 인자 else datetime.date.today().isoformat()

    폴더 = 뿌리 / "브리핑" / 날짜
    요약 = 찾기(폴더, f"시황전략요약_{날짜}", "html") or 찾기(폴더, f"시황전략요약_{날짜}", "txt")
    전문 = 찾기(폴더, f"시황전략_{날짜}", "html")
    pdf = 찾기(폴더, f"시황전략_{날짜}", "pdf")

    if not 요약 and not 전문:
        print(f"오늘 시황·전략 보고서를 찾지 못했습니다: {폴더}/시황전략_{날짜}.html")
        return 2

    # 제목의 투자환경 등급은 전문에서 찾습니다 (요약에 등급이 빠져 있을 수 있습니다)
    등급글 = (전문 or 요약).read_text(encoding="utf-8", errors="ignore")

    if 요약:
        글 = 요약.read_text(encoding="utf-8")
        본문 = 본문뽑기(글) if 요약.suffix.lower() == ".html" else 글씨를틀에(글)
        어디서 = f"요약 {nfc(요약.name)}"
    else:
        본문 = 본문뽑기(등급글)
        어디서 = f"전문 {nfc(전문.name)} (요약 파일이 없어 전문을 올립니다)"

    제목 = 제목만들기(등급글, 날짜)
    print(f"본문   : {어디서} · {len(본문):,}자")
    print(f"첨부   : {nfc(pdf.name) if pdf else '(PDF 없음)'}"
          + (f" · {pdf.stat().st_size/1024/1024:.1f}MB" if pdf else ""))
    print(f"제목   : {제목}")
    if len(본문) > 400000:
        print("본문이 40만 자를 넘습니다. 게시판이 받지 않습니다."); return 2
    if 확인만:
        print("(--확인 이라 올리지 않았습니다)"); return 0

    키 = 키찾기()
    if not 키:
        print("SCREENER_KEY 를 찾지 못했습니다. ~/.tm26_key 에 키만 한 줄 적어 두십시오."); return 2
    # 「[SENSITIVE]」는 Vercel 이 키를 안 내주고 대신 적어 놓는 글자입니다.
    #  이것이 ~/.tm26_key 에 그대로 들어가 있어서 9월 4일 아침 게시가 401 로 막혔습니다.
    if 키 in ("[SENSITIVE]", "[REDACTED]") or len(키) < 20:
        print("~/.tm26_key 에 든 것이 진짜 키가 아닙니다 (자리표시자이거나 너무 짧습니다).")
        print("서버(Lightsail)의 ~/minervini/.env 에 있는 SCREENER_KEY 를 그대로 넣어 주십시오.")
        return 2

    # ① 첨부부터 올립니다. 실패해도 글은 올립니다 — 요약만이라도 보이는 편이 낫습니다.
    파일번호 = []
    if pdf:
        번호, 까닭 = 첨부올리기(pdf, 키, f"시황·전략 보고서 {날짜}")
        if 번호:
            파일번호.append(번호); print(f"첨부 올림 — 파일 {번호}")
        else:
            print(f"첨부 실패: {까닭} (글은 그대로 올립니다)")

    # ② 글을 올립니다. 같은 제목이 있으면 사이트가 갈아 끼웁니다.
    자료 = json.dumps({"title": 제목, "body": 본문, "cat": "strategy",
                     "files": 파일번호}).encode("utf-8")
    try:
        답 = 부르기(사이트 + "/api/board", 자료,
                  {"content-type": "application/json", "x-screener-key": 키})
    except urllib.error.HTTPError as e:
        몸 = e.read().decode("utf-8", "ignore")[:300]
        print(f"게시 실패 (HTTP {e.code}) {몸}"); return 1
    except Exception as e:
        print(f"게시 실패: {e}"); return 1

    if not 답.get("ok"):
        print("게시 실패:", 답.get("error")); return 1
    글번호 = 답.get("id")
    붙음 = 답.get("files")
    print(("갈아 끼웠습니다" if 답.get("replaced") else "올렸습니다") + f" — 글 {글번호}"
          + (f" · 첨부 {붙음}개" if 붙음 else (" · 첨부가 붙지 않았습니다" if 파일번호 else "")))
    주소 = f"{사이트}/screener#board/{글번호}"
    print(주소)
    try:
        (뿌리 / "캐시").mkdir(parents=True, exist_ok=True)
        (뿌리 / "캐시" / "마지막게시.txt").write_text(주소, encoding="utf-8")
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
