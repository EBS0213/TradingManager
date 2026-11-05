// ============================================================
//  시장 심리 게이지 세 개
//
//   ① 공포/탐욕 지수  — CNN (0~100)
//   ② 버핏지수        — 미국 주식 시가총액 / GDP (%)
//   ③ BofA 불&베어    — 0~10, 8.0 넘으면 매도 신호
//
//  세 개를 한 화면에 두는 이유: 서로 다른 것을 봅니다.
//   공포/탐욕은 '지금 분위기'(며칠), 버핏지수는 '값이 비싼가'(수년),
//   BofA 는 '기관 자금이 어디 쏠렸나'(주). 셋이 동시에 극단이면
//   그때가 진짜 조심할 때입니다.
//
//  ⚠️ 버핏지수 주의
//   예전에는 FRED 의 윌셔5000(WILL5000PRFC)으로 총시가총액을 구했는데,
//   FRED 가 2024-06-03 자로 윌셔 계열을 전부 삭제했습니다.
//   그래서 분기 자료(NCBEILQ027S)를 뼈대로 삼고 S&P500 일간 등락으로
//   비율을 밀어 주는 근사법을 씁니다. 화면에 '근사치' 라고 밝힙니다.
// ============================================================
import { ensureSettings } from '@/lib/settings'

const UA = {
  'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
    + 'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  'accept-language': 'en-US,en;q=0.9',
}

const CACHE_KEY = 'gauge_cache'
const BOFA_KEY = 'bofa_bb'
const CACHE_MS = 30 * 60 * 1000        // 30분. 둘 다 하루 1회 갱신이라 넉넉합니다.
// 실패한 결과는 오래 붙들지 않습니다.
//  FRED 가 한 번 느렸다고 30분 동안 '자료 없음' 을 보여주면
//  고쳐 놓고도 고쳐진 줄 모릅니다.
const CACHE_FAIL_MS = 3 * 60 * 1000

const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(/[,\s%]/g, ''))
  return Number.isFinite(n) ? n : null
}

// FRED 는 느립니다. 12초로는 CSV 를 다 받기 전에 끊겼습니다
//  (2026-08-18 확인: buffett 이 'This operation was aborted' 로 계속 실패).
async function get(url, { json = false, timeoutMs = 25000 } = {}) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const r = await fetch(url, { headers: UA, cache: 'no-store', signal: ac.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return json ? await r.json() : await r.text()
  } finally { clearTimeout(t) }
}

/* ── ① 공포/탐욕 (CNN) ─────────────────────────────────── */
//  CNN 이 화면 그리려고 쓰는 주소입니다. 공식 문서는 없지만 오래 살아 있습니다.
//  브라우저인 척(UA) 해야 열립니다. 막히면 같은 값을 매일 받아 두는
//  깃허브 미러로 넘어갑니다.
const CNN = 'https://production.dataviz.cnn.io/index/fearandgreed/graphdata'
const CNN_MIRROR = 'https://raw.githubusercontent.com/whit3rabbit/fear-greed-data/main/json/cnn_output.json'

const RATING_KO = {
  'extreme fear': '극단적 공포',
  fear: '공포',
  neutral: '중립',
  greed: '탐욕',
  'extreme greed': '극단적 탐욕',
}

function shapeFear(j, via) {
  const f = j?.fear_and_greed
  const score = num(f?.score)
  if (score == null) throw new Error('score 없음')
  const hist = (j?.fear_and_greed_historical?.data || [])
    .slice(-60)
    .map(d => num(d?.y))
    .filter(v => v != null)
  return {
    ok: true,
    score: Math.round(score * 10) / 10,
    rating: String(f.rating || ''),
    ratingKo: RATING_KO[String(f.rating || '').toLowerCase()] || String(f.rating || ''),
    prevClose: num(f.previous_close),
    week: num(f.previous_1_week),
    month: num(f.previous_1_month),
    year: num(f.previous_1_year),
    at: f.timestamp || null,
    spark: hist,
    via,
  }
}

export async function fetchFear() {
  try {
    return shapeFear(await get(CNN, { json: true }), 'cnn')
  } catch (e1) {
    try {
      return shapeFear(await get(CNN_MIRROR, { json: true }), 'mirror')
    } catch (e2) {
      return { ok: false, error: `${e1?.message || e1} / 미러: ${e2?.message || e2}` }
    }
  }
}

/* ── ② 버핏지수 (FRED) ─────────────────────────────────── */
//  키가 필요 없는 CSV 주소를 씁니다. api.stlouisfed.org 는 키가 있어야 합니다.
const fredUrl = (id, from) =>
  `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${from}`
// CSV 가 안 열릴 때를 대비한 두 번째 길. 같은 자료를 글로 내려줍니다.
const fredTxt = (id) => `https://fred.stlouisfed.org/data/${id}.txt`

/** FRED CSV → [{date, value}] . 값이 '.' 인 줄(휴장·미발표)은 버립니다. */
function parseFred(csv) {
  const out = []
  for (const line of String(csv).split('\n').slice(1)) {
    const [d, v] = line.trim().split(',')
    if (!d) continue
    const n = num(v)
    if (n != null) out.push({ date: d, value: n })
  }
  return out
}

/** fred.stlouisfed.org/data/ID.txt — 'DATE VALUE' 가 공백으로 늘어선 글입니다. */
function parseFredTxt(txt) {
  const out = []
  for (const line of String(txt).split('\n')) {
    const m = line.trim().match(/^(\d{4}-\d{2}-\d{2})\s+([-\d.]+)$/)
    if (!m) continue
    const n = num(m[2])
    if (n != null) out.push({ date: m[1], value: n })
  }
  return out
}

/**
 * 시계열 하나를 받아옵니다.
 *
 * FRED 가 느립니다. 셋을 한꺼번에 기다리다 하나가 늦으면 전부 실패했습니다
 * (2026-08-18: 'This operation was aborted' 로 버핏지수가 계속 비었습니다).
 * 그래서 ① 하나씩, ② CSV 가 안 되면 글(txt) 로, ③ 실패해도 다음 것은 계속.
 */
async function fredSeries(id, from, timeoutMs = 20000) {
  try {
    const rows = parseFred(await get(fredUrl(id, from), { timeoutMs }))
    if (rows.length) return { ok: true, rows, via: 'csv' }
    throw new Error('빈 응답')
  } catch (e1) {
    try {
      const rows = parseFredTxt(await get(fredTxt(id), { timeoutMs }))
      if (rows.length) return { ok: true, rows, via: 'txt' }
      throw new Error('빈 응답')
    } catch (e2) {
      return { ok: false, rows: [], error: `${id}: ${e1?.message || e1} / ${e2?.message || e2}` }
    }
  }
}

const last = (arr) => (arr.length ? arr[arr.length - 1] : null)

/** 분기 관측일(그 분기 첫날)로부터 분기 말일을 구합니다. */
function quarterEnd(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + 3)
  d.setUTCDate(0)                       // 다음 분기 첫달의 0일 = 이번 분기 마지막 날
  return d.toISOString().slice(0, 10)
}

/** 주어진 날짜에 가장 가까운(그 이전) 값 */
function valueAt(series, dateStr) {
  let hit = null
  for (const r of series) {
    if (r.date <= dateStr) hit = r
    else break
  }
  return hit
}

/**
 * 서울 서버가 밀어 넣어 둔 값을 먼저 씁니다.
 *
 * FRED 는 이 사이트가 도는 미국 서버에서 열리지 않습니다. 서울 서버가 하루 한 번
 * 받아서 /api/gauge/buffett 으로 보내 주고, 여기서는 그것을 읽기만 합니다.
 * 4일 넘게 갱신이 없으면 (서버가 멈춘 경우) 직접 받아보는 쪽으로 넘어갑니다.
 */
const PUSH_MAX_MS = 4 * 24 * 3600 * 1000

export async function readPushedBuffett(sql) {
  try {
    const r = await sql`SELECT value, updated_at FROM screener_settings WHERE key = 'buffett'`
    if (!r.length) return null
    if (Date.now() - new Date(r[0].updated_at).getTime() > PUSH_MAX_MS) return null
    const v = r[0].value || {}
    return v.ratio ? { ...v, ok: true } : null
  } catch { return null }
}

export async function fetchBuffett() {
  const q = new Date(Date.now() - 2 * 365 * 86400000).toISOString().slice(0, 10)
  const d = new Date(Date.now() - 400 * 86400000).toISOString().slice(0, 10)

  // ① 꼭 있어야 하는 두 개 — 분기 자료라 몇 줄뿐이라 가볍습니다
  const eqR = await fredSeries('NCBEILQ027S', q)
  const gdpR = await fredSeries('GDP', q)
  const eqLast = last(eqR.rows)
  const gdpLast = last(gdpR.rows)
  if (!eqLast || !gdpLast) {
    return { ok: false,
      error: [eqR.error, gdpR.error].filter(Boolean).join(' | ') || 'FRED 분기 자료 없음' }
  }

  const anchor = (eqLast.value / 1000) / gdpLast.value * 100
  const qEnd = quarterEnd(eqLast.date)

  // ② S&P500 은 있으면 좋고 없어도 됩니다.
  //   못 받으면 분기 앵커를 그대로 보여줍니다 — 빈칸보다 훨씬 낫습니다.
  let ratio = anchor
  let approx = false
  let spNote = ''
  const spR = await fredSeries('SP500', d)
  const spLast = last(spR.rows)
  const spAtAnchor = spLast ? valueAt(spR.rows, qEnd) : null
  if (spLast && spAtAnchor && spAtAnchor.value > 0 && spLast.date > qEnd) {
    ratio = anchor * (spLast.value / spAtAnchor.value)
    approx = true
  } else if (!spR.ok) {
    spNote = 'S&P500 을 받지 못해 분기 값만 씁니다'
  }

  return {
    ok: true,
    ratio: Math.round(ratio * 10) / 10,
    anchor: Math.round(anchor * 10) / 10,
    anchorAt: qEnd,
    approx,
    spAt: spLast?.date || null,
    note: spNote,
    via: [eqR.via, gdpR.via, spR.via].filter(Boolean).join('/'),
  }
}

/* ── ③ BofA 불&베어 ────────────────────────────────────── */
//  공개 API 가 없습니다. 주간 기사에서 뽑아 DB 에 넣어 둔 값을 읽습니다.
//  (넣는 쪽은 /api/gauge/bofa 입니다)
export const BOFA_SELL = 8.0            // 이 위는 BofA 가 말하는 매도 신호
export const BOFA_BUY = 2.0             // 이 아래는 매수 신호

export async function readBofa(sql) {
  try {
    const r = await sql`SELECT value, updated_at FROM screener_settings WHERE key = ${BOFA_KEY}`
    if (!r.length) return { ok: false, error: '아직 값이 없습니다' }
    const v = r[0].value || {}
    const at = v.at || r[0].updated_at
    const days = Math.floor((Date.now() - new Date(at).getTime()) / 86400000)
    return {
      ok: v.value != null,
      value: num(v.value),
      prev: num(v.prev),
      at,
      days,
      stale: days > 14,                 // 2주 넘게 못 받았으면 흐리게 보여줍니다
      source: v.source || '',
      title: v.title || '',
      by: v.by || '',                   // 'auto' 또는 'manual'
    }
  } catch (e) {
    return { ok: false, error: String(e?.message || e) }
  }
}

export async function writeBofa(sql, { value, prev, source, title, by }) {
  await ensureSettings(sql)
  const cur = await readBofa(sql)
  const payload = {
    value,
    prev: prev ?? (cur.ok ? cur.value : null),
    at: new Date().toISOString(),
    source: source || '',
    title: title || '',
    by: by || 'manual',
  }
  const v = JSON.stringify(payload)
  await sql`
    INSERT INTO screener_settings (key, value, updated_at)
    VALUES (${BOFA_KEY}, ${v}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = ${v}::jsonb, updated_at = now()`
  return payload
}

/* ── 세 개를 합쳐서 ────────────────────────────────────── */
export async function buildGauges(sql, { force = false } = {}) {
  await ensureSettings(sql)
  if (!force) {
    try {
      const r = await sql`SELECT value, updated_at FROM screener_settings WHERE key = ${CACHE_KEY}`
      if (r.length) {
        const v = r[0].value || {}
        const allOk = Boolean(v.fear?.ok && v.buffett?.ok)
        const age = Date.now() - new Date(r[0].updated_at).getTime()
        if (age < (allOk ? CACHE_MS : CACHE_FAIL_MS)) return { ...v, cached: true }
      }
    } catch { /* 캐시는 없으면 없는 대로 갑니다 */ }
  }

  // 버핏지수는 서울 서버가 보내 준 값이 있으면 그것을 씁니다 (FRED 가 여기서는 안 열립니다)
  const pushed = await readPushedBuffett(sql)
  const [fear, direct, bofa] = await Promise.all([
    fetchFear(), pushed ? Promise.resolve(pushed) : fetchBuffett(), readBofa(sql),
  ])
  const buffett = direct
  const out = { fear, buffett, bofa, at: new Date().toISOString() }

  // 셋 다 실패한 캐시를 남겨 두면 30분 동안 빈 화면이 됩니다 — 하나라도 되면 저장합니다
  if (fear.ok || buffett.ok) {
    try {
      const v = JSON.stringify(out)
      await sql`
        INSERT INTO screener_settings (key, value, updated_at)
        VALUES (${CACHE_KEY}, ${v}::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = ${v}::jsonb, updated_at = now()`
    } catch { /* 저장 실패해도 화면은 나갑니다 */ }
  }
  return out
}
