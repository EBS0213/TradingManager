// ============================================================
//  한국투자증권 API 확인용 — 실제 응답을 눈으로 보려고 만들었습니다.
//
//  쓰는 법:  node scripts/kis-check.mjs
//  .env.local 에 KIS_APP_KEY · KIS_APP_SECRET 이 있어야 합니다.
//
//  토큰은 1분에 한 번만 발급되므로 받은 토큰을 .kis-token.json 에 담아 둡니다
//  (이 파일은 .gitignore 에 넣어야 합니다 — 열쇠나 다름없습니다).
// ============================================================
import fs from 'node:fs'
import path from 'node:path'

const ROOT = process.cwd()
const BASE = 'https://openapi.koreainvestment.com:9443'
const TOKEN_FILE = path.join(ROOT, '.kis-token.json')

// .env.local 읽기 (next 없이 도는 스크립트라 직접 읽습니다)
for (const f of ['.env.local', '.env.prod.local']) {
  const p = path.join(ROOT, f)
  if (!fs.existsSync(p)) continue
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim()
  }
}

const KEY = process.env.KIS_APP_KEY
const SECRET = process.env.KIS_APP_SECRET
if (!KEY || !SECRET) {
  console.error('KIS_APP_KEY · KIS_APP_SECRET 이 없습니다 (.env.local 에 넣어 주세요)')
  process.exit(1)
}

async function token() {
  if (fs.existsSync(TOKEN_FILE)) {
    const o = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'))
    if (o.exp && Date.now() < o.exp - 60000) return o.token
  }
  const r = await fetch(`${BASE}/oauth2/tokenP`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ grant_type: 'client_credentials', appkey: KEY, appsecret: SECRET }),
  })
  const j = await r.json()
  if (!j.access_token) throw new Error(`토큰 실패: ${JSON.stringify(j)}`)
  const o = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 86400) * 1000 }
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(o))
  console.log('토큰을 새로 받아 .kis-token.json 에 담았습니다')
  return o.token
}

async function call(name, path_, trId, params) {
  const t = await token()
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) qs.set(k.toUpperCase(), String(v))
  const r = await fetch(`${BASE}${path_}?${qs}`, {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      authorization: `Bearer ${t}`,
      appkey: KEY, appsecret: SECRET, tr_id: trId, custtype: 'P',
    },
  })
  const j = await r.json().catch(() => null)
  console.log(`\n═══ ${name}  (HTTP ${r.status} · tr_cont=${r.headers.get('tr_cont') || '-'})`)
  if (!j) { console.log('  응답을 읽지 못했습니다'); return null }
  if (String(j.rt_cd) !== '0') { console.log(`  ✗ ${j.msg_cd}: ${j.msg1}`); return null }
  const one = j.output || (j.output1 && !Array.isArray(j.output1) ? j.output1 : null)
  const many = Array.isArray(j.output) ? j.output
    : Array.isArray(j.output1) ? j.output1
      : Array.isArray(j.output2) ? j.output2 : null
  if (one) console.log(JSON.stringify(one, null, 1).slice(0, 1400))
  if (many) {
    console.log(`  줄 수: ${many.length}`)
    console.log(JSON.stringify(many.slice(0, 2), null, 1).slice(0, 1200))
  }
  return j
}

const Q = '/uapi/domestic-stock/v1/quotations'
const R = '/uapi/domestic-stock/v1/ranking'
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '')

async function main() {
  await call('① 코스피 지수', `${Q}/inquire-index-price`, 'FHPUP02100000',
    { fid_cond_mrkt_div_code: 'U', fid_input_iscd: '0001' })

  await call('② 삼성전자 현재가', `${Q}/inquire-price`, 'FHKST01010100',
    { fid_cond_mrkt_div_code: 'J', fid_input_iscd: '005930' })

  await call('③ 시가총액 상위(코스피)', `${R}/market-cap`, 'FHPST01740000',
    { fid_cond_mrkt_div_code: 'J', fid_cond_scr_div_code: '20174', fid_div_cls_code: '1',
      fid_input_iscd: '0001', fid_trgt_cls_code: '0', fid_trgt_exls_cls_code: '0',
      fid_input_price_1: '', fid_input_price_2: '', fid_vol_cnt: '' })

  await call('④ 등락률 상위(코스피)', `${R}/fluctuation`, 'FHPST01700000',
    { fid_cond_mrkt_div_code: 'J', fid_cond_scr_div_code: '20170', fid_input_iscd: '0001',
      fid_rank_sort_cls_code: '0', fid_input_cnt_1: '0', fid_prc_cls_code: '0',
      fid_input_price_1: '', fid_input_price_2: '', fid_vol_cnt: '',
      fid_trgt_cls_code: '0', fid_trgt_exls_cls_code: '0000000000',
      fid_div_cls_code: '0', fid_rsfl_rate1: '', fid_rsfl_rate2: '' })

  await call('⑤ 거래량 순위(코스피)', `${Q}/volume-rank`, 'FHPST01710000',
    { fid_cond_mrkt_div_code: 'J', fid_cond_scr_div_code: '20171', fid_input_iscd: '0001',
      fid_div_cls_code: '0', fid_blng_cls_code: '0', fid_trgt_cls_code: '111111111',
      fid_trgt_exls_cls_code: '000000', fid_input_price_1: '0', fid_input_price_2: '0',
      fid_vol_cnt: '0', fid_input_date_1: '0' })

  await call('⑥ 시장 수급(코스피 일별)', `${Q}/inquire-investor-daily-by-market`, 'FHPTJ04040000',
    { fid_cond_mrkt_div_code: 'U', fid_input_iscd: '0001', fid_input_date_1: today,
      fid_input_iscd_1: 'KSP', fid_input_date_2: today, fid_input_iscd_2: '0001' })

  await call('⑦ 삼성전자 일봉 100', `${Q}/inquire-daily-itemchartprice`, 'FHKST03010100',
    { fid_cond_mrkt_div_code: 'J', fid_input_iscd: '005930',
      fid_input_date_1: '20260401', fid_input_date_2: today,
      fid_period_div_code: 'D', fid_org_adj_prc: '0' })

  await call('⑧ 삼성전자 주봉 (긴 기간)', `${Q}/inquire-daily-itemchartprice`, 'FHKST03010100',
    { fid_cond_mrkt_div_code: 'J', fid_input_iscd: '005930',
      fid_input_date_1: '20240101', fid_input_date_2: today,
      fid_period_div_code: 'W', fid_org_adj_prc: '0' })

  await call('⑨ 지수 1분봉', `${Q}/inquire-time-indexchartprice`, 'FHKUP03500200',
    { fid_cond_mrkt_div_code: 'U', fid_etc_cls_code: '0', fid_input_iscd: '0001',
      fid_input_hour_1: '60', fid_pw_data_incu_yn: 'N' })

  await call('⑩ 관심종목 멀티시세(3개)', `${Q}/intstock-multprice`, 'FHKST11300006',
    { fid_cond_mrkt_div_code_1: 'J', fid_input_iscd_1: '005930',
      fid_cond_mrkt_div_code_2: 'J', fid_input_iscd_2: '000660',
      fid_cond_mrkt_div_code_3: 'J', fid_input_iscd_3: '035420' })
}

main().catch((e) => { console.error('\n실패:', e.message); process.exit(1) })
