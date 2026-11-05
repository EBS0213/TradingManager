"""
한국투자증권 오픈API 시세 수집기
--------------------------------
`price.py` 의 FinanceDataReader·pykrx·네이버 스크래핑을 대체하기 위한 모듈이다.
스크래핑은 페이지 구조가 바뀌면 조용히 빈 값을 돌려주는데, 이 시스템은 launchd 로
무인 실행되므로 그 조용한 실패가 가장 위험하다. 공식 API 는 실패하면 오류코드를 준다.

**아직 `price.py` 에 연결되어 있지 않다.** 이 파일만으로는 파이프라인이 바뀌지 않는다.

준비물 (.env 에 넣는다. config.yaml 에 적지 말 것 — 저장소에 올라간다)
    KIS_APP_KEY=...        한국투자증권 KIS Developers 에서 발급
    KIS_APP_SECRET=...
    KIS_ENV=real           real:실전 / demo:모의 (모의는 호출 한도가 낮다)

확인하는 법 — 필드명이 맞는지 실제 응답으로 대조한다
    . ./파이썬고르기.sh
    "$PY3" -m src.kis 점검 005930      # 국내
    "$PY3" -m src.kis 점검 CDNA        # 해외

확인된 스펙 (koreainvestment/open-trading-api 공식 예제 기준, 2026-09-13)
    국내 일봉   GET /uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice  FHKST03010100
                한 번에 최대 100건 → 날짜 창을 뒤로 밀며 여러 번 부른다
    국내 현재가 GET /uapi/domestic-stock/v1/quotations/inquire-price                 FHKST01010100
    해외 일봉   GET /uapi/overseas-price/v1/quotations/dailyprice                    HHDFS76240000
    해외 현재가 GET /uapi/overseas-price/v1/quotations/price-detail                  HHDFS76200200
    토큰        POST /oauth2/tokenP   유효 24시간 · 갱신주기 6시간 · 재발급은 1분에 1회
                → 토큰을 캐시하지 않으면 무인 실행에서 곧 막힌다
"""

from __future__ import annotations

import json
import os
import pathlib
import time
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

import requests

뿌리 = pathlib.Path(__file__).resolve().parent.parent
토큰파일 = pathlib.Path.home() / ".tm26_kis_token.json"
거래소파일 = pathlib.Path.home() / ".tm26_kis_excd.json"

실전 = "https://openapi.koreainvestment.com:9443"
모의 = "https://openapivts.koreainvestment.com:29443"

# 초당 유량 제한(실전 기준 약 10건/초). 여유를 두고 부른다.
_최소간격 = 0.15
_마지막호출 = 0.0

# 미국 거래소 코드. 종목이 어디 상장인지 모르므로 이 순서로 찔러 보고 결과를 캐시한다.
미국거래소 = ("NAS", "NYS", "AMS")


class KisError(RuntimeError):
    """API 가 오류코드를 돌려준 경우. 조용히 넘기지 말고 위로 올린다."""


@dataclass
class 시세:
    코드: str
    해외: bool = False
    거래소: str | None = None
    날짜: list[str] = field(default_factory=list)
    종가: list[float] = field(default_factory=list)
    거래량: list[float] = field(default_factory=list)
    현재가: float | None = None
    시가총액: float | None = None        # 국내는 억원, 해외는 API 가 주는 단위 그대로
    per: float | None = None
    pbr: float | None = None
    eps: float | None = None
    bps: float | None = None
    고가52주: float | None = None
    저가52주: float | None = None
    메모: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# 설정 · 토큰
# ---------------------------------------------------------------------------
def _env(이름: str, 기본: str = "") -> str:
    """환경변수를 보고, 없으면 .env 에서 읽는다 (collect.py 와 같은 방식)."""
    v = os.environ.get(이름, "").strip()
    if v:
        return v
    env = 뿌리 / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8", errors="ignore").splitlines():
            line = line.strip()
            if line.startswith(이름 + "="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    return 기본


def 설정() -> tuple[str, str, str]:
    """(앱키, 앱시크릿, 기준주소) 를 돌려준다. 키가 없으면 바로 알려 준다."""
    키 = _env("KIS_APP_KEY")
    시크릿 = _env("KIS_APP_SECRET")
    구분 = _env("KIS_ENV", "real").lower()
    if not 키 or not 시크릿:
        raise KisError(
            "KIS_APP_KEY / KIS_APP_SECRET 이 없습니다. "
            "https://apiportal.koreainvestment.com 에서 발급해 .env 에 넣으십시오."
        )
    return 키, 시크릿, (모의 if 구분 == "demo" else 실전)


def 토큰(강제: bool = False) -> str:
    """접근토큰을 돌려준다. 재발급은 1분에 1회뿐이라 반드시 캐시를 쓴다.

    만료 1시간 전부터 새로 받는다. 새로 받다가 실패하면 아직 살아 있는 캐시를 쓴다 —
    무인 실행 중에 토큰 재발급이 한 번 튕겼다고 그날 수집을 통째로 버릴 수는 없다."""
    키, 시크릿, 기준 = 설정()
    남은 = None
    캐시: dict[str, Any] = {}

    if 토큰파일.exists() and not 강제:
        try:
            캐시 = json.loads(토큰파일.read_text(encoding="utf-8"))
            if 캐시.get("기준") == 기준 and 캐시.get("앱키끝") == 키[-6:]:
                만료 = datetime.fromisoformat(캐시["만료"])
                남은 = (만료 - datetime.now()).total_seconds()
                if 남은 > 3600:
                    return 캐시["토큰"]
        except Exception:                                     # noqa: BLE001
            캐시 = {}

    try:
        r = requests.post(
            f"{기준}/oauth2/tokenP",
            json={"grant_type": "client_credentials", "appkey": 키, "appsecret": 시크릿},
            headers={"content-type": "application/json"},
            timeout=15,
        )
        본문 = r.json()
        tok = 본문.get("access_token")
        if not tok:
            raise KisError(f"토큰 발급 실패: {본문}")
        초 = int(본문.get("expires_in") or 86400)
        새것 = {
            "토큰": tok,
            "만료": (datetime.now() + timedelta(seconds=초)).isoformat(timespec="seconds"),
            "기준": 기준,
            "앱키끝": 키[-6:],
        }
        토큰파일.write_text(json.dumps(새것, ensure_ascii=False), encoding="utf-8")
        토큰파일.chmod(0o600)
        return tok
    except Exception as e:                                    # noqa: BLE001
        if 캐시.get("토큰") and (남은 or 0) > 0:
            return 캐시["토큰"]
        raise KisError(f"토큰을 받지 못했습니다: {e}") from e


# ---------------------------------------------------------------------------
# 호출
# ---------------------------------------------------------------------------
def 부르기(경로: str, tr_id: str, 파라미터: dict[str, Any],
          tr_cont: str = "", 재시도: int = 3) -> dict[str, Any]:
    """GET 조회 한 번. 초당 유량을 지키고, 유량 초과(EGW00201)면 쉬었다 다시 부른다."""
    global _마지막호출
    키, 시크릿, 기준 = 설정()
    머리 = {
        "content-type": "application/json; charset=utf-8",
        "authorization": f"Bearer {토큰()}",
        "appkey": 키,
        "appsecret": 시크릿,
        "tr_id": tr_id,
        "tr_cont": tr_cont,
        "custtype": "P",
    }
    마지막오류 = ""
    for 차례 in range(재시도):
        틈 = _최소간격 - (time.time() - _마지막호출)
        if 틈 > 0:
            time.sleep(틈)
        _마지막호출 = time.time()
        try:
            r = requests.get(f"{기준}{경로}", headers=머리, params=파라미터, timeout=20)
            본문 = r.json()
        except Exception as e:                                # noqa: BLE001
            마지막오류 = f"응답을 읽지 못했습니다: {e}"
            time.sleep(1.0 + 차례)
            continue
        코드 = str(본문.get("rt_cd", ""))
        if 코드 == "0":
            return 본문
        메시지 = str(본문.get("msg_cd", "")) + " " + str(본문.get("msg1", "")).strip()
        마지막오류 = 메시지
        if "EGW00201" in 메시지:                              # 초당 거래건수 초과
            time.sleep(0.6 * (차례 + 1))
            continue
        if "EGW00123" in 메시지 or "EGW00121" in 메시지:      # 토큰 만료·유효하지 않음
            토큰(강제=True)
            머리["authorization"] = f"Bearer {토큰()}"
            continue
        break
    raise KisError(f"{경로} ({tr_id}) 실패: {마지막오류}")


def _수(값: Any) -> float | None:
    """API 는 숫자를 문자열로 준다. 빈 문자열·0 은 '없음' 으로 본다."""
    try:
        f = float(str(값).replace(",", "").strip())
    except (TypeError, ValueError):
        return None
    return f or None


def _골라내기(행: dict[str, Any], *후보: str) -> float | None:
    """필드 이름이 문서와 다를 수 있어 후보를 순서대로 본다."""
    for k in 후보:
        if k in 행:
            v = _수(행[k])
            if v is not None:
                return v
    return None


# ---------------------------------------------------------------------------
# 국내
# ---------------------------------------------------------------------------
def 국내일봉(코드: str, 연수: int = 3) -> tuple[list[str], list[float], list[float]]:
    """수정주가 일봉. 한 번에 100건이라 날짜 창을 뒤로 밀며 모은다."""
    끝 = date.today()
    처음 = 끝 - timedelta(days=int(365.25 * 연수))
    모음: dict[str, tuple[float, float]] = {}
    while 끝 >= 처음:
        시작 = max(처음, 끝 - timedelta(days=140))            # 영업일 100개 ≈ 140일
        본문 = 부르기(
            "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
            "FHKST03010100",
            {
                "FID_COND_MRKT_DIV_CODE": "J",
                "FID_INPUT_ISCD": 코드,
                "FID_INPUT_DATE_1": 시작.strftime("%Y%m%d"),
                "FID_INPUT_DATE_2": 끝.strftime("%Y%m%d"),
                "FID_PERIOD_DIV_CODE": "D",
                "FID_ORG_ADJ_PRC": "0",                       # 0:수정주가
            },
        )
        행들 = [r for r in (본문.get("output2") or []) if r]
        if not 행들:
            break
        for r in 행들:
            일자 = str(r.get("stck_bsop_date", "")).strip()
            종 = _골라내기(r, "stck_clpr")
            if len(일자) == 8 and 종 is not None:
                모음[f"{일자[:4]}-{일자[4:6]}-{일자[6:]}"] = (종, _골라내기(r, "acml_vol") or 0.0)
        끝 = 시작 - timedelta(days=1)
    날짜 = sorted(모음)
    return 날짜, [모음[d][0] for d in 날짜], [모음[d][1] for d in 날짜]


def 국내현재가(코드: str) -> dict[str, Any]:
    본문 = 부르기(
        "/uapi/domestic-stock/v1/quotations/inquire-price",
        "FHKST01010100",
        {"FID_COND_MRKT_DIV_CODE": "J", "FID_INPUT_ISCD": 코드},
    )
    o = 본문.get("output") or {}
    return {
        "원문": o,
        "현재가": _골라내기(o, "stck_prpr"),
        "시가총액": _골라내기(o, "hts_avls"),                  # 억원
        "per": _골라내기(o, "per"),
        "pbr": _골라내기(o, "pbr"),
        "eps": _골라내기(o, "eps"),
        "bps": _골라내기(o, "bps"),
        "고가52주": _골라내기(o, "w52_hgpr"),
        "저가52주": _골라내기(o, "w52_lwpr"),
    }


def 국내수급(코드: str, 일수: int = 20) -> list[dict[str, Any]]:
    """종목별 투자자 순매수(개인·외국인·기관)를 최근 일수만큼. (2026-09-16 신설)

    한 번 부르면 **30일치**가 온다. 수량과 금액이 함께 온다.
    장 마감 직후에는 당일 줄이 비어 있다 — 집계 전이다. 빈 줄은 버린다.

    쓰는 곳: 네이버 금융이 2026-09 화면을 자바스크립트로 바꾸면서 수급 스크래핑이
    죽었다. 공시 API 로 옮긴다."""
    본문 = 부르기(
        "/uapi/domestic-stock/v1/quotations/inquire-investor",
        "FHKST01010900",
        {"FID_COND_MRKT_DIV_CODE": "J", "FID_INPUT_ISCD": 코드},
    )
    나온것: list[dict[str, Any]] = []
    for r in (본문.get("output") or []):
        일자 = str(r.get("stck_bsop_date", "")).strip()
        외 = _수(r.get("frgn_ntby_qty"))
        기 = _수(r.get("orgn_ntby_qty"))
        개 = _수(r.get("prsn_ntby_qty"))
        if len(일자) != 8 or (외 is None and 기 is None and 개 is None):
            continue                                  # 집계 전인 당일 줄
        나온것.append({
            "날짜": f"{일자[:4]}-{일자[4:6]}-{일자[6:]}",
            "종가": _수(r.get("stck_clpr")),
            "개인": 개 or 0.0, "외국인": 외 or 0.0, "기관": 기 or 0.0,
            "개인금액": _수(r.get("prsn_ntby_tr_pbmn")) or 0.0,
            "외국인금액": _수(r.get("frgn_ntby_tr_pbmn")) or 0.0,
            "기관금액": _수(r.get("orgn_ntby_tr_pbmn")) or 0.0,
        })
        if len(나온것) >= 일수:
            break
    return 나온것


def 수급요약(코드: str, 일수: int = 20) -> dict[str, Any]:
    """수급을 한 줄로 간추린다. 스크리너·보고서가 바로 쓰는 모양."""
    줄 = 국내수급(코드, 일수)
    if not 줄:
        return {"코드": 코드, "일수": 0, "메모": "수급 자료가 비었습니다"}
    def 합(이름): return sum(r[이름] for r in 줄)
    산날 = lambda 이름: sum(1 for r in 줄 if r[이름] > 0)
    return {
        "코드": 코드,
        "일수": len(줄),
        "기준일": 줄[0]["날짜"],
        "외국인순매수": 합("외국인"), "기관순매수": 합("기관"), "개인순매수": 합("개인"),
        "외국인순매수금액": 합("외국인금액"), "기관순매수금액": 합("기관금액"),
        "외국인산날": 산날("외국인"), "기관산날": 산날("기관"),
        "최근5일외국인": sum(r["외국인"] for r in 줄[:5]),
        "최근5일기관": sum(r["기관"] for r in 줄[:5]),
    }


# ---------------------------------------------------------------------------
# 해외
# ---------------------------------------------------------------------------
def _거래소캐시() -> dict[str, str]:
    if 거래소파일.exists():
        try:
            return json.loads(거래소파일.read_text(encoding="utf-8"))
        except Exception:                                     # noqa: BLE001
            pass
    return {}


def 거래소찾기(티커: str) -> str:
    """NAS·NYS·AMS 를 순서대로 찔러 보고 응답이 있는 곳을 기억한다."""
    캐시 = _거래소캐시()
    if 티커 in 캐시:
        return 캐시[티커]
    for 코드 in 미국거래소:
        try:
            본문 = 부르기(
                "/uapi/overseas-price/v1/quotations/price-detail",
                "HHDFS76200200",
                {"AUTH": "", "EXCD": 코드, "SYMB": 티커},
            )
        except KisError:
            continue
        o = 본문.get("output") or {}
        if _골라내기(o, "last", "base") is not None:
            캐시[티커] = 코드
            거래소파일.write_text(json.dumps(캐시, ensure_ascii=False), encoding="utf-8")
            return 코드
    raise KisError(f"{티커}: NAS·NYS·AMS 어디에서도 찾지 못했습니다.")


def 해외일봉(티커: str, 연수: int = 3, 거래소: str | None = None
           ) -> tuple[list[str], list[float], list[float]]:
    """기준일자(BYMD)를 뒤로 밀며 100건씩 모은다."""
    excd = 거래소 or 거래소찾기(티커)
    처음 = date.today() - timedelta(days=int(365.25 * 연수))
    기준 = date.today()
    모음: dict[str, tuple[float, float]] = {}
    for _ in range(40):                                       # 100건 × 40 = 넉넉함
        본문 = 부르기(
            "/uapi/overseas-price/v1/quotations/dailyprice",
            "HHDFS76240000",
            {"AUTH": "", "EXCD": excd, "SYMB": 티커,
             "GUBN": "0",                                     # 0:일 1:주 2:월
             "BYMD": 기준.strftime("%Y%m%d"),
             "MODP": "1"},                                    # 1:수정주가 반영
        )
        행들 = [r for r in (본문.get("output2") or []) if r]
        if not 행들:
            break
        가장오래된 = None
        for r in 행들:
            일자 = str(r.get("xymd", "")).strip()
            종 = _골라내기(r, "clos")
            if len(일자) != 8 or 종 is None:
                continue
            d = f"{일자[:4]}-{일자[4:6]}-{일자[6:]}"
            모음[d] = (종, _골라내기(r, "tvol") or 0.0)
            가장오래된 = d if 가장오래된 is None or d < 가장오래된 else 가장오래된
        if 가장오래된 is None:
            break
        다음 = date.fromisoformat(가장오래된) - timedelta(days=1)
        if 다음 < 처음 or 다음 >= 기준:
            break
        기준 = 다음
    날짜 = sorted(d for d in 모음 if d >= 처음.isoformat())
    return 날짜, [모음[d][0] for d in 날짜], [모음[d][1] for d in 날짜]


def 해외현재가(티커: str, 거래소: str | None = None) -> dict[str, Any]:
    excd = 거래소 or 거래소찾기(티커)
    본문 = 부르기(
        "/uapi/overseas-price/v1/quotations/price-detail",
        "HHDFS76200200",
        {"AUTH": "", "EXCD": excd, "SYMB": 티커},
    )
    o = 본문.get("output") or {}
    return {
        "원문": o,
        "거래소": excd,
        "현재가": _골라내기(o, "last", "base"),
        "시가총액": _골라내기(o, "tomv", "mcap"),
        "per": _골라내기(o, "perx"),
        "pbr": _골라내기(o, "pbrx"),
        "eps": _골라내기(o, "epsx"),
        "bps": _골라내기(o, "bpsx"),
        "고가52주": _골라내기(o, "h52p"),
        "저가52주": _골라내기(o, "l52p"),
    }


# ---------------------------------------------------------------------------
# 바깥에서 부르는 입구
# ---------------------------------------------------------------------------
def 해외종목인가(코드: str) -> bool:
    """내기록받기.py 와 같은 규칙 — 여섯 자리 숫자면 국내, 알파벳이 섞이면 해외."""
    코드 = 코드.strip()
    return not (len(코드) == 6 and 코드.isdigit())


def 받기(코드: str, 연수: int = 3) -> 시세:
    """국내·해외를 가려서 한 종목의 시세를 채운다. 실패는 메모에 남기고 계속 간다."""
    해외 = 해외종목인가(코드)
    out = 시세(코드=코드, 해외=해외)
    try:
        if 해외:
            out.거래소 = 거래소찾기(코드)
            out.날짜, out.종가, out.거래량 = 해외일봉(코드, 연수, out.거래소)
        else:
            out.날짜, out.종가, out.거래량 = 국내일봉(코드, 연수)
    except KisError as e:
        out.메모.append(f"일봉 실패: {e}")

    try:
        현 = 해외현재가(코드, out.거래소) if 해외 else 국내현재가(코드)
        for 이름 in ("현재가", "시가총액", "per", "pbr", "eps", "bps", "고가52주", "저가52주"):
            setattr(out, 이름, 현.get(이름))
        빈칸 = [이름 for 이름 in ("시가총액", "per", "pbr") if 현.get(이름) is None]
        if 빈칸:
            out.메모.append(
                f"{'·'.join(빈칸)} 가 비었습니다. 응답 필드 이름이 다를 수 있습니다 — "
                f"`python3 -m src.kis 점검 {코드}` 로 원문을 확인하십시오."
            )
    except KisError as e:
        out.메모.append(f"현재가 실패: {e}")

    if out.종가 and out.현재가 is None:
        out.현재가 = out.종가[-1]
    return out


# ---------------------------------------------------------------------------
# 점검 — 응답 원문을 그대로 찍는다. 필드 이름을 눈으로 대조하기 위한 것.
# ---------------------------------------------------------------------------
def 점검(코드: str) -> None:
    해외 = 해외종목인가(코드)
    print(f"■ {코드} — {'해외' if 해외 else '국내'}")
    try:
        키, _, 기준 = 설정()
        print(f"  앱키 …{키[-6:]} · {기준}")
        print(f"  토큰 {'있음' if 토큰() else '없음'}")
    except KisError as e:
        print(f"  ✗ {e}")
        return

    print("\n--- 현재가 응답 원문 ---")
    try:
        현 = 해외현재가(코드) if 해외 else 국내현재가(코드)
        for k, v in sorted(현["원문"].items()):
            print(f"  {k:<20} {v}")
        print("\n--- 뽑아낸 값 ---")
        for k, v in 현.items():
            if k != "원문":
                print(f"  {k:<10} {v}")
    except KisError as e:
        print(f"  ✗ {e}")

    print("\n--- 일봉 ---")
    try:
        날짜, 종가, 거래량 = 해외일봉(코드) if 해외 else 국내일봉(코드)
        if 날짜:
            print(f"  {len(날짜)}건 · {날짜[0]} ~ {날짜[-1]}")
            print(f"  마지막 종가 {종가[-1]:,.2f} · 거래량 {거래량[-1]:,.0f}")
        else:
            print("  0건 — 필드 이름이나 거래소 코드를 확인해야 합니다.")
    except KisError as e:
        print(f"  ✗ {e}")


if __name__ == "__main__":
    import sys
    인자 = sys.argv[1:]
    if len(인자) >= 2 and 인자[0] == "점검":
        점검(인자[1])
    else:
        print(__doc__)
        print("쓰는 법:  python3 -m src.kis 점검 <종목코드|티커>")
