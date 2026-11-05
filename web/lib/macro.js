// ============================================================
//  거시 지표 한 판 — 주가 · 환율 · 금리 · 원자재 · 변동성
//
//  브리핑의 알맹이는 결국 숫자입니다. 지수 두 개만 놓고 쓰면
//  아무리 글을 잘 써도 빈약해집니다. 그래서 한 번에 다 받아옵니다.
//
//  자료가 갈래마다 다릅니다 (한 곳에서 다 주는 데가 없습니다):
//   · 지수·VIX  → 네이버 지수 API      (확인됨: 되고 있습니다)
//   · 환율      → 유럽중앙은행 공표치  (frankfurter.dev, 키 불필요)
//   · 유가·금   → 네이버 '시장지표' 화면을 읽어옵니다
//   · 미국 금리 → FRED (키가 있을 때만. 없으면 그 줄은 빠집니다)
//
//  야후는 못 씁니다 — 클라우드 서버 IP 를 막아 한 건도 안 들어옵니다.
// ============================================================

const UA = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
    + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'accept-language': 'ko-KR,ko;q=0.9,en;q=0.8',
}

const num = (v) => {
  if (v == null) return null
  const n = parseFloat(String(v).replace(/[,\s%+]/g, ''))
  return Number.isFinite(n) ? n : null
}

// 8초는 빠듯했습니다 — 브리핑 기록을 보면 '환율' 이나 '미국 10년물' 하나가
//  자주 aborted 로 빠졌습니다(그 줄만 통째로 누락). 재료 모으기 전체가
//  10~12초로 여유가 있으니 한 건당 넉넉히 줍니다.
async function getJson(url, headers = UA, timeoutMs = 15000) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const r = await fetch(url, { headers, cache: 'no-store', signal: ac.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return await r.json()
  } finally { clearTimeout(t) }
}

/* ── 1. 지수 · VIX (네이버) ─────────────────────────────── */
const INDEXES = [
  { name: 'S&P500', code: '.INX', group: '주가' },
  { name: '나스닥', code: '.IXIC', group: '주가' },
  { name: '다우', code: '.DJI', group: '주가' },
  { name: '유로스톡스50', code: '.STOXX50E', group: '주가' },
  { name: '닛케이225', code: '.N225', group: '주가' },
  { name: '상해종합', code: '.SSEC', group: '주가' },
  { name: '대만 가권', code: '.TWII', group: '주가' },
  { name: 'VIX', code: '.VIX', group: '위험' },
]

async function fetchIndexes(errors, tried) {
  const out = []
  await Promise.all(INDEXES.map(async (it) => {
    const url = `https://api.stock.naver.com/index/${it.code}/basic`
    try {
      const j = await getJson(url)
      const price = num(j.closePrice ?? j.currentPrice)
      const diff = num(j.compareToPreviousClosePrice)
      const rate = num(j.fluctuationsRatio)
      if (price == null) throw new Error('형식이 다릅니다')
      out.push({ name: it.name, group: it.group, price, diff, rate })
      tried.push({ name: it.name, ok: true, url })
    } catch (e) {
      tried.push({ name: it.name, ok: false, fails: [`${url} → ${e?.message || e}`] })
      errors.push(`${it.name}: ${e?.message || e}`)
    }
  }))
  return out
}

/* ── 2. 환율 (유럽중앙은행 공표치) ───────────────────────
   원/달러가 아니라 달러당 원화로 옵니다. 그대로 쓰면 됩니다.
   최근 열흘치를 받아 마지막 두 영업일을 비교해 등락을 냅니다.
   ※ 실시간 시세가 아니라 하루 한 번 고시되는 기준환율입니다.  */
const FX = [
  { name: '원/달러', cur: 'KRW', mul: 1 },
  { name: '원/엔(100엔)', cur: 'JPY', mul: 100, invert: 'KRW' },
  { name: '원/유로', cur: 'EUR', mul: 1, invert: 'KRW' },
  { name: '원/위안', cur: 'CNY', mul: 1, invert: 'KRW' },
]

async function fetchFx(errors, tried) {
  const p = (n) => String(n).padStart(2, '0')
  const from = new Date(Date.now() - 14 * 86400000)
  const start = `${from.getUTCFullYear()}-${p(from.getUTCMonth() + 1)}-${p(from.getUTCDate())}`
  const url = `https://api.frankfurter.dev/v1/${start}..?from=USD&to=KRW,JPY,EUR,CNY`
  let days = []
  try {
    const j = await getJson(url)
    days = Object.keys(j.rates || {}).sort()
    if (days.length < 2) throw new Error('날짜가 부족합니다')
    tried.push({ name: '환율', ok: true, url })
    var rates = j.rates
  } catch (e) {
    tried.push({ name: '환율', ok: false, fails: [`${url} → ${e?.message || e}`] })
    errors.push(`환율: ${e?.message || e}`)
    return []
  }

  const last = rates[days[days.length - 1]]
  const prev = rates[days[days.length - 2]]
  const out = []
  for (const f of FX) {
    // 달러당 원 → 그대로 / 엔·유로·위안 → 원화로 환산 (KRW ÷ 그 통화)
    const val = (r) => (f.cur === 'KRW' ? r.KRW : (r.KRW / r[f.cur]) * f.mul)
    const a = val(last); const b = val(prev)
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue
    out.push({
      name: f.name, group: '환율', day: days[days.length - 1],
      price: Math.round(a * 100) / 100,
      diff: Math.round((a - b) * 100) / 100,
      rate: Math.round(((a - b) / b) * 10000) / 100,
    })
  }
  return out
}

/* ── 3. 유가 · 금 (네이버 '시장지표' 화면) ────────────────
   화면 하나에 국제 유가와 금값이 같이 있습니다. 한 번만 읽습니다. */
const PAGE = 'https://finance.naver.com/marketindex/'

/* 화면에서 찾을 것 — 클래스 이름은 네이버가 바꾸므로,
   화면에 적힌 '이름표' 로 찾습니다. 이름표가 훨씬 덜 바뀝니다. */
const PICK = [
  { name: 'WTI', group: '원자재', label: /^WTI$/i },
  { name: '두바이유', group: '원자재', label: /두바이/, optional: true },
  { name: '국제 금', group: '원자재', label: /^(국제\s*)?금$|국제금/ },
  { name: '휘발유', group: '원자재', label: /휘발유/, optional: true },
]

/* 네이버는 EUC-KR 로 내려줍니다. 깨지지 않게 풀어 읽습니다. */
async function getText(url) {
  const r = await fetch(url, { headers: UA, cache: 'no-store' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())
  const bad = (s2) => (s2.match(/\uFFFD/g) || []).length
  let utf = ''; let euc = ''
  try { utf = new TextDecoder('utf-8').decode(buf) } catch { /* 무시 */ }
  try { euc = new TextDecoder('euc-kr').decode(buf) } catch { /* 무시 */ }
  if (!euc) return utf
  if (!utf) return euc
  return bad(utf) <= bad(euc) ? utf : euc
}

/* 화면에 있는 항목을 통째로 훑어 옵니다.
   <a class="head 무엇"> <span class="blind">이름표</span> ...
     <span class="value">값</span> <span class="change">변화</span>
     <span class="blind">상승|하락|보합</span>                        */
function scanPage(html) {
  const found = []
  const re = /class="head ([a-z0-9_ ]+)"/gi
  let m
  while ((m = re.exec(html)) !== null) {
    const key = m[1].trim()
    const chunk = html.slice(m.index, m.index + 1200)
    // 첫 번째 blind 는 이름표, 그 뒤 blind 중 하나가 방향입니다
    const blinds = [...chunk.matchAll(/class="blind">([^<]{1,30})</g)].map((x) => x[1].trim())
    const label = blinds[0] || ''
    const dir = blinds.find((b) => /^(상승|하락|보합)$/.test(b)) || ''
    const v = chunk.match(/class="value">([^<]+)</)
    const c = chunk.match(/class="change">([^<]+)</)
    const price = num(v && v[1])
    if (price == null) continue
    let diff = num(c && c[1])
    if (diff != null && dir === '하락') diff = -diff
    if (dir === '보합') diff = 0
    found.push({ key, label, price, diff })
  }
  return found
}

async function fetchCommodities(errors, tried) {
  let html = ''
  try {
    html = await getText(PAGE)
  } catch (e) {
    tried.push({ name: '유가·금', ok: false, fails: [`${PAGE} → ${e?.message || e}`] })
    errors.push(`유가·금: ${e?.message || e}`)
    return []
  }

  const found = scanPage(html)
  // 화면에 무엇이 있었는지 남겨 둡니다 — 다음에 이름이 바뀌면 이걸 보고 고칩니다
  tried.push({
    name: '유가·금', ok: found.length > 0, url: PAGE,
    found: found.map((f) => `${f.label || '?'}(${f.key})=${f.price}`),
  })

  const out = []
  for (const it of PICK) {
    const hit = found.find((f) => it.label.test(f.label))
    if (!hit) {
      // 있으면 좋고 없어도 그만인 것은 오류로 남기지 않습니다 (WTI·금이 본체입니다)
      if (!it.optional) errors.push(`${it.name}: 화면에서 찾지 못했습니다`)
      continue
    }
    out.push({
      name: it.name, group: it.group, price: hit.price, diff: hit.diff,
      rate: (hit.diff != null && hit.price - hit.diff !== 0)
        ? Math.round((hit.diff / (hit.price - hit.diff)) * 10000) / 100 : null,
    })
  }
  return out
}

/* ── 4. 미국 국채 금리 (FRED) ────────────────────────────
   키(FRED_API_KEY)가 없으면 조용히 건너뜁니다. 무료로 즉시 발급됩니다.
   https://fred.stlouisfed.org/docs/api/api_key.html                */
const FRED = [
  { name: '미국 10년물', id: 'DGS10' },
  { name: '미국 2년물', id: 'DGS2' },
]

async function fetchFred(errors, tried) {
  const key = process.env.FRED_API_KEY
  if (!key) return []
  const out = []
  await Promise.all(FRED.map(async (f) => {
    const url = 'https://api.stlouisfed.org/fred/series/observations'
      + `?series_id=${f.id}&api_key=${key}&file_type=json&sort_order=desc&limit=8`
    try {
      const j = await getJson(url)
      const pts = (j.observations || [])
        .map((o) => ({ d: o.date, v: num(o.value) }))
        .filter((o) => o.v != null)
      if (pts.length < 2) throw new Error('값이 부족합니다')
      const a = pts[0]; const b = pts[1]
      out.push({
        name: f.name, group: '금리', day: a.d,
        price: a.v, diff: Math.round((a.v - b.v) * 1000) / 1000,
        bp: Math.round((a.v - b.v) * 100),
        rate: null,
      })
      tried.push({ name: f.name, ok: true, url: url.replace(key, '***') })
    } catch (e) {
      tried.push({ name: f.name, ok: false, fails: [`FRED ${f.id} → ${e?.message || e}`] })
      errors.push(`${f.name}: ${e?.message || e}`)
    }
  }))
  return out
}

/**
 * 전부 받아오기. 한 갈래가 실패해도 나머지는 그대로 씁니다.
 * @returns { items, errors, tried }
 */
export async function fetchMacro() {
  const errors = []
  const tried = []
  const parts = await Promise.all([
    fetchIndexes(errors, tried),
    fetchFx(errors, tried),
    fetchCommodities(errors, tried),
    fetchFred(errors, tried),
  ])
  const order = { 주가: 0, 환율: 1, 금리: 2, 원자재: 3, 위험: 4 }
  const items = parts.flat()
    .sort((a, b) => (order[a.group] ?? 9) - (order[b.group] ?? 9))
  return { items, errors, tried, hasFred: !!process.env.FRED_API_KEY }
}

/** 갈래별로 묶어 돌려줍니다 (브리핑 재료로 넘기기 좋게) */
export function groupMacro(items) {
  const out = {}
  for (const x of items) (out[x.group] = out[x.group] || []).push(x)
  return out
}
