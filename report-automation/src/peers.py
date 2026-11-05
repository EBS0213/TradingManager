"""
피어그룹 선정
-------------
기준 (인수인계 메모 '다음에 할 일' 4번에 대한 답):

  1) 같은 업종일 것            — KRX 표준산업분류 / FDR 업종 정보
  2) 시가총액이 0.25 ~ 4배 대역 — 규모가 10배 차이 나면 밸류에이션 배수가 안 붙는다
  3) 매출 규모 0.2 ~ 5배 대역
  4) 위 조건을 만족하는 것 중 시가총액이 대상과 가까운 순으로 최대 6개

자동 선정이 실패하거나 마음에 안 들면 config.yaml 에 직접 적는다.
직접 적은 피어가 있으면 그쪽이 항상 우선한다. (해외 피어는 자동으로 못 잡으니 직접 적는다)
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, timedelta


@dataclass
class Peer:
    code: str
    name: str
    market_cap: float | None = None
    per: float | None = None
    pbr: float | None = None
    sector: str | None = None
    revenue: float | None = None


@dataclass
class PeerGroup:
    target_code: str
    target_name: str
    sector: str | None = None
    peers: list[Peer] = field(default_factory=list)
    method: str = ""
    notes: list[str] = field(default_factory=list)


def _listing():
    """상장사 목록 + 업종. FDR 버전마다 컬럼이 달라서 여러 이름을 다 시도한다."""
    import FinanceDataReader as fdr
    last_err = None
    for key in ("KRX-DESC", "KRX"):
        try:
            df = fdr.StockListing(key)
            if df is not None and not df.empty:
                return df
        except Exception as e:                    # noqa: BLE001
            last_err = e
    raise RuntimeError(f"상장사 목록을 받지 못했습니다: {last_err}")


def _col(df, *candidates):
    for c in candidates:
        if c in df.columns:
            return c
    return None


def build_peer_group(target_code: str, target_name: str = "",
                     manual: list[str] | None = None,
                     max_peers: int = 6) -> PeerGroup:
    target_code = str(target_code).zfill(6)
    pg = PeerGroup(target_code=target_code, target_name=target_name or target_code)

    # --- 1. 직접 지정한 피어가 있으면 그것만 쓴다 ---------------------------
    if manual:
        pg.method = "config.yaml 에 직접 지정"
        for item in manual:
            code = str(item).strip()
            if code.isdigit():
                pg.peers.append(Peer(code=code.zfill(6), name=code.zfill(6)))
            else:                                  # "005930 삼성전자" 또는 해외 피어명
                parts = code.split(maxsplit=1)
                if parts[0].isdigit():
                    pg.peers.append(Peer(code=parts[0].zfill(6),
                                         name=parts[1] if len(parts) > 1 else parts[0]))
                else:
                    pg.peers.append(Peer(code="", name=code))
        _enrich(pg)
        return pg

    # --- 2. 자동 선정 -----------------------------------------------------
    try:
        df = _listing()
        c_code = _col(df, "Code", "Symbol")
        c_name = _col(df, "Name")
        c_sector = _col(df, "Sector", "Industry", "업종")
        c_cap = _col(df, "Marcap", "MarketCap", "시가총액")

        if c_code is None or c_name is None:
            raise RuntimeError("상장사 목록에 Code/Name 컬럼이 없습니다")
        df[c_code] = df[c_code].astype(str).str.zfill(6)
        row = df[df[c_code] == target_code]
        if row.empty:
            raise RuntimeError(f"{target_code} 를 상장사 목록에서 찾지 못했습니다")
        row = row.iloc[0]
        pg.target_name = target_name or str(row[c_name])
        sector = str(row[c_sector]) if c_sector else None
        pg.sector = sector

        cand = df
        if c_sector and sector and sector.lower() != "nan":
            cand = df[df[c_sector] == sector]
        cand = cand[cand[c_code] != target_code]

        caps = _market_caps([str(c) for c in cand[c_code].tolist()])
        my_cap = _market_caps([target_code]).get(target_code)

        scored = []
        for _, r in cand.iterrows():
            code = str(r[c_code])
            cap = caps.get(code) or (float(r[c_cap]) if c_cap and r.get(c_cap) else None)
            if my_cap and cap:
                ratio = cap / my_cap
                if not (0.25 <= ratio <= 4.0):
                    continue
                scored.append((abs(1 - ratio), Peer(code=code, name=str(r[c_name]),
                                                    market_cap=cap, sector=sector)))
            elif cap:
                scored.append((1e9, Peer(code=code, name=str(r[c_name]),
                                         market_cap=cap, sector=sector)))
        scored.sort(key=lambda t: t[0])
        pg.peers = [p for _, p in scored[:max_peers]]
        pg.method = (f"업종 '{sector}' 내 시가총액 0.25~4배 대역, 규모 근접 상위 {max_peers}개"
                     if sector else "시가총액 근접 상위")
        if not pg.peers:
            pg.notes.append("조건을 만족하는 국내 피어가 없습니다. config.yaml 에 직접 지정하세요.")
    except Exception as e:                          # noqa: BLE001
        pg.notes.append(f"자동 피어 선정 실패: {e}. config.yaml 의 peers 에 직접 적어주세요.")
        pg.method = "실패"

    _enrich(pg)
    return pg


def _market_caps(codes: list[str]) -> dict[str, float]:
    out: dict[str, float] = {}
    try:
        from pykrx import stock as krx
        today = date.today()
        for back in range(0, 10):
            d = (today - timedelta(days=back)).strftime("%Y%m%d")
            df = krx.get_market_cap_by_ticker(d)
            if df is not None and not df.empty:
                for code in codes:
                    if code in df.index:
                        out[code] = float(df.loc[code, "시가총액"])
                break
    except Exception:                               # noqa: BLE001
        pass
    return out


def _enrich(pg: PeerGroup) -> None:
    """피어의 PER·PBR·시가총액을 채운다 (pykrx 가 있을 때만)."""
    codes = [p.code for p in pg.peers if p.code] + [pg.target_code]
    if not codes:
        return
    try:
        from pykrx import stock as krx
        today = date.today()
        fund = cap = None
        for back in range(0, 10):
            d = (today - timedelta(days=back)).strftime("%Y%m%d")
            fund = krx.get_market_fundamental_by_ticker(d)
            cap = krx.get_market_cap_by_ticker(d)
            if fund is not None and not fund.empty:
                break
        for p in pg.peers:
            if p.code and fund is not None and p.code in fund.index:
                p.per = float(fund.loc[p.code, "PER"]) or None
                p.pbr = float(fund.loc[p.code, "PBR"]) or None
            if p.code and cap is not None and p.code in cap.index:
                p.market_cap = float(cap.loc[p.code, "시가총액"])
    except Exception as e:                          # noqa: BLE001
        pg.notes.append(f"피어 밸류에이션 수집 건너뜀({e}). `pip install pykrx` 하면 채워집니다.")


def peer_price_series(pg: PeerGroup, days: int = 365) -> tuple[list[str], dict[str, list[float]]]:
    """피어 상대주가 차트용 시계열"""
    import FinanceDataReader as fdr
    start = (date.today() - timedelta(days=days)).isoformat()
    out: dict[str, list[float]] = {}
    dates: list[str] = []
    for code, name in ([(pg.target_code, pg.target_name)] +
                       [(p.code, p.name) for p in pg.peers if p.code]):
        try:
            df = fdr.DataReader(code, start).dropna(subset=["Close"])
            if df.empty:
                continue
            if not dates:
                dates = [d.strftime("%Y-%m-%d") for d in df.index]
            out[name] = [float(v) for v in df["Close"]]
        except Exception:                           # noqa: BLE001
            continue
    n = min([len(v) for v in out.values()] or [0])
    out = {k: v[-n:] for k, v in out.items()}
    return dates[-n:], out
