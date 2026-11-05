#!/usr/bin/env python3
"""컨퍼런스콜 요약을 홈페이지 「데이터 → 컨퍼런스콜」 에 올린다.

  python3 컨퍼런스콜올리기.py 브리핑/2026-09-06/컨퍼런스콜_2026-09-06.json
  python3 컨퍼런스콜올리기.py <파일> --확인     올리지 않고 무엇을 올릴지만 본다

파일 모양은 지시문/컨퍼런스콜.md 를 보십시오. {"items": [ {...}, ... ]}
같은 종목·같은 분기가 이미 있으면 사이트가 갈아 끼웁니다 — 두 번 돌려도 늘지 않습니다.
"""
import json
import os
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

뿌리 = pathlib.Path(__file__).resolve().parent
사이트 = os.environ.get("TM26_URL", "http://127.0.0.1:8766").rstrip("/")
칸 = ("code", "name", "market", "quarter", "date", "sector",
     "headline", "summary", "call", "industry", "outlook", "numbers", "sources")


def 키찾기():
    k = os.environ.get("SCREENER_KEY", "").strip()
    if k:
        return k
    p = pathlib.Path.home() / ".tm26_key"
    return p.read_text(encoding="utf-8").strip() if p.exists() else ""


class _리다이렉트(urllib.request.HTTPRedirectHandler):
    """맨주소가 www 로 넘어갈 때 POST 를 그대로 다시 보냅니다."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if req.get_method() != "POST":
            return super().redirect_request(req, fp, code, msg, headers, newurl)
        머리 = {k: v for k, v in req.header_items()
                if k.lower() not in ("host", "content-length")}
        return urllib.request.Request(urllib.parse.urljoin(req.full_url, newurl),
                                      data=req.data, headers=머리, method="POST")


def main() -> int:
    인자 = [a for a in sys.argv[1:] if not a.startswith("--")]
    확인만 = "--확인" in sys.argv
    if not 인자:
        print(__doc__); return 2
    파일 = pathlib.Path(인자[0])
    if not 파일.exists():
        print(f"파일이 없습니다: {파일}"); return 2

    try:
        본 = json.loads(파일.read_text(encoding="utf-8"))
    except Exception as e:
        print("JSON 을 읽지 못했습니다:", e); return 2
    items = 본.get("items") if isinstance(본, dict) else 본
    if not isinstance(items, list) or not items:
        print("items 가 비어 있습니다."); return 2

    쓸것 = []
    for i, x in enumerate(items, 1):
        빠진 = [k for k in ("code", "name", "summary") if not str(x.get(k) or "").strip()]
        if 빠진:
            print(f"  {i}번째 — {', '.join(빠진)} 가 비어 있어 건너뜁니다"); continue
        쓸것.append({k: x.get(k) for k in 칸 if k in x})
        print(f"  {x.get('code')} {x.get('name')} · {x.get('quarter','')} "
              f"· 요약 {len(str(x.get('summary') or '')):,}자"
              f" · 산업 {len(str(x.get('industry') or '')):,}자"
              f" · 회사 {len(str(x.get('outlook') or '')):,}자")
    if not 쓸것:
        print("올릴 것이 없습니다."); return 2
    if 확인만:
        print(f"모두 {len(쓸것)}건입니다. (--확인 이라 올리지 않았습니다)"); return 0

    키 = 키찾기()
    if not 키 or len(키) < 20:
        print("SCREENER_KEY 를 찾지 못했습니다 (~/.tm26_key)."); return 2

    자료 = json.dumps({"items": 쓸것}, ensure_ascii=False).encode("utf-8")
    요청 = urllib.request.Request(사이트 + "/api/calls", data=자료, method="POST",
                                headers={"content-type": "application/json",
                                         "x-screener-key": 키})
    try:
        with urllib.request.build_opener(_리다이렉트).open(요청, timeout=120) as r:
            답 = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"올리지 못했습니다 (HTTP {e.code}) "
              f"{e.read().decode('utf-8','ignore')[:200]}"); return 1
    except Exception as e:
        print("올리지 못했습니다:", e); return 1

    if not 답.get("ok"):
        print("올리지 못했습니다:", 답.get("error")); return 1
    print(f"올렸습니다 — {답.get('saved')}건 (사이트에 담긴 것 모두 {답.get('담긴것')}건)")
    주소 = f"{사이트}/screener#macro"
    print(주소)
    try:
        (뿌리 / "캐시").mkdir(parents=True, exist_ok=True)
        (뿌리 / "캐시" / "마지막게시.txt").write_text(주소, encoding="utf-8")
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
