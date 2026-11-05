// ============================================================
//  국채 금리 — 미국 · 일본 · 한국 (2026-08-25)
//
//  왜 우리가 직접 받아오나
//    전에는 트레이딩뷰 위젯을 붙여 두었습니다. 그런데 이름만 뜨고 값이
//    끝내 비어 있었습니다. 위젯 안에서 무슨 일이 벌어지는지는 우리가 볼 수
//    없습니다 — 고칠 수도, 고쳐졌는지 확인할 수도 없습니다.
//    그래서 사이트의 다른 자료와 같은 방식으로 바꿉니다: 서버가 공식 출처에서
//    직접 받아 우리 화면에 그립니다.
//
//  출처 (모두 열쇠(API key) 없이 됩니다)
//    미국  미국 재무부 일별 국채 수익률 CSV        (공식)
//    일본  일본 재무성(財務省) JGB 금리 CSV         (공식)
//    한국  네이버 금융 시장지표                     (공개 화면)
//
//  한 곳이 실패해도 나머지는 그대로 나갑니다. 금리 다섯 줄이 한 덩어리로
//  묶여 하나 때문에 다 사라지면, 정작 볼 수 있었던 숫자까지 못 보게 됩니다.
//
//  ※ tried 를 함께 돌려줍니다 — '어디에 물어봤고 무엇이 왔는지' 의 기록입니다.
//    출처 쪽 화면이 바뀌면 이걸 보고 고칩니다 (lib/macro.js 와 같은 방식).
// ============================================================

const UA = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
    + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'accept-language': 'ko-KR,ko;q=0.9,en;q=0.8',
}

const num = (v) => {
  if (v == null) return null
  const n = parseFloat(String(v).replace(/[,\s%+"]/g, ''))
  return Number.isFinite(n) ? n : null
}

async function getText(url, timeoutMs = 12000, headers = UA) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const r = await fetch(url, { headers, cache: 'no-store', signal: ac.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    const buf = Buffer.from(await r.arrayBuffer())
    // ⚠️ 네이버는 **EUC-KR** 로 내려줍니다 (2026-08-26 에 이것 때문에 한국 금리가
    //  통째로 안 나왔습니다). 그냥 text() 로 읽으면 UTF-8 로 풀어 한글이 다 깨지고,
    //  '국고채 10년' 을 찾을 수가 없습니다. 미국·일본은 영문 CSV 라 멀쩡했고요.
    //  두 가지로 풀어 보고 **깨진 글자(\uFFFD)가 적은 쪽**을 씁니다.
    //  (lib/macro.js 가 같은 방법을 쓰고 있었습니다 — 진작 볼 걸 그랬습니다)
    const bad = (x) => (x.match(/\uFFFD/g) || []).length
    let utf = ''; let euc = ''
    try { utf = new TextDecoder('utf-8').decode(buf) } catch { /* 무시 */ }
    try { euc = new TextDecoder('euc-kr').decode(buf) } catch { /* 무시 */ }
    if (!euc) return utf
    if (!utf) return euc
    return bad(utf) <= bad(euc) ? utf : euc
  } finally { clearTimeout(t) }
}

/* 화면(HTML)을 '글자 토막' 목록으로 바꿉니다.
   태그를 자르는 자리마다 끊어 두면, 이름표와 그 옆 숫자가 이웃한 토막이 됩니다.
   클래스 이름이나 표 구조가 바뀌어도 견딥니다 — 네이버는 그런 것을 자주 바꿉니다. */
function tokens(html) {
  return String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]*>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean)
}

/* 쉼표로 나뉜 한 줄을 쪼갭니다. 값에 따옴표가 붙어 있어도 벗겨 냅니다. */
const cells = (line) => String(line).split(',').map((x) => x.trim().replace(/^"|"$/g, ''))

/* ── 미국 — 재무부 일별 국채 수익률 ─────────────────────────
   맨 윗줄이 머리글, 그다음 줄이 **가장 최근 날짜** 입니다(최신순).
   해가 바뀐 직후에는 새해 파일이 아직 비어 있을 수 있어 작년 것도 봅니다. */
const US_URL = (y) =>
  'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/'
  + `daily-treasury-rates.csv/${y}/all?type=daily_treasury_yield_curve`
  + `&field_tdr_date_value=${y}&page&_format=csv`

async function fetchUS(out, errors, tried) {
  const yr = new Date().getUTCFullYear()
  for (const y of [yr, yr - 1]) {
    let csv = ''
    try { csv = await getText(US_URL(y)) }
    catch (e) { tried.push({ name: `미국 ${y}`, ok: false, why: String(e?.message || e) }); continue }

    const lines = csv.split(/\r?\n/).filter((l) => l.trim())
    if (lines.length < 2) { tried.push({ name: `미국 ${y}`, ok: false, why: '줄이 없습니다' }); continue }

    const head = cells(lines[0])
    const i10 = head.findIndex((h) => /^10\s*yr$/i.test(h))
    const i30 = head.findIndex((h) => /^30\s*yr$/i.test(h))
    if (i10 < 0 && i30 < 0) {
      tried.push({ name: `미국 ${y}`, ok: false, why: `칸 이름이 바뀌었습니다: ${head.join('|')}` })
      continue
    }
    const now = cells(lines[1])
    const prev = lines[2] ? cells(lines[2]) : null
    const day = now[0] || ''
    const put = (key, name, i) => {
      const v = i >= 0 ? num(now[i]) : null
      if (v == null) return
      const p = (prev && i >= 0) ? num(prev[i]) : null
      out.push({ key, name, value: v, day, src: '미국 재무부',
                 // 금리 변화는 %가 아니라 bp(0.01%p)로 읽는 것이 시장의 말투입니다
                 bp: p == null ? null : Math.round((v - p) * 100) })
    }
    put('US10Y', '미국 10년', i10)
    put('US30Y', '미국 30년', i30)
    tried.push({ name: `미국 ${y}`, ok: true, day, got: `10년 ${now[i10]} · 30년 ${now[i30]}` })
    return
  }
  errors.push('미국 국채 금리를 받지 못했습니다')
}

/* ── 일본 — 재무성 JGB 금리 ─────────────────────────────────
   맨 아랫줄이 가장 최근입니다(오래된 순). 머리글이 일본어(Shift-JIS)라
   글자로 찾지 않고 **칸 자리**로 찾습니다: 기준일,1년,2년,…,10년,15년,20년,25년,30년,40년 */
const JP_URL = 'https://www.mof.go.jp/jgbs/reference/interest_rate/jgbcm.csv'
const JP_I10 = 10, JP_I30 = 14      // 0번이 날짜 칸입니다

/* 'R8.8.21' → '2026-08-21'. 레이와 1년 = 2019년. */
function jpDay(s) {
  const m = String(s).match(/^([A-Za-z])(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return String(s)
  const base = { R: 2018, H: 1988, S: 1925 }[m[1].toUpperCase()]
  if (!base) return String(s)
  return `${base + Number(m[2])}-${String(m[3]).padStart(2, '0')}-${String(m[4]).padStart(2, '0')}`
}

async function fetchJP(out, errors, tried) {
  let csv = ''
  try { csv = await getText(JP_URL) }
  catch (e) {
    tried.push({ name: '일본', ok: false, why: String(e?.message || e) })
    errors.push(`일본 국채 금리: ${e?.message || e}`); return
  }
  const lines = csv.split(/\r?\n/).filter((l) => l.trim())
  // 뒤에서부터 '숫자가 들어 있는 줄' 을 찾습니다 (마지막 줄이 빌 수 있습니다)
  let now = null, prev = null
  for (let i = lines.length - 1; i >= 0 && !prev; i--) {
    const c = cells(lines[i])
    // 날짜 칸('R8.10.1')이 있는 줄만 자료입니다. 2026-10-04 고침 — 이 파일은 **이번 달 치만**
    //  담아서 달 첫날에는 자료 줄이 하나뿐이고, 그러면 머리글의 '10年'·'30年' 을 10·30 으로
    //  읽어 전날 값으로 썼습니다(−691bp). 전날 줄이 없으면 bp 를 비워 둡니다.
    if (!/^[A-Za-z]\d+\.\d+\.\d+$/.test(String(c[0]).trim())) continue
    if (num(c[JP_I10]) == null) continue
    if (!now) now = c; else prev = c
  }
  if (!now) {
    tried.push({ name: '일본', ok: false, why: '숫자가 든 줄을 못 찾았습니다' })
    errors.push('일본 국채 금리를 읽지 못했습니다'); return
  }
  const day = jpDay(now[0])
  const put = (key, name, i) => {
    const v = num(now[i]); if (v == null) return
    const p = prev ? num(prev[i]) : null
    out.push({ key, name, value: v, day, src: '일본 재무성',
               bp: p == null ? null : Math.round((v - p) * 100) })
  }
  put('JP10Y', '일본 10년', JP_I10)
  put('JP30Y', '일본 30년', JP_I30)
  tried.push({ name: '일본', ok: true, day, got: `10년 ${now[JP_I10]} · 30년 ${now[JP_I30]}` })
}

/* ── 한국 — 네이버 증권 JSON (2026-10-04 바꿈) ─────────────────
   한국 국고채는 열쇠 없이 받을 수 있는 공식 창구가 마땅치 않습니다
   (한국은행 ECOS 는 열쇠가 필요합니다). 전에는 finance.naver.com 의 시장지표
   화면을 긁었는데, 그 화면이 바뀌어 한국 10년이 조용히 빠져 있었습니다.
   지금은 네이버 증권 앱이 쓰는 JSON 을 받습니다. 전일 대비 변화도 같이 옵니다. */
const KR_URL = 'https://api.stock.naver.com/marketindex/bond/KR10YT%3DRR'

async function fetchKR(out, errors, tried) {
  let j
  try { j = JSON.parse(await getText(KR_URL)) }
  catch (e) {
    tried.push({ name: '한국', ok: false, why: String(e?.message || e) })
    errors.push('한국 국고채 금리를 받지 못했습니다'); return
  }
  const v = num(j?.closePrice)
  if (v == null) {
    tried.push({ name: '한국', ok: false, why: 'closePrice 가 없습니다', got: JSON.stringify(j).slice(0, 120) })
    errors.push('한국 국고채 금리를 읽지 못했습니다'); return
  }
  const d = num(j?.fluctuations)
  const day = String(j?.localTradedAt || '').slice(0, 10)
  out.push({ key: 'KR10Y', name: '한국 10년', value: v, day, src: '네이버 증권',
             bp: d == null ? null : Math.round(d * 100) })
  tried.push({ name: '한국', ok: true, day, got: `10년 ${j.closePrice} (${j.fluctuations})` })
}

/** 다섯 줄을 모읍니다. 한 곳이 실패해도 나머지는 그대로 돌려줍니다. */
export async function fetchBonds() {
  const items = [], errors = [], tried = []
  await Promise.all([
    fetchUS(items, errors, tried).catch((e) => errors.push(`미국: ${e?.message || e}`)),
    fetchJP(items, errors, tried).catch((e) => errors.push(`일본: ${e?.message || e}`)),
    fetchKR(items, errors, tried).catch((e) => errors.push(`한국: ${e?.message || e}`)),
  ])
  const order = ['US10Y', 'US30Y', 'JP10Y', 'JP30Y', 'KR10Y']
  items.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  return { items, errors, tried }
}
