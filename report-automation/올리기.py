#!/usr/bin/env python3
"""보고서를 TM26 게시판에 올린다. 어떤 갈래든 이 하나로 올립니다.

  python3 올리기.py --갈래 report --제목 "[미국] 관심종목 종합 2026-09-08" \
                    --본문 브리핑/2026-09-08/미국종합_2026-09-08.html \
                    --첨부 브리핑/2026-09-08/미국종합_2026-09-08.pdf

  --갈래   report(리포트) · strategy(전략) · review(평가, 관리자만 보임) · free(자유)
  --본문   HTML 이나 txt 파일. txt 면 읽을 만한 HTML 로 감싸 올립니다.
  --첨부   여러 개 가능. 하나에 4MB 까지. 큰 것은 건너뛰고 글은 그대로 올립니다.
  --확인   올리지 않고 무엇을 올릴지만 보여 준다

같은 갈래에 **같은 제목**이 이미 있으면 새 글을 만들지 않고 내용을 갈아 끼웁니다.
두 번 돌아도 글이 둘로 늘지 않습니다.

키는 이 순서로 찾습니다 — 환경변수 SCREENER_KEY → 이 폴더의 .env → ~/.tm26_key
"""
import argparse
import html
import json
import os
import pathlib
import re
import sys
import unicodedata as u
import urllib.error
import urllib.parse
import urllib.request
import uuid

# 맨주소(tradingmanagerkr.com)는 www 로 308 로 넘깁니다. 넘어가도 따라가게 해 뒀지만
#  (아래 _리다이렉트), 처음부터 www 로 두는 편이 한 번 덜 오갑니다.
사이트 = os.environ.get("TM26_URL", "http://127.0.0.1:8766").rstrip("/")
뿌리 = pathlib.Path(__file__).resolve().parent
첨부한도 = 4 * 1024 * 1024
본문한도 = 400000


def nfc(x): return u.normalize("NFC", x or "")


def 키찾기():
    k = os.environ.get("SCREENER_KEY", "").strip()
    if k:
        return k
    env = 뿌리 / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8", errors="ignore").splitlines():
            if line.strip().startswith("SCREENER_KEY"):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    p = pathlib.Path.home() / ".tm26_key"
    if p.exists():
        return p.read_text(encoding="utf-8").strip()
    return ""


class _리다이렉트(urllib.request.HTTPRedirectHandler):
    """주소가 www 로 넘어갈 때 POST 를 그대로 다시 보냅니다.
       파이썬 기본 동작은 308 에서 멈추고, 301·302 에서는 GET 으로 바꿔 버립니다."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if req.get_method() != "POST":
            return super().redirect_request(req, fp, code, msg, headers, newurl)
        # Host·Content-length 는 파이썬이 스스로 채웁니다. 옛 Host 를 들고 가면 끝없이 되풀이됩니다.
        머리 = {k: v for k, v in req.header_items()
                if k.lower() not in ("host", "content-length")}
        return urllib.request.Request(urllib.parse.urljoin(req.full_url, newurl),
                                      data=req.data, headers=머리, method="POST")


_열개 = urllib.request.build_opener(_리다이렉트)


def 부르기(주소: str, 자료: bytes, 머리: dict, 초: int = 180):
    요청 = urllib.request.Request(주소, data=자료, method="POST", headers=머리)
    with _열개.open(요청, timeout=초) as r:
        return json.loads(r.read().decode("utf-8"))


def 글씨를틀에(글: str) -> str:
    """txt 를 읽을 만한 HTML 로 감쌉니다."""
    문단 = [html.escape(p.strip()) for p in re.split(r"\n\s*\n", 글.strip()) if p.strip()]
    속 = "\n".join(f"<p>{p.replace(chr(10), '<br>')}</p>" for p in 문단) or "<p></p>"
    return ('<!doctype html><meta charset="utf-8">'
            '<body style="margin:0;padding:18px 20px;'
            "font:11pt/1.8 'Noto Sans CJK KR',sans-serif;color:#1a1a1a\">"
            + 속 + "</body>")


# 조각 HTML 을 감쌀 틀. 게시판은 **완전한 문서**만 격리된 칸에 그립니다 —
#  조각(<p>…)으로 올리면 태그가 글자 그대로 보입니다 (2026-09-05 에 실제로 그랬습니다).
틀 = """<!doctype html><html lang="ko"><head><meta charset="utf-8">
<title>{제목}</title><style>
 body{{margin:0;padding:20px 22px;color:#1a1a1a;background:#fff;
   font:11.5pt/1.75 -apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Noto Sans KR',sans-serif}}
 h1,h2,h3{{color:#1F3864;line-height:1.4}}
 h1{{font-size:18pt;margin:0 0 14px}} h2{{font-size:14pt;margin:22px 0 8px}}
 h3{{font-size:12.5pt;margin:20px 0 7px;padding-bottom:5px;border-bottom:1px solid #E1E7F0}}
 p{{margin:0 0 11px}} b,strong{{color:#12203a}}
 table{{border-collapse:collapse;width:100%;margin:10px 0 14px;font-size:10.5pt}}
 th,td{{border:1px solid #D8DFEA;padding:6px 9px;text-align:left;vertical-align:top}}
 th{{background:#F4F6FA;color:#1F3864;font-weight:700}}
 ul,ol{{margin:0 0 11px;padding-left:22px}} li{{margin:0 0 5px}}
 small{{color:#6b7684}}
</style></head><body>
{속}
</body></html>"""


def 본문다듬기(문서: str, 제목: str = "") -> str:
    """보고서 HTML 을 게시판 틀 안에서 어색하지 않게 손봅니다.
       조각이면 완전한 문서로 감싸 줍니다."""
    앞 = 문서.lstrip()[:200].lower()
    if not (앞.startswith("<!doctype html") or 앞.startswith("<html")):
        return 틀.format(제목=html.escape(제목 or "TM26"), 속=문서)
    문서 = re.sub(r"@page\s*\{[^}]*\}", "", 문서)      # 인쇄 여백 규칙은 화면에서 빈칸만 만듭니다
    문서 = 문서.replace("<body>", '<body style="margin:0;padding:18px 20px;">', 1)
    return 문서


def 첨부올리기(파일: pathlib.Path, 키: str, 제목: str):
    """파일 하나를 올리고 번호를 돌려준다. 실패하면 (None, 까닭)."""
    크기 = 파일.stat().st_size
    if 크기 > 첨부한도:
        return None, f"{크기/1024/1024:.1f}MB 라 첨부 한도(4MB)를 넘습니다"

    경계 = "----TM26" + uuid.uuid4().hex
    이름 = nfc(파일.name)
    종류 = {"pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg",
          "jpeg": "image/jpeg", "csv": "text/csv", "txt": "text/plain",
          "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          }.get(파일.suffix.lower().lstrip("."), "application/octet-stream")
    몸 = bytearray()

    def 칸(이름칸: str, 값: str):
        몸.extend(f"--{경계}\r\n".encode())
        몸.extend(f'Content-Disposition: form-data; name="{이름칸}"\r\n\r\n'.encode())
        몸.extend(값.encode("utf-8")); 몸.extend(b"\r\n")

    칸("title", 제목)
    칸("note", "")
    몸.extend(f"--{경계}\r\n".encode())
    몸.extend(f'Content-Disposition: form-data; name="file"; filename="{이름}"\r\n'.encode())
    몸.extend(f"Content-Type: {종류}\r\n\r\n".encode())
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


def main() -> int:
    ap = argparse.ArgumentParser(add_help=False)
    ap.add_argument("--갈래", default="report")
    ap.add_argument("--제목", default="")
    ap.add_argument("--본문", default="")
    ap.add_argument("--첨부", nargs="*", default=[])
    ap.add_argument("--확인", action="store_true")
    ap.add_argument("-h", "--help", action="store_true")
    옵션 = ap.parse_args()
    if 옵션.help or not 옵션.제목 or not 옵션.본문:
        print(__doc__); return 0 if 옵션.help else 2

    본문파일 = pathlib.Path(옵션.본문)
    if not 본문파일.exists():
        print(f"본문 파일이 없습니다: {본문파일}"); return 2
    글 = 본문파일.read_text(encoding="utf-8", errors="ignore")
    제목 = 옵션.제목.strip()[:120]
    본문 = (본문다듬기(글, 제목) if 본문파일.suffix.lower() in (".html", ".htm")
          else 글씨를틀에(글))
    붙일것 = [pathlib.Path(x) for x in 옵션.첨부 if pathlib.Path(x).exists()]
    없는것 = [x for x in 옵션.첨부 if not pathlib.Path(x).exists()]

    print(f"갈래   : {옵션.갈래}")
    print(f"제목   : {제목}")
    print(f"본문   : {nfc(본문파일.name)} · {len(본문):,}자")
    for f in 붙일것:
        print(f"첨부   : {nfc(f.name)} · {f.stat().st_size/1024/1024:.1f}MB")
    for x in 없는것:
        print(f"첨부   : (없는 파일이라 건너뜁니다) {x}")

    if len(본문) > 본문한도:
        print(f"본문이 {본문한도:,}자를 넘습니다. 게시판이 받지 않습니다."); return 2
    if 옵션.확인:
        print("(--확인 이라 올리지 않았습니다)"); return 0

    키 = 키찾기()
    if not 키:
        print("SCREENER_KEY 를 찾지 못했습니다. ~/.tm26_key 에 키만 한 줄 적어 두십시오."); return 2
    if 키 in ("[SENSITIVE]", "[REDACTED]") or len(키) < 20:
        print("~/.tm26_key 에 든 것이 진짜 키가 아닙니다 (자리표시자이거나 너무 짧습니다).")
        return 2

    파일번호 = []
    for f in 붙일것:
        번호, 까닭 = 첨부올리기(f, 키, 제목)
        if 번호:
            파일번호.append(번호); print(f"첨부 올림 — 파일 {번호} ({nfc(f.name)})")
        else:
            print(f"첨부 실패: {nfc(f.name)} — {까닭} (글은 그대로 올립니다)")

    자료 = json.dumps({"title": 제목, "body": 본문, "cat": 옵션.갈래,
                     "files": 파일번호}).encode("utf-8")
    try:
        답 = 부르기(사이트 + "/api/board", 자료,
                  {"content-type": "application/json", "x-screener-key": 키})
    except urllib.error.HTTPError as e:
        print(f"게시 실패 (HTTP {e.code}) {e.read().decode('utf-8','ignore')[:300]}"); return 1
    except Exception as e:
        print(f"게시 실패: {e}"); return 1

    if not 답.get("ok"):
        print("게시 실패:", 답.get("error")); return 1
    print(("갈아 끼웠습니다" if 답.get("replaced") else "올렸습니다")
          + f" — 글 {답.get('id')}"
          + (f" · 첨부 {답.get('files')}개" if 답.get("files") else ""))
    주소 = f"{사이트}/screener#board/{답.get('id')}"
    print(주소)
    # 알림에서 「이동」을 눌렀을 때 갈 자리를 적어 둡니다 (알림.sh 가 「마지막」으로 읽습니다)
    try:
        (뿌리 / "캐시").mkdir(parents=True, exist_ok=True)
        (뿌리 / "캐시" / "마지막게시.txt").write_text(주소, encoding="utf-8")
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
