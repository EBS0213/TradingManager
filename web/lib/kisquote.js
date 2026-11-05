// ============================================================
//  한국투자증권 — 국내 시세
//
//  lib/naver.js 와 **같은 모양으로** 돌려줍니다. 부르는 쪽(app/api/market,
//  app/api/ohlcv)이 출처만 바꿔 끼울 수 있게 하려는 것입니다.
//  한국투자증권이 안 되면 네이버로 되돌아갑니다.
//
//  자리표(FID) 값은 공식 예제(koreainvestment/open-trading-api)에서 그대로
//  가져왔습니다. 눈대중으로 채운 값이 하나도 없습니다.
// ============================================================

import { kis, kisList, kisAll, num, signOf } from '@/lib/kis'

const Q = '/uapi/domestic-stock/v1/quotations'
const R = '/uapi/domestic-stock/v1/ranking'

/* 업종코드 — 코스피 0001 · 코스닥 1001 · 코스피200 2001 */
const IDX = { KOSPI: '0001', KOSDAQ: '1001' }
/* 투자자 매매동향에서 쓰는 시장 이름 */
const MKT = { KOSPI: 'KSP', KOSDAQ: 'KSQ' }

/* 순위표에서 뺄 것들 — 10자리, 자리마다 1이면 뺍니다.
   투자위험·관리·정리매매·불성실공시·우선주·거래정지·ETF·ETN·신용불가·스팩 차례.
   ⚠️ 지금은 전부 0(안 뺌)으로 두고 isPlainStock() 으로 거릅니다.
      실제 응답을 보고 확인한 뒤에 '0000101101' 로 바꿀 생각입니다. */
const EXCLS = '0000000000'

const ymd = (d) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
const kstNow = () => new Date(Date.now() + 9 * 3600 * 1000)

// ── 지수 ─────────────────────────────────────────────────

/** 코스피·코스닥 현재 지수. lib/naver.js 의 fetchIndex() 와 같은 모양입니다. */
export async function fetchIndexKis(code) {
  const iscd = IDX[code]
  if (!iscd) throw new Error(`모르는 지수입니다 (${code})`)
  const { body } = await kis(`${Q}/inquire-index-price`, 'FHPUP02100000', {
    fid_cond_mrkt_div_code: 'U',
    fid_input_iscd: iscd,
  })
  const o = body.output || {}
  const price = num(o.bstp_nmix_prpr)
  const diff = num(o.bstp_nmix_prdy_vrss) * (signOf(o.prdy_vrss_sign) || 1)

  return {
    code,
    name: code === 'KOSPI' ? '코스피' : '코스닥',
    price,
    diff: Number.isFinite(diff) ? diff : null,
    rate: num(o.bstp_nmix_prdy_ctrt),
    prevClose: (price != null && Number.isFinite(diff)) ? price - diff : null,
    high: num(o.bstp_nmix_hgpr),
    low: num(o.bstp_nmix_lwpr),
    open: num(o.bstp_nmix_oprc),
    // 거래량은 천주, 거래대금은 백만원으로 옵니다 (네이버와 맞춥니다)
    volume: num(o.acml_vol) == null ? null : num(o.acml_vol) * 1000,
    value: num(o.acml_tr_pbmn) == null ? null : num(o.acml_tr_pbmn) * 1e6,
    state: null,
    at: null,
    // 연중 고가·저가는 네이버에 없던 값입니다 (화면에서 쓰면 좋습니다)
    yearHigh: num(o.dryy_bstp_nmix_hgpr),
    yearLow: num(o.dryy_bstp_nmix_lwpr),
  }
}

/** 지수 장중 흐름 (1분봉). fetchIndexSeries() 와 같은 모양. */
export async function fetchIndexSeriesKis(code) {
  const iscd = IDX[code]
  if (!iscd) throw new Error(`모르는 지수입니다 (${code})`)
  const { body } = await kis(`${Q}/inquire-time-indexchartprice`, 'FHKUP03500200', {
    fid_cond_mrkt_div_code: 'U',
    fid_etc_cls_code: '0',
    fid_input_iscd: iscd,
    fid_input_hour_1: '60',        // 60 = 1분
    fid_pw_data_incu_yn: 'N',      // 당일치만
  })
  const arr = Array.isArray(body.output2) ? body.output2 : []
  /* 응답은 최근이 앞입니다 — 뒤집어서 시간 순으로 만듭니다 */
  const points = arr.slice().reverse().map((p) => {
    const h = String(p.stck_cntg_hour || '').padStart(6, '0')
    return { t: `${h.slice(0, 2)}:${h.slice(2, 4)}`, v: num(p.bstp_nmix_prpr) }
  }).filter((p) => p.v != null)
  return { kind: 'intraday', points }
}

/** 지수의 등락 종목 수 · 거래량 · 투자자 수급. fetchMarketDetail() 과 같은 모양. */
export async function fetchMarketDetailKis(code) {
  const iscd = IDX[code]
  if (!iscd) throw new Error(`모르는 지수입니다 (${code})`)

  const [idx, flow] = await Promise.all([
    kis(`${Q}/inquire-index-price`, 'FHPUP02100000',
      { fid_cond_mrkt_div_code: 'U', fid_input_iscd: iscd }),
    fetchInvestorFlowKis(code).catch(() => ({})),
  ])
  const o = idx.body.output || {}

  return {
    flow,
    updown: {
      up: num(o.ascn_issu_cnt), flat: num(o.stnr_issu_cnt), down: num(o.down_issu_cnt),
      upper: num(o.uplm_issu_cnt), lower: num(o.lslm_issu_cnt),
    },
    volume: num(o.acml_vol) == null ? null : num(o.acml_vol) * 1000,
    value: num(o.acml_tr_pbmn) == null ? null : num(o.acml_tr_pbmn) * 1e6,
    open: num(o.bstp_nmix_oprc), high: num(o.bstp_nmix_hgpr), low: num(o.bstp_nmix_lwpr),
    high52: null, low52: null,
    // 네이버에 없던 값 — 연중 고가·저가
    yearHigh: num(o.dryy_bstp_nmix_hgpr), yearLow: num(o.dryy_bstp_nmix_lwpr),
  }
}

/* 시장별 투자자 순매수 (개인·외국인·기관), 단위 억원.
   ⚠️ 한국투자증권이 내려주는 단위를 아직 실물로 확인하지 못했습니다.
      백만원으로 보고 억원으로 바꿉니다 — 화면 숫자가 100배 어긋나면
      여기 UNIT 만 고치면 됩니다. */
const FLOW_UNIT = 1 / 100        // 백만원 → 억원

export async function fetchInvestorFlowKis(code) {
  const iscd = IDX[code]
  const d = ymd(kstNow())
  const { body } = await kis(`${Q}/inquire-investor-daily-by-market`, 'FHPTJ04040000', {
    fid_cond_mrkt_div_code: 'U',
    fid_input_iscd: iscd,
    fid_input_date_1: d,
    fid_input_iscd_1: MKT[code],
    fid_input_date_2: d,
    fid_input_iscd_2: iscd,
  })
  /* 오늘치가 아직 없으면(장 전) 가장 최근 줄을 씁니다 */
  const arr = Array.isArray(body.output) ? body.output
    : Array.isArray(body.output1) ? body.output1 : []
  const r = arr[0] || {}
  const v = (x) => (num(x) == null ? null : Math.round(num(x) * FLOW_UNIT))
  return {
    개인: v(r.prsn_ntby_tr_pbmn),
    외국인: v(r.frgn_ntby_tr_pbmn),
    기관: v(r.orgn_ntby_tr_pbmn),
  }
}

// ── 순위표 ───────────────────────────────────────────────

/** 시가총액 상위. fetchMarketSum() 과 같은 모양 ({code,name,market,price,rate,marcap,volume,amount}) */
export async function fetchMarketSumKis(market, max = 120) {
  const rows = await kisList(`${R}/market-cap`, 'FHPST01740000', {
    fid_cond_mrkt_div_code: 'J',
    fid_cond_scr_div_code: '20174',
    fid_div_cls_code: '1',                 // 1 = 보통주만 (우선주를 아예 안 받습니다)
    fid_input_iscd: market === 'KOSDAQ' ? '1001' : '0001',
    fid_trgt_cls_code: '0',
    fid_trgt_exls_cls_code: '0',
    fid_input_price_1: '', fid_input_price_2: '', fid_vol_cnt: '',
  }, { max })

  return rows.map((r) => {
    const price = num(r.stck_prpr)
    const volume = num(r.acml_vol)
    return {
      code: String(r.mksc_shrn_iscd || '').padStart(6, '0'),
      name: String(r.hts_kor_isnm || '').trim(),
      market: market === 'KOSDAQ' ? 'KOSDAQ' : 'KOSPI',
      price,
      rate: num(r.prdy_ctrt),
      marcap: num(r.stck_avls),            // 억원 — 네이버와 같은 단위입니다
      volume,
      amount: (price != null && volume != null) ? price * volume : null,
    }
  }).filter((r) => r.code && r.price != null)
}

/** 등락률 상위. fetchRise() 와 같은 모양. */
export async function fetchRiseKis(market, max = 60) {
  const rows = await kisList(`${R}/fluctuation`, 'FHPST01700000', {
    fid_cond_mrkt_div_code: 'J',
    fid_cond_scr_div_code: '20170',
    fid_input_iscd: market === 'KOSDAQ' ? '1001' : '0001',
    fid_rank_sort_cls_code: '0',           // 0 = 상승률순
    fid_input_cnt_1: '0',
    fid_prc_cls_code: '0',
    fid_input_price_1: '', fid_input_price_2: '', fid_vol_cnt: '',
    fid_trgt_cls_code: '0',
    fid_trgt_exls_cls_code: EXCLS,
    fid_div_cls_code: '0',
    fid_rsfl_rate1: '', fid_rsfl_rate2: '',
  }, { max })

  return rows.map((r) => {
    const price = num(r.stck_prpr)
    const volume = num(r.acml_vol)
    return {
      code: String(r.stck_shrn_iscd || '').padStart(6, '0'),
      name: String(r.hts_kor_isnm || '').trim(),
      market: market === 'KOSDAQ' ? 'KOSDAQ' : 'KOSPI',
      price,
      rate: num(r.prdy_ctrt),
      marcap: null,
      volume,
      amount: (price != null && volume != null) ? price * volume : null,
    }
  }).filter((r) => r.code && r.rate != null)
}

/** 거래량 상위 — **거래대금이 실제 값으로 옵니다** (네이버는 가격×수량으로 어림잡았습니다). */
export async function fetchVolumeRankKis(market, max = 60) {
  const rows = await kisList(`${Q}/volume-rank`, 'FHPST01710000', {
    fid_cond_mrkt_div_code: 'J',
    fid_cond_scr_div_code: '20171',
    fid_input_iscd: market === 'KOSDAQ' ? '1001' : '0001',
    fid_div_cls_code: '0',
    fid_blng_cls_code: '0',                // 0 = 평균거래량
    fid_trgt_cls_code: '111111111',
    fid_trgt_exls_cls_code: '000000',
    fid_input_price_1: '0', fid_input_price_2: '0',
    fid_vol_cnt: '0', fid_input_date_1: '0',
  }, { max })

  return rows.map((r) => ({
    code: String(r.mksc_shrn_iscd || '').padStart(6, '0'),
    name: String(r.hts_kor_isnm || '').trim(),
    market: market === 'KOSDAQ' ? 'KOSDAQ' : 'KOSPI',
    price: num(r.stck_prpr),
    rate: num(r.prdy_ctrt),
    marcap: null,
    volume: num(r.acml_vol),
    amount: num(r.acml_tr_pbmn),           // 진짜 거래대금 (원)
  })).filter((r) => r.code && r.volume != null)
}

// ── 봉 자료 ──────────────────────────────────────────────

/* 한 번에 100봉까지만 옵니다. 그래서 날짜 창을 **미리 나눠 한꺼번에** 부릅니다.
   차례로 부르면(앞 페이지의 가장 오랜 날짜를 봐야 다음 페이지를 아니까)
   여섯 번이면 2초가 넘습니다. 창을 미리 계산하면 한 번에 보내고 0.4초면 끝납니다.
   창이 겹치거나 비어도 날짜로 합치기 때문에 결과는 같습니다. */
const SPAN = { D: 145, W: 730, M: 3100 }     // 100봉을 담으려면 며칠이 필요한가

/**
 * 일봉·주봉·월봉.
 *  code   — 6자리 종목코드
 *  period — 'D' 일 · 'W' 주 · 'M' 월
 *  bars   — 몇 봉까지
 * 돌려주는 것: [{d:'20260910', o,h,l,c,v}] — 날짜 오름차순
 */
export async function fetchOhlcvKis(code, period = 'D', bars = 600) {
  const p = SPAN[period] ? period : 'D'
  const span = SPAN[p]
  const pages = Math.min(10, Math.max(1, Math.ceil(bars / 100)))

  const end0 = kstNow()
  const tasks = []
  for (let i = 0; i < pages; i += 1) {
    const end = new Date(end0.getTime() - i * span * 86400000)
    const start = new Date(end.getTime() - span * 86400000)
    tasks.push(() => kis(`${Q}/inquire-daily-itemchartprice`, 'FHKST03010100', {
      fid_cond_mrkt_div_code: 'J',
      fid_input_iscd: code,
      fid_input_date_1: ymd(start),
      fid_input_date_2: ymd(end),
      fid_period_div_code: p,
      fid_org_adj_prc: '0',                // 0 = 수정주가
    }).catch(() => null))
  }

  const results = await kisAll(tasks)
  const seen = new Map()
  for (const res of results) {
    const arr = res && Array.isArray(res.body.output2) ? res.body.output2 : []
    for (const x of arr) {
      const d = String(x.stck_bsop_date || '')
      if (!/^\d{8}$/.test(d)) continue
      const c = num(x.stck_clpr)
      if (c == null) continue
      seen.set(d, {
        d,
        o: num(x.stck_oprc), h: num(x.stck_hgpr), l: num(x.stck_lwpr), c,
        v: num(x.acml_vol) || 0,
      })
    }
  }
  const out = [...seen.values()].sort((a, b) => (a.d < b.d ? -1 : 1))
  return out.slice(-bars)
}

/** 종목 현재가 — PER·PBR·시가총액·업종명까지 한 번에 옵니다. */
export async function fetchPriceKis(code) {
  const { body } = await kis(`${Q}/inquire-price`, 'FHKST01010100', {
    fid_cond_mrkt_div_code: 'J',
    fid_input_iscd: code,
  })
  const o = body.output || {}
  return {
    code,
    name: String(o.rprs_mrkt_kor_name || '').trim() || null,
    sector: String(o.bstp_kor_isnm || '').trim() || null,   // 업종명
    price: num(o.stck_prpr),
    diff: num(o.prdy_vrss),
    rate: num(o.prdy_ctrt),
    open: num(o.stck_oprc), high: num(o.stck_hgpr), low: num(o.stck_lwpr),
    volume: num(o.acml_vol), amount: num(o.acml_tr_pbmn),
    marcap: num(o.hts_avls),               // 억원
    per: num(o.per), pbr: num(o.pbr), eps: num(o.eps), bps: num(o.bps),
    high52: num(o.w52_hgpr), low52: num(o.w52_lwpr),
    shares: num(o.lstn_stcn),
    foreignRate: num(o.hts_frgn_ehrt),     // 외국인 보유 비중 %
  }
}

/**
 * 관심종목 여러 개를 한 번에 (최대 30개).
 * 워치리스트·히트맵처럼 여러 종목 시세가 한꺼번에 필요할 때 씁니다.
 */
export async function fetchMultiPriceKis(codes) {
  const list = codes.slice(0, 30)
  if (!list.length) return []
  const params = {}
  list.forEach((c, i) => {
    params[`fid_cond_mrkt_div_code_${i + 1}`] = 'J'
    params[`fid_input_iscd_${i + 1}`] = c
  })
  const { body } = await kis(`${Q}/intstock-multprice`, 'FHKST11300006', params)
  const arr = Array.isArray(body.output) ? body.output : []
  return arr.map((r, i) => ({
    code: String(r.inter_shrn_iscd || list[i] || '').padStart(6, '0'),
    name: String(r.inter_kor_isnm || '').trim(),
    price: num(r.inter2_prpr ?? r.stck_prpr),
    rate: num(r.prdy_ctrt),
    volume: num(r.acml_vol),
  })).filter((r) => r.code)
}
