// ============================================================
//  셋업 판정 — 스크리너 옆 '셋업' 화면이 씁니다 (2026-10-09 신설).
//
//  가장 최근 스크리너 결과에서 8조건을 통과한 종목만 골라
//  일봉을 받고 lib/setup.js 로 "브레이크아웃 셋업 있음 / 없음" 을 가립니다.
//
//  · 스크리너처럼 **로그인 없이 누구나** 봅니다 (판정 결과만 — 봉 자료는 싣지 않습니다.
//    차트는 화면이 /api/ohlcv 로 따로 받고, 그쪽은 로그인한 사람만 됩니다).
//  · 계산은 스크리너 결과(stamp)가 바뀐 뒤 첫 방문 때 한 번만 합니다.
//    결과는 screener_settings 의 setup_v{VERSION}_{시장} 에 담아 둡니다.
//  · 일봉은 /api/ohlcv 가 담아 둔 것(ohlcv2_시장_코드)이 12시간 안쪽이면 그대로 씁니다.
// ============================================================
import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { ensureSettings, ensureMarketColumn } from '@/lib/settings'
import { fetchOhlcv } from '@/lib/naver'
import { fetchUsOhlcv, hasUS } from '@/lib/massive'
import { evaluate, setupQuality, stockQuality, relStrength, cleanBars, VERSION, P } from '@/lib/setup'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UTF8 = { 'content-type': 'application/json; charset=utf-8' }
const json = (o, init) => NextResponse.json(o, { ...init, headers: UTF8 })

const BARS = 420          // /api/ohlcv 와 같은 길이 — 담아 둔 것을 그대로 쓰려고
const CONC = 8            // 동시에 받는 종목 수 (네이버가 막지 않을 만큼)
const OH_FRESH = 12 * 3600 * 1000

const num = (x) => { const n = Number(String(x ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : null }

export async function GET(request) {
  const q = new URL(request.url).searchParams
  const market = String(q.get('market') || 'KR').toUpperCase() === 'US' ? 'US' : 'KR'
  if (market === 'US' && !hasUS())
    return json({ ok: false, error: '미국 일별 시세를 아직 받지 못했습니다' })

  let sql
  try { sql = await getSql(); await ensureSettings(sql); await ensureMarketColumn(sql) }
  catch (e) { return json({ ok: false, error: `DB 에 닿지 못했습니다 (${e?.message || e})` }) }

  const head = await sql`
    SELECT stamp FROM screener_snapshot
    WHERE market = ${market} ORDER BY created_at DESC LIMIT 1`
  if (!head.length) return json({ ok: true, market, stamp: null, rows: [], hist: [] })
  const stamp = head[0].stamp
  const key = `setup_v${VERSION}_${market}`

  // 같은 스크리너 결과로 이미 계산했으면 그대로 돌려줍니다
  try {
    const r = await sql`SELECT value FROM screener_settings WHERE key = ${key}`
    if (r.length && r[0].value?.stamp === stamp) return json({ ok: true, cached: true, ...r[0].value })
  } catch { /* 없으면 새로 계산합니다 */ }

  const snap = await sql`
    SELECT payload FROM screener_snapshot
    WHERE market = ${market} ORDER BY created_at DESC LIMIT 1`
  let all = []
  try { all = JSON.parse(snap[0].payload) } catch { all = [] }
  // 스크리너 통계와 같은 대상 — 제외·부적합은 빼고 8조건 통과만
  const cands = all.filter((r) => !r['제외사유'] && !r['부적합사유'] && r['판정'] === '통과')

  const t0 = Date.now()

  // 시장 대비 RS 에 쓸 지수 — 한국은 종목이 속한 시장(코스피·코스닥), 미국은 SPY
  const ixb = {}
  try {
    if (market === 'US') ixb.US = cleanBars(await fetchUsOhlcv('SPY', BARS))
    else {
      const [kospi, kosdaq] = await Promise.all([fetchOhlcv('KOSPI', 'day', BARS), fetchOhlcv('KOSDAQ', 'day', BARS)])
      ixb.KOSPI = cleanBars(kospi); ixb.KOSDAQ = cleanBars(kosdaq)
    }
  } catch { /* 지수를 못 받으면 RS 점수만 0 으로 둡니다 */ }

  // 업종 강도 — 스크리너 대상 가운데 업종별 8조건 통과 비율의 백분위
  const main = all.filter((r) => !r['제외사유'] && !r['부적합사유'])
  const sec = {}
  for (const r of main) {
    const k = r['업종'] || '-'
    sec[k] = sec[k] || [0, 0]; sec[k][1]++
    if (r['판정'] === '통과') sec[k][0]++
  }
  const secRatio = Object.entries(sec).filter(([, v]) => v[1] >= 3).map(([k, v]) => [k, v[0] / v[1]])
  secRatio.sort((a, b) => a[1] - b[1])
  const secPct = Object.fromEntries(secRatio.map(([k], i) => [k, secRatio.length > 1 ? i / (secRatio.length - 1) : 0.5]))

  const out = []
  const extra = {}
  const hist = []
  let failed = 0
  let idx = 0
  async function worker() {
    while (idx < cands.length) {
      const r = cands[idx++]
      const code = String(r['코드'] || '').toUpperCase()
      try {
        const bars = await loadBars(sql, market, code)
        const e = evaluate(bars)
        if (!e) { failed++; continue }
        const ib = market === 'US' ? ixb.US : String(r['시장'] || '').includes('KOSDAQ') ? ixb.KOSDAQ : ixb.KOSPI
        const rs = ib ? relStrength(cleanBars(bars), ib) : null
        const accel = market === 'KR' ? await consensusAccel(code) : null
        extra[code] = { row: r, rs, accel }
        for (const [d, type] of e.hist) hist.push([d, r['종목명'], type, code])
        const eps = num(r['EPS증가율']), epsNow = num(r['EPS당분기']), epsPrev = num(r['EPS전년'])
        out.push({
          code, name: r['종목명'], mkt: r['시장'], sector: r['업종'],
          rs: num(r['RS']), score: num(r['종합점수']), price: num(r['현재가']), chg: num(r['등락률']),
          // 스크리너 라벨은 예전 피벗으로 매깁니다 — 서버가 '라벨…' 칸에 따로 남깁니다 (2026-10-10, 없으면 예전 칸)
          old: r['피벗상태'] || '', oldDays: num(r['상태일수']),
          oldGap: num(r['라벨피벗대비이격'] ?? r['피벗대비이격']), oldPivot: num(r['라벨피벗가격'] ?? r['피벗가격']),
          stay: num(r['잔류일']),
          eps, epsTurn: epsPrev != null && epsNow != null && epsPrev <= 0 && epsNow > 0,
          state: e.state, type: e.type || null, gap: e.gap ?? null, pivot: e.pivot ?? null, pivotDate: e.pivotDate || null,
          stop: e.stop ?? null, stopDist: e.stopDist ?? null, baseStart: e.baseStart, baseLen: e.baseLen,
          depth: e.depth ?? null, cons: (e.cons || []).slice(-3), nCons: (e.cons || []).length, dry: e.dry ?? null,
          checks: e.checks, fails: e.fails, warns: e.warns || [], nOk: e.nOk ?? 0, nCk: e.nCk ?? 0,
          zz: (e.zz || []).slice(-10), bo: e.bo || null, barDate: e.date,
          stage: e.stage || null, preAdv: e.preAdv ?? null, adr5: e.adr5 ?? null,
          sq: setupQuality(e, { stay: num(r['잔류일']) }),
        })
      } catch { failed++ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, cands.length) }, worker))
  hist.sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))

  // 실적·수급 점수 (예전 '종목 품질') — RS 는 이제 배점이 없지만 화면 참고용으로 백분위를 남깁니다
  const ex = out.map((o) => extra[o.code]?.rs?.excess).filter((v) => v != null).sort((a, b) => a - b)
  const pctOf = (v) => (v == null || ex.length < 2 ? null : ex.filter((x) => x < v).length / (ex.length - 1))
  for (const o of out) {
    const x = extra[o.code] || {}
    o.rsExcess = x.rs?.excess ?? null
    o.rsNewHigh = !!x.rs?.newHigh
    o.accel = x.accel?.acc ?? null
    o.epsExp = x.accel?.exp ?? null
    o.qq = stockQuality(x.row || {}, { rsPct: pctOf(o.rsExcess), sectorPct: secPct[o.sector] ?? null, accel: o.accel, epsExp: o.epsExp, market })
    // 정렬 점수 — 2026-10-10 부터 **셋업 품질 단독**입니다. 셋업 거래 880건에서 상위 1/3 PF 1.86 · 하위 1.40 으로
    //  검증된 것은 셋업 품질뿐이고, 실적·수급은 아직 검증 전이라 섞지 않습니다 (예전: 셋업 60 : 종목 40)
    o.mix = o.sq ? o.sq.total : null
  }

  const value = {
    stamp, market, version: VERSION, params: P,
    computedAt: new Date().toISOString(), tookMs: Date.now() - t0,
    total: cands.length, failed, rows: out, hist,
  }
  // 절반 넘게 못 받았으면 담아 두지 않습니다 — 다음 방문 때 다시 계산합니다
  if (out.length >= cands.length / 2) {
    try {
      const v = JSON.stringify(value)
      await sql`
        INSERT INTO screener_settings (key, value, updated_at)
        VALUES (${key}, ${v}::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = ${v}::jsonb, updated_at = now()`
    } catch { /* 저장 실패해도 화면은 보여줍니다 */ }
  }
  return json({ ok: true, cached: false, ...value })
}

/* /api/ohlcv 가 담아 둔 일봉이 있으면 그것을, 없으면 새로 받습니다 */
async function loadBars(sql, market, code) {
  try {
    const r = await sql`SELECT value, updated_at FROM screener_settings WHERE key = ${`ohlcv2_${market}_${code}`}`
    if (r.length && Array.isArray(r[0].value?.rows) && r[0].value.rows.length >= 260
        && Date.now() - new Date(r[0].updated_at).getTime() < OH_FRESH)
      return r[0].value.rows
  } catch { /* 새로 받습니다 */ }
  return market === 'US' ? fetchUsOhlcv(code, BARS) : fetchOhlcv(code, 'day', BARS)
}

/* EPS 가속 — 네이버 분기 실적의 마지막 열은 컨센서스(다음 분기 예상)입니다.
   { acc: (예상 분기 전년비 성장률) − (최근 실제 분기 전년비 성장률), exp: 예상 분기 전년비 성장률 }. 컨센서스가 비었으면 null.
   실제 분기는 5개뿐이라 실제 값만으로는 성장률을 하나밖에 못 만듭니다 — 그래서 컨센서스를 씁니다. */
async function consensusAccel(code) {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), 8000)
  try {
    const r = await fetch(`https://m.stock.naver.com/api/stock/${code}/finance/quarter`, {
      cache: 'no-store', signal: ac.signal, headers: { 'user-agent': 'Mozilla/5.0' } })
    const j = await r.json()
    const t = j?.financeInfo
    const heads = (t?.trTitleList || []).map((x) => ({ key: String(x.key || x.title).replace(/\D/g, '').slice(0, 6), est: x.isConsensus === 'Y' }))
    const eps = (t?.rowList || []).find((x) => x.title === 'EPS')?.columns || {}
    const val = (k) => { const v = Number(String(eps[k]?.value ?? '').replace(/,/g, '')); return Number.isFinite(v) && eps[k]?.value !== '-' ? v : null }
    const est = heads.find((h) => h.est), real = heads.filter((h) => !h.est)
    if (!est || real.length < 5) return null
    const lastReal = real[real.length - 1].key
    const yago = (k) => String(Number(k.slice(0, 4)) - 1) + k.slice(4)
    const g = (k) => { const a = val(k), b = val(yago(k)); return a == null || b == null || b <= 0 ? null : a / b - 1 }
    const ge = g(est.key), gr = g(lastReal)
    return ge == null || gr == null ? null : { acc: ge - gr, exp: ge }
  } catch { return null } finally { clearTimeout(timer) }
}
