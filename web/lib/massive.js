// 2026-11-05: Paid Massive requests replaced with locally cached Yahoo daily observations.
// Compatibility exports for the existing screens; data now comes from local daily collection.
import {dailyBars, marketDay, closedUsDate} from './local-market.mjs'
export const usKey = () => null
export const hasUS = () => true

/* 미국장이 열렸던 마지막 날 (한국 시간 기준으로 계산)
   미국 종가는 한국 시간 다음 날 아침에 확정되므로 넉넉히 하루 뺍니다. */
export function lastUsDay(offset = 0) {
 const d=new Date(closedUsDate()+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-offset);
 while([0,6].includes(d.getUTCDay()))d.setUTCDate(d.getUTCDate()-1);
 return d.toISOString().slice(0,10)
}

/* 흔한 ETF·상장지수상품 — 개별 성장주가 아니라 화면에서 뺍니다.
   (무료 등급에는 종목 분류 정보가 없어서 이름으로 거릅니다) */
const ETF = new Set(`SPY QQQ IVV VOO VTI VEA VWO IEFA IEMR AGG BND TLT IEF SHY LQD HYG
IWM DIA MDY EFA EEM GLD SLV USO UNG XLF XLK XLE XLV XLI XLY XLP XLU XLB XLRE XLC
SMH SOXX SOXL SOXS TQQQ SQQQ UPRO SPXU TNA TZA UVXY VXX SVXY LABU LABD
ARKK ARKG ARKW ARKQ ARKF JEPI JEPQ SCHD VIG VYM DVY QYLD RYLD XYLD
BITO IBIT FBTC GBTC ETHE ARKB BITB HODL BRRR EZBC BTCO
VGT VUG VTV VO VB VXUS BNDX MUB TIP VCIT VCSH GOVT
FNGU FNGD NVDL TSLL TSLQ MSTU MSTX CONL AMDL BOIL KOLD JNUG DUST NUGT
RSP SPLG SPYG SPYV IJH IJR ITOT SPTM SCHX SCHB SCHG SCHA
EWJ EWZ EWY EWT FXI MCHI KWEB INDA EWG EWU EWC EWA
IYR VNQ SCHH REM PFF SPHD NOBL SDY`.trim().split(/\s+/))

/* 종목처럼 보이는 기호만 (워런트·우선주·클래스 표기는 뺍니다) */
const PLAIN = /^[A-Z]{1,5}$/

/**
 * 하루치 미국 전 종목 시세.
 * @returns { day, rows:[{sym,o,h,l,c,v,rate,amt}], total }
 */
export async function fetchUsDay(day=lastUsDay()) { return marketDay(day) }

/** 개별 성장주만 남기기 (ETF·초저가·거래 한산 종목 제외) */
export function plainStocks(rows, { minPrice = 5, minAmt = 2e7 } = {}) {
  return rows.filter((r) => PLAIN.test(r.sym) && !ETF.has(r.sym)
    && r.c >= minPrice && r.amt >= minAmt)
}

/**
 * 시장 폭 — 오른 종목 / 내린 종목.
 * 미국은 외국인·기관 수급을 공표하지 않습니다. 대신 이 숫자가
 * '얼마나 넓게 오르고 있는가' 를 보여 줍니다 (미너비니가 보는 지표이기도 합니다).
 */
export function breadth(rows) {
  let up = 0; let down = 0; let flat = 0
  for (const r of rows) {
    if (r.rate == null) continue
    if (r.rate > 0) up++
    else if (r.rate < 0) down++
    else flat++
  }
  return { up, down, flat, ratio: down ? Math.round((up / down) * 100) / 100 : null }
}

/* ── 업종 ────────────────────────────────────────────────
   무료 등급 목록에는 업종이 없습니다. 종목마다 따로 물어봐야 하는데
   분당 5회 제한이라 120종목이면 24분이 걸립니다 — 화면에 쓸 수 없습니다.
   그래서 거래대금 상위에 늘 올라오는 큰 종목들은 표로 갖고 있습니다.
   여기 없는 종목은 '기타' 로 묶입니다.                                */
const SEC = {
  기술: `AAPL MSFT NVDA AVGO AMD INTC QCOM TXN MU ADI AMAT LRCX KLAC ASML TSM ARM
    ORCL CRM ADBE NOW INTU PANW CRWD ZS OKTA SNOW DDOG MDB NET PLTR SMCI DELL HPQ HPE
    ANET CSCO IBM ACN INFY WDC STX SNPS CDNS MRVL ON NXPI SWKS MPWR TER ENTG COHR
    APH GLW MSI KEYS FTNT S CIEN LITE APP U TTD ZM DOCU TEAM WDAY VEEV HUBS
    SHOP SQ PYPL FI FIS GPN ADSK ANSS PTC TYL EPAM CTSH IT GDDY VRSN AKAM
    QBTS IONQ RGTI BBAI SOUN AI PATH`,
  통신서비스: `GOOGL GOOG META NFLX DIS CMCSA T VZ TMUS CHTR WBD PARA EA TTWO RBLX
    SPOT SNAP PINS MTCH LYV OMC IPG NWSA FOXA`,
  경기소비재: `AMZN TSLA HD LOW MCD SBUX NKE TJX BKNG ABNB MAR HLT CMG ORLY AZO
    ROST DHI LEN PHM NVR GM F RIVN LCID F TM HMC RACE LULU DECK CROX SKX ONON
    DKNG CZR MGM LVS WYNN RCL CCL NCLH UAL DAL AAL LUV EXPE UBER LYFT DASH
    YUM DPZ DRI QSR WEN CAVA SHAK EBAY ETSY W CHWY BABA JD PDD NIO XPEV LI`,
  필수소비재: `WMT COST PG KO PEP PM MO PEP CL KMB GIS K HSY SYY KR TGT DG DLTR
    STZ TAP MNST KDP CELH ADM BG TSN HRL CAG CPB SJM MKC CHD CLX EL COTY`,
  헬스케어: `LLY JNJ UNH ABBV MRK PFE TMO ABT DHR AMGN BMY GILD CVS CI ELV MDT
    ISRG VRTX REGN MRNA BNTX BIIB ZTS SYK BSX EW BDX BAX HCA MCK COR CAH
    IDXX IQV A WAT MTD RMD DXCM PODD ALNY INCY NBIX SRPT RARE VKTX ALT HIMS
    OSCR CRSP NTLA BEAM EDIT SANA VERV TEM`,
  금융: `BRK-B JPM BAC WFC C GS MS SCHW BLK BX KKR APO ARES SPGI MCO ICE CME
    NDAQ CBOE V MA AXP COF DFS SYF ALLY PNC USB TFC MTB FITB HBAN RF KEY CFG
    AIG MET PRU AFL ALL TRV PGR CB HIG L WRB CINF ACGL RJF NTRS STT BK
    HOOD COIN SOFI UPST AFRM LMND`,
  산업재: `GE CAT DE HON RTX LMT NOC GD BA LHX TDG HWM ETN EMR ITW PH ROK CMI
    PCAR WM RSG UNP CSX NSC FDX UPS DAL JCI CARR OTIS TT IR DOV XYL AME
    URI FAST GWW PWR EME J ACM MAS BLDR VMC MLM NVT GEV VRT SYM RKLB LUNR
    ASTS ACHR JOBY LDOS BAH CACI`,
  에너지: `XOM CVX COP EOG SLB PSX MPC VLO OXY HES DVN FANG PXD HAL BKR WMB
    OKE KMI LNG TRGP ET EPD MPLX CTRA APA MRO NOV RIG TDW FTI`,
  유틸리티: `NEE DUK SO D AEP EXC SRE XEL ED PEG WEC ES AEE DTE PPL CMS CNP
    FE AES NRG VST CEG PCG EIX ATO NI LNT EVRG`,
  부동산: `PLD AMT EQIX CCI SPG O DLR PSA WELL VICI AVB EQR ESS MAA UDR
    INVH AMH ARE BXP VTR IRM WY SBAC EXR CBRE`,
  소재: `LIN APD SHW ECL FCX NEM NUE STLD CLF X AA DOW DD LYB PPG IFF ALB
    MOS CF FMC VMC MLM PKG IP BALL AMCR SMG`,
}

/* 위 표를 뒤집어 '종목 → 업종' 으로 */
const SEC_OF = (() => {
  const m = {}
  for (const [name, list] of Object.entries(SEC))
    for (const t of list.trim().split(/\s+/)) if (t) m[t] = name
  return m
})()

/** 종목의 업종 (모르면 '기타') */
export const sectorOf = (sym) => SEC_OF[sym] || '기타'

/* ── 지수 차트용 일봉 ──────────────────────────────────────
   무료 등급에는 '지수' 자체의 과거값이 없습니다(지수는 별도 상품입니다).
   대신 지수를 그대로 따라가는 대표 ETF 의 일봉을 씁니다 —
   S&P500은 SPY, 나스닥100은 QQQ, 다우는 DIA. 모양은 사실상 같습니다.
   한 종목의 기간 전체를 한 번에 주므로 호출이 세 번이면 됩니다. */
export const IDX_PROXY = [
  { name: 'S&P500', sym: 'SPY' },
  { name: '나스닥', sym: 'QQQ' },
  { name: '다우', sym: 'DIA' },
]

export async function fetchTickerDaily(sym,days=90) {
 return (await dailyBars(sym,days)).map(x=>({t:Date.parse(x.d.slice(0,4)+'-'+x.d.slice(4,6)+'-'+x.d.slice(6,8)+'T12:00:00Z'),c:x.c}))
}

/**
 * 미국 종목 하나의 일봉 (시가·고가·저가·종가·거래량).
 *  2026-08-23 추가 — /api/ohlcv 가 미국 종목 차트를 그리려고 씁니다.
 *  fetchTickerDaily 는 종가만 돌려주도록 만들어 둔 것이라 봉 차트에는 못 씁니다.
 *  같은 창구(v2/aggs)라 요청 수는 그대로이고, 받는 값만 다 씁니다.
 *
 *  ⚠️ 무료 등급은 **분당 5회** 입니다. 그래서 /api/ohlcv 쪽에서 12시간 담아 둡니다.
 *  @returns [{d:'YYYYMMDD', o,h,l,c,v}]   ← lib/naver.js 의 fetchOhlcv 와 같은 모양
 */
export async function fetchUsOhlcv(sym,bars=420) { return dailyBars(sym,bars) }

/** 며칠 전 대비 수익률 (%) */
export function retOver(closes, n) {
  if (!closes || closes.length <= n) return null
  const a = closes[closes.length - 1]
  const b = closes[closes.length - 1 - n]
  if (!b) return null
  return Math.round(((a - b) / b) * 10000) / 100
}
