// ============================================================
//  홈 화면 자료 — 지수 · 수급 · 순위
//  · 60초 동안은 저장해 둔 값을 그대로 돌려줍니다 (네이버 부담을 줄이려고).
//  · ?debug=1 을 붙이면 어느 자료를 받았고 어디서 실패했는지 보여줍니다.
//  · 로그인 없이도 볼 수 있습니다.
// ============================================================
import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { currentUser } from '@/lib/auth'
import { ensureSettings } from '@/lib/settings'
import {
  fetchIndex, fetchIndexSeries, fetchMarketDetail, fetchMarketSum, fetchRise,
  fetchWorld, isPlainStock,
} from '@/lib/naver'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TTL = 60 * 1000        // 60초
const TOPN = 30              // 순위 몇 개까지 (2026-08-23: 10 → 30)
// 저장 형식이 바뀌면 이 번호를 올립니다 (옛 값을 그냥 버립니다)
const CACHE_VER = 6          // 2026-08-30: 시장 지도를 코스피·코스닥 **따로** 뽑습니다 · 5: 업종 줄에 소속 종목(members) 추가

async function build() {
  const errors = []
  const tryIt = async (label, fn, fallback = null) => {
    try { return await fn() } catch (e) { errors.push(`${label}: ${e?.message || e}`); return fallback }
  }

  // 서로 독립적인 공개 자료를 함께 받습니다. 지수 출력 순서는 유지합니다.
  const [indexRows, world, kospi, kosdaq, riseK, riseQ] = await Promise.all([
    Promise.all(['KOSPI', 'KOSDAQ'].map(async (code) => {
      const [base, series, detail] = await Promise.all([
        tryIt(`지수 ${code}`, () => fetchIndex(code)),
        tryIt(`차트 ${code}`, () => fetchIndexSeries(code), { kind: null, points: [] }),
        tryIt(`수급 ${code}`, () => fetchMarketDetail(code), { flow: {}, updown: {} }),
      ])
      return base ? { ...base, series, ...detail } : null
    })),
    tryIt('아시아 지수', () => fetchWorld(), { list: [], tried: [] }),
    tryIt('시가총액 KOSPI', () => fetchMarketSum(0, 3), []),
    tryIt('시가총액 KOSDAQ', () => fetchMarketSum(1, 3), []),
    tryIt('상승률 KOSPI', () => fetchRise(0), []),
    tryIt('상승률 KOSDAQ', () => fetchRise(1), []),
  ])
  const indices = indexRows.filter(Boolean)
  // ETF·ETN·스팩·우선주는 순위에서 뺍니다
  const all = [...kospi, ...kosdaq].filter((r) => isPlainStock(r.name))
  const top = (key, n = TOPN) => all
    .filter((r) => r[key] != null)
    .sort((a, b) => b[key] - a[key]).slice(0, n)

  // 업종 이름 — 최신 스크리닝 결과에서 종목코드로 찾아 붙입니다.
  //  히트맵과 업종 순위가 같은 표를 씁니다.
  let sector = {}
  try {
    const s = await getSql()
    /* ⚠️ `WHERE market='KR'` 이 꼭 있어야 합니다 (2026-08-23 에 찾은 버그).
       이 줄이 없으면 **가장 최근 결과**를 집어 오는데, 미국 스크리너가 나중에 돌면
       미국 payload 가 잡힙니다. 그러면 한국 종목코드를 하나도 못 찾아
       홈 화면의 업종 히트맵과 업종 순위가 통째로 비어 버립니다.
       수동 실행이 '한국 → 미국' 순서가 되면서 미국이 마지막인 경우가 흔해졌습니다. */
    const r = await s`SELECT payload FROM screener_snapshot
                      WHERE market = 'KR' ORDER BY created_at DESC LIMIT 1`
    const rows = r.length ? JSON.parse(r[0].payload) : []
    for (const x of rows) {
      const c = String(x['코드'] ?? '').padStart(6, '0')
      if (c && x['업종']) sector[c] = String(x['업종'])
    }
  } catch { sector = {} }

  /* 상승률 — 네이버 '상승률' 표를 씁니다.
     못 읽었으면(표 모양이 바뀌었거나 막혔으면) 시가총액 표에서 등락률로 뽑아
     대신 채웁니다. 화면이 비는 것보다 낫습니다. */
  const riseRaw = [...riseK, ...riseQ].filter((r) => isPlainStock(r.name) && r.rate != null)
  const rise = riseRaw.length >= 5
    ? riseRaw.sort((a, b) => b.rate - a.rate).slice(0, TOPN)
    : top('rate')
  if (!riseRaw.length) errors.push('상승률: 네이버 표를 못 읽어 시가총액 표에서 대신 뽑았습니다')

  /* ── 업종 순위 ───────────────────────────────────────────
     같은 종목들을 업종으로 묶습니다. 값은 합계, 등락률은 **시가총액 가중 평균**입니다.
     (단순 평균을 쓰면 작은 종목 하나가 업종 전체를 좌우합니다)
     업종을 모르는 종목은 아예 뺍니다 — '기타' 라는 큰 덩어리가 1등을 차지해
     아무 뜻이 없어지기 때문입니다. */
  function bySector(key) {
    const g = new Map()
    for (const r of all) {
      const s2 = sector[r.code]
      if (!s2 || r[key] == null) continue
      const cur = g.get(s2) || { name: s2, code: '', sum: 0, w: 0, wr: 0, n: 0, mem: [] }
      cur.sum += r[key]; cur.n += 1
      // 어느 종목이 이 업종에 들어 있는지도 같이 보냅니다 (화면에서 커서를 올리면 보입니다)
      cur.mem.push({ code: r.code, name: r.name, rate: r.rate ?? null, v: r[key] })
      if (r.rate != null && r.marcap != null) { cur.w += r.marcap; cur.wr += r.marcap * r.rate }
      g.set(s2, cur)
    }
    const fmt = key === 'marcap' ? (v) => `${(v / 10000).toFixed(1)}조`
      : key === 'volume' ? (v) => `${Math.round(v / 10000).toLocaleString('ko-KR')}만주`
      : (v) => `${Math.round(v / 1e8).toLocaleString('ko-KR')}억`
    return [...g.values()]
      .sort((a, b) => b.sum - a.sum).slice(0, TOPN)
      .map((x) => ({
        code: '', name: x.name, price: null, disp: fmt(x.sum),
        rate: x.w ? Math.round((x.wr / x.w) * 100) / 100 : null, n: x.n,
        // 값이 큰 순으로 열둘까지. 화면 미니 상자에 그대로 찍힙니다
        members: x.mem.sort((a, b) => (b.v ?? 0) - (a.v ?? 0)).slice(0, 12)
          .map((m) => ({ code: m.code, name: m.name, rate: m.rate, disp: fmt(m.v) })),
      }))
  }

  /* 상승률의 업종판 — 값이 아니라 **등락률로 줄 세웁니다** */
  function riseSector() {
    const g = new Map()
    for (const r of all) {
      const s2 = sector[r.code]
      if (!s2 || r.rate == null || r.marcap == null) continue
      const cur = g.get(s2) || { name: s2, w: 0, wr: 0, n: 0, mem: [] }
      cur.w += r.marcap; cur.wr += r.marcap * r.rate; cur.n += 1
      cur.mem.push({ code: r.code, name: r.name, rate: r.rate })
      g.set(s2, cur)
    }
    return [...g.values()]
      .map((x) => ({ code: '', name: x.name, price: null, disp: `${x.n}종목`,
                     rate: x.w ? Math.round((x.wr / x.w) * 100) / 100 : null, n: x.n,
                     // 상승률 상자는 많이 오른 종목부터 보여줍니다
                     members: x.mem.sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0)).slice(0, 12)
                       .map((m) => ({ code: m.code, name: m.name, rate: m.rate, disp: null })) }))
      .filter((x) => x.rate != null)
      .sort((a, b) => b.rate - a.rate).slice(0, TOPN)
  }

  /* 시장 지도 — 코스피·코스닥을 **따로** 뽑습니다 (2026-08-30, Jun 지적).
     전에는 두 시장을 섞어 시가총액 상위 120종목만 골랐습니다. 그런데
     시가총액은 코스피가 압도적이라, 120칸 중 코스닥이 열 몇 개밖에
     못 들어갔습니다. 화면은 시장을 갈라서 보여주는데 자료를 섞어 자른 것이라
     "코스닥 지도가 텅 비는" 일이 생겼습니다.
     시장마다 100종목씩 뽑으면 두 지도 모두 제 모습이 나옵니다. */
  const HEAT_PER_MARKET = 100
  const pickHeat = (mkt) => all
    .filter((r) => r.market === mkt && r.marcap != null && r.rate != null)
    .sort((a, b) => b.marcap - a.marcap)
    .slice(0, HEAT_PER_MARKET)
  const heat = [...pickHeat('KOSPI'), ...pickHeat('KOSDAQ')]
    .map((r) => ({
      code: r.code, name: r.name, market: r.market,
      marcap: r.marcap, rate: r.rate, price: r.price,
      sector: sector[r.code] || '기타',
    }))

  return {
    v: CACHE_VER,
    stamp: new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' '),
    indices,
    world: world.list,
    worldTried: world.tried,          // 실패한 것만 남습니다 (평소엔 빈 목록)
    heat,
    ranks: {
      // 종목
      marcap: top('marcap'), volume: top('volume'),
      amount: top('amount'), rise,
      // 업종 — 화면의 [섹터] 뱃지를 누르면 이쪽으로 바뀝니다
      marcapS: bySector('marcap'), volumeS: bySector('volume'),
      amountS: bySector('amount'), riseS: riseSector(),
      // 업종 이름을 몇 종목이나 찾았는지 (0 이면 화면이 안내를 띄웁니다)
      sectorKnown: all.filter((r) => sector[r.code]).length,
    },
    errors,
  }
}

export async function GET(request) {
  // ?debug=1 은 저장해 둔 값을 건너뛰고 네이버를 다시 긁습니다.
  // 아무나 반복해서 부르면 네이버에서 차단당할 수 있어 관리자만 쓸 수 있게 합니다.
  let debug = new URL(request.url).searchParams.get('debug') === '1'
  if (debug) {
    try { const u = await currentUser(); debug = Boolean(u && u.role === 'admin') }
    catch { debug = false }
  }
  let sql = null
  try { sql = await getSql(); await ensureSettings(sql) } catch { sql = null }

  if (sql && !debug) {
    try {
      const r = await sql`SELECT value, updated_at FROM screener_settings WHERE key = 'market'`
      if (r.length && r[0].value?.v === CACHE_VER
          && Date.now() - new Date(r[0].updated_at).getTime() < TTL)
        return NextResponse.json({ ok: true, cached: true, ...r[0].value },
          { headers: { 'content-type': 'application/json; charset=utf-8' } })
    } catch { /* 캐시 없으면 그냥 새로 만듭니다 */ }
  }

  const data = await build()
  if (sql) {
    try {
      const json = JSON.stringify(data)
      await sql`
        INSERT INTO screener_settings (key, value, updated_at)
        VALUES ('market', ${json}::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = ${json}::jsonb, updated_at = now()`
    } catch { /* 저장 실패해도 화면은 그대로 보여줍니다 */ }
  }
  return NextResponse.json({ ok: true, cached: false, ...data },
    { headers: { 'content-type': 'application/json; charset=utf-8' } })
}
