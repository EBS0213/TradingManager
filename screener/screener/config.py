# -*- coding: utf-8 -*-
"""
설정값 모음.

여기 숫자만 바꾸면 스크리닝 기준이 바뀝니다. 코드는 건드릴 필요 없습니다.
config.yaml 파일이 옆에 있으면 그 값이 우선 적용됩니다.
"""
from __future__ import annotations
import os
from dataclasses import dataclass, field, asdict

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, 'data')      # 주가 캐시가 쌓이는 곳
OUT_DIR = os.path.join(BASE_DIR, 'output')     # 대시보드 결과물
LOG_DIR = os.path.join(BASE_DIR, 'logs')
for _d in (DATA_DIR, OUT_DIR, LOG_DIR):
    os.makedirs(_d, exist_ok=True)


@dataclass
class Settings:
    # ── 데이터 공급원 ────────────────────────────────────────────
    data_source: str = 'auto'          # auto / naver / pykrx

    # 업종 분류: krx(표준산업분류·권장) / naver(FnGuide 계열) / both
    sector_source: str = 'krx'

    # ── 대상 시장 ────────────────────────────────────────────────
    markets: list = field(default_factory=lambda: ['KOSPI', 'KOSDAQ'])

    # ── Trend Template 8개 조건 (미너비니 원문 기준) ──────────────
    ma_short: int = 50                 # ⑤ 50일 이동평균
    ma_mid: int = 150                  # ① 150일 이동평균
    ma_long: int = 200                 # ① 200일 이동평균
    ma_long_lookback: int = 20         # ③ 200일선 상승 판단: 20거래일 전과 비교
    above_52w_low: float = 1.30        # ⑥ 52주 최저가 대비 +30% 이상
    below_52w_high: float = 0.75       # ⑦ 52주 최고가 대비 -25% 이내
    rs_min: int = 70                   # ⑧ RS 순위 70 이상

    # ── 스크리닝 대상에서 제외할 종목 ─────────────────────────────
    min_price: int = 1000              # 동전주 제외
    min_trade_value: int = 500_000_000 # 20일 평균 거래대금 5억 미만 제외
    exclude_spac: bool = True          # 스팩(SPAC) 제외
    exclude_etf_etn: bool = True       # ETF·ETN·리츠 제외
    exclude_admin: bool = True         # 관리종목·투자경고 제외
    min_history_days: int = 220        # 상장 1년 미만 제외 (200일선 계산 불가)
    keep_days: int = 0                 # 일봉을 며칠치까지 남길까 (0 = 안 자름)
                                       #  2026-08-30: 전에는 640일 이전을 매번
                                       #  지웠습니다. 배점 검증 백테스트가 과거를
                                       #  못 보게 만드는 원인이라 기본을 '안 자름'
                                       #  으로 바꿨습니다. 파일이 4배쯤 커집니다
                                       #  (122만 줄 → 408만 줄, 그래도 수십 MB).

    # ── 실적 조건 (통과 종목만 추가 확인) ─────────────────────────
    use_fundamentals: bool = True
    eps_growth_min: float = 0.20       # 직전 분기 EPS 증가율 20% 이상
    sales_growth_min: float = 0.15     # 직전 분기 매출 증가율 15% 이상
    fundamentals_as_filter: bool = True    # True=탈락시킴 / False=표시만
    pass_when_unknown: bool = True     # 실적을 못 가져온 종목은 일단 통과시킴

    # ── 수급 / 매집 ──────────────────────────────────────────────
    accumulation_days: int = 50        # UD비율·매집일을 볼 기간(거래일)
    # 수급·실적을 몇 개 조건 이상 통과한 종목까지 확인할지.
    # 8 이면 통과 종목만, 6 이면 표에 그려지는 6·7개 통과 종목까지 함께 봅니다.
    # 낮출수록 확인할 종목이 늘어 스크리닝 시간이 길어집니다.
    # 2026-08-26: 6 → 0. 조건을 하나도 못 채운 종목까지 실적·수급을 채웁니다.
    #  "지금은 자리가 아니어도 회사는 어떤지 보고 싶다" 는 요청.
    #  전 종목을 매번 받으면 네이버가 막으므로 slowcache.py 가 받아 둔 것을 씁니다
    #  (실적 90일 · 수급 1일). 첫 실행만 오래 걸립니다.
    extra_min_conds: int = 0
    use_supply: bool = True            # 외국인·기관 수급 확인 (한국 시장 전용)
    supply_as_filter: bool = False     # True=외인·기관 동반 이탈이면 탈락 / False=표시만

    # ── 진입 참고 ────────────────────────────────────────────────
    max_stop_pct: float = 0.08         # 손절가 제안 시 최대 손절폭 (미너비니 8%)

    # ── 차트 ─────────────────────────────────────────────────────
    spark_days: int = 60               # 결과 파일에 담을 주가 이력 일수 (0이면 안 담음)
    spark_only_candidates: bool = True # True면 7개 이상 통과·관심종목만 (파일 크기 절약)

    # ── VCP 참고 지표 (필터 아님, 표시용) ────────────────────────
    vcp_base_weeks: int = 8            # 최근 8주를 베이스로 보고 수축 여부 관찰
    vcp_tight_pct: float = 0.10        # 마지막 수축폭 10% 이내면 '타이트'

    # ── 실행 ─────────────────────────────────────────────────────
    market_open: str = '09:00'
    market_close: str = '15:30'
    only_during_market: bool = False   # True면 장중에만 실행 (장 끝나면 그냥 종료)
    max_workers: int = 12              # 동시 접속 수 (너무 올리면 차단됩니다)
    request_delay: float = 0.10        # 요청 사이 쉬는 시간(초) — 서버 배려

    def to_dict(self):
        return asdict(self)


def load() -> Settings:
    """config.yaml 이 있으면 덮어쓴다."""
    s = Settings()
    path = os.path.join(BASE_DIR, 'config.yaml')
    if not os.path.exists(path):
        return s
    try:
        import yaml
        with open(path, encoding='utf-8') as f:
            user = yaml.safe_load(f) or {}
        for k, v in user.items():
            if hasattr(s, k):
                setattr(s, k, v)
            else:
                print(f'[설정] 알 수 없는 항목은 무시합니다: {k}')
    except ImportError:
        print('[설정] pyyaml 이 없어 config.yaml 을 건너뜁니다. 기본값으로 실행합니다.')
    except Exception as e:
        print(f'[설정] config.yaml 을 읽지 못했습니다({e}). 기본값으로 실행합니다.')
    return s
