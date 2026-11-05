// ============================================================
//  미국 시장 화면 자료 — 지수 옆 US 뱃지와 US 히트맵에서 씁니다.
//   · 하루 한 번만 받아 저장합니다 (미국 종가는 하루에 한 번 정해집니다).
//   · 무료 등급이 '개인 사용' 조건이라, 지금은 로그인한 사람에게만 보냅니다.
//     공개할 단계가 되면 유료 등급으로 올리고 이 빗장을 풀면 됩니다.
// ============================================================
import { NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth'
import { getSql } from '@/lib/db'
import { ensureSettings } from '@/lib/settings'
import {
  fetchUsDay, plainStocks, breadth, lastUsDay, hasUS, sectorOf,
  fetchTickerDaily, retOver, IDX_PROXY,
} from '@/lib/massive'
//  세부 업종을 11갈래 대분류로 묶는 표 — 히트맵을 2단으로 그릴 때 씁니다
import { bigOf } from '@/lib/us_sectors'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UTF8 = { 'content-type': 'application/json; charset=utf-8' }
const json = (o, init) => NextResponse.json(o, { ...init, headers: UTF8 })

const KEY = 'us_market'
const TTL = 6 * 3600 * 1000        // 6시간 (종가는 하루 한 번이라 넉넉히)
// 담아 두는 내용의 모양이 바뀌면 이 번호를 올립니다.
//  그러면 예전에 담아 둔 값은 무시하고 새로 받습니다.
//  (지수 차트를 새로 넣었는데 6시간짜리 옛 값이 그대로 나와 '불러오는 중'에서
//   멈춰 있었습니다 — 그 일을 막기 위한 것입니다)
const CACHE_VER = 4
// 히트맵에 그릴 종목 수.
//  야후는 200개가 넘습니다. 120개면 화면 아래쪽이 휑하고,
//  중형주가 통째로 빠져 '어느 업종이 움직였나' 가 덜 보입니다.
const TOP = 300

/* 히트맵을 시가총액으로 그리기 위한 자료.
   시가총액 = 주가 × 발행주식수 인데, 발행주식수는 종목마다 따로 물어봐야 해서
   이 창구에서는 받을 수 없습니다(5,000종목 × 12초). 그래서 AWS 서버가 하룻밤
   걸려 받아 두고 스크리닝 결과와 함께 올려 준 것을 여기서 꺼내 씁니다. */
async function uploadedHeat(sql) {
  if (!sql) return null
  try {
    const r = await sql`SELECT value, updated_at FROM screener_settings WHERE key = 'us_heat'`
    const list = r[0]?.value?.list
    if (!Array.isArray(list) || !list.length) return null
    // 사흘 넘게 갱신이 없으면 낡은 것으로 봅니다
    if (Date.now() - new Date(r[0].updated_at).getTime() > 3 * 24 * 3600 * 1000) return null
    return { list, stamp: r[0].value?.stamp || null }
  } catch { return null }
}

async function build(sql) {
  // 주말·휴장이면 자료가 없습니다. 열렸던 날을 만날 때까지 하루씩 거슬러 갑니다.
  //  (일요일에 보면 금요일 종가가 나옵니다. 월요일 장이 끝나면 그 값으로 바뀝니다.)
  let day = null; let rows = null; let total = 0; let last = null
  for (let back = 0; back < 6; back++) {
    try {
      const r = await fetchUsDay(lastUsDay(back))
      day = r.day; rows = r.rows; total = r.total
      break
    } catch (e) { last = e }
  }
  if (!rows) throw last || new Error('최근 미국장 자료를 찾지 못했습니다')

  // 시장 폭은 '개별 성장주' 기준으로 셉니다 (ETF 를 섞으면 뜻이 흐려집니다)
  const plain = plainStocks(rows)
  const br = breadth(plain)

  // 히트맵 — 서버가 올려 준 시가총액 자료가 있으면 그것을 씁니다.
  //  한국 히트맵과 같은 기준(상자=시가총액, 색=등락률)이 되어 나란히 놓고 볼 수 있습니다.
  //  아직 없으면 거래대금으로 대신 그립니다 (발행주식수를 모르면 시총을 못 셉니다).
  let top = []
  let heatBy = '거래대금'
  const up = await uploadedHeat(sql)
  if (up) {
    // 시가총액은 서버가 받아 둔 발행주식수 기준이라 며칠 지나면 조금 어긋납니다.
    //  오늘 종가를 알고 있으니 여기서 다시 맞춥니다.
    const px = new Map(rows.map((r) => [r.sym, r]))
    top = up.list.map((h) => {
      const now = px.get(h.sym)
      const ref = h.c && h.marcap ? h.marcap / h.c : null      // 발행주식수 되계산
      return {
        sym: h.sym,
        c: now ? now.c : h.c,
        rate: now ? now.rate : h.rate,
        marcap: ref && now ? ref * now.c : h.marcap,
        sector: h.sector || '기타',
        // 히트맵을 2단(대분류 → 업종 → 종목)으로 그리려고 여기서 붙입니다.
        //  AWS 가 올려 주는 자료에는 세부 업종만 있습니다. 읽을 때 붙이면
        //  미국 스크리너를 다시 돌리지 않아도 오늘 바로 반영됩니다.
        big: bigOf(h.sector),
        name: h.name || null,          // 마우스를 올렸을 때 보여줄 정식 사명
      }
    }).filter((r) => r.marcap > 0)
      .sort((a, b) => b.marcap - a.marcap).slice(0, TOP)
    heatBy = '시가총액'
  } else {
    top = [...plain].sort((a, b) => b.amt - a.amt).slice(0, TOP)
      .map((r) => {
        const sec = sectorOf(r.sym)
        return { sym: r.sym, c: r.c, rate: r.rate, amt: r.amt, sector: sec, big: bigOf(sec) }
      })
  }

  // 지수 차트 — 대표 ETF 의 90일 일봉을 씁니다 (호출 3번)
  const idx = []
  for (const it of IDX_PROXY) {
    try {
      const bars = await fetchTickerDaily(it.sym, 100)
      const closes = bars.map((b) => b.c)
      idx.push({
        name: it.name, proxy: it.sym,
        closes: closes.slice(-60),
        r5: retOver(closes, 5), r20: retOver(closes, 20), r60: retOver(closes, 60),
      })
    } catch (e) {
      idx.push({ name: it.name, proxy: it.sym, closes: [], error: String(e?.message || e) })
    }
  }

  return {
    v: CACHE_VER,
    day, 검사종목: total, 개별주: plain.length,
    breadth: br,
    idx,
    heat: top,
    heatBy,
    note: heatBy === '시가총액'
      ? '상자 크기는 시가총액, 색은 등락률입니다'
      : '상자 크기는 거래대금입니다 (시가총액 자료를 아직 못 받았습니다)',
  }
}

// 히트맵이 이상할 때 실제 값을 들여다보는 창구입니다.
//   /api/us?debug=heat  → 시가총액 상위 25종목 + 업종별 집계
//  (이 창구도 로그인한 사람만 씁니다 — 아래 GET 이 먼저 막습니다)
function debugHeat(data) {
  const h = data.heat || []
  const fmt = (v) => (v == null ? null : Math.round(v / 1e8) / 100)   // 억달러
  const bySector = {}
  for (const r of h) {
    const k = r.sector || '(없음)'
    if (!bySector[k]) bySector[k] = { n: 0, marcap: 0 }
    bySector[k].n++
    bySector[k].marcap += r.marcap || 0
  }
  return {
    heatBy: data.heatBy,
    종목수: h.length,
    시총없는종목: h.filter((r) => !(r.marcap > 0)).length,
    상위25: [...h].sort((a, b) => (b.marcap || 0) - (a.marcap || 0)).slice(0, 25)
      .map((r) => ({ sym: r.sym, 업종: r.sector, 종가: r.c, 시총억달러: fmt(r.marcap) })),
    업종별: Object.entries(bySector)
      .map(([k, v]) => ({ 업종: k, 종목수: v.n, 시총억달러: fmt(v.marcap) }))
      .sort((a, b) => b.시총억달러 - a.시총억달러),
  }
}

export async function GET(request) {
  if (!hasUS())
    return json({ ok: false, error: '미국 일별 시세를 아직 받지 못했습니다' })

  // 2026-08-20: 유료 자료(Starter) 전환으로 히트맵도 모두에게 엽니다.
  //  (?force=1 캐시 무시는 여전히 관리자만)
  const u = await currentUser()

  let sql = null
  try { sql = await getSql(); await ensureSettings(sql) } catch { sql = null }

  const dbg = new URL(request.url).searchParams.get('debug') === 'heat'

  // ?force=1 — 캐시를 무시하고 새로 만듭니다 (관리자만)
  const force = new URL(request.url).searchParams.get('force') === '1'
    && Boolean(u && u.role === 'admin')

  if (sql && !force) {
    try {
      const r = await sql`SELECT value, updated_at FROM screener_settings WHERE key = ${KEY}`
      // 서울 서버가 새 히트맵(us_heat)을 올렸으면 캐시가 아직 살아 있어도 비켜 줍니다.
      //  2026-08-19: 오후 3시에 시가총액 히트맵이 도착했는데 6시간 캐시에 막혀
      //  화면이 그대로였습니다. 자료가 새로 왔는데 옛것을 보여주는 것이 제일 나쁩니다.
      let heatAt = 0
      try {
        const h = await sql`SELECT updated_at FROM screener_settings WHERE key = 'us_heat'`
        if (h.length) heatAt = new Date(h[0].updated_at).getTime()
      } catch { /* 없으면 0 */ }

      if (r.length && r[0].value?.v === CACHE_VER
          && Date.now() - new Date(r[0].updated_at).getTime() < TTL
          && heatAt <= new Date(r[0].updated_at).getTime())
        return json(dbg ? { ok: true, cached: true, ...debugHeat(r[0].value) }
          : { ok: true, cached: true, ...r[0].value })
    } catch { /* 없으면 새로 받습니다 */ }
  }

  let data
  try { data = await build(sql) }
  catch (e) { return json({ ok: false, error: String(e?.message || e) }) }

  if (sql) {
    try {
      const v = JSON.stringify(data)
      await sql`
        INSERT INTO screener_settings (key, value, updated_at)
        VALUES (${KEY}, ${v}::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = ${v}::jsonb, updated_at = now()`
    } catch { /* 저장 실패해도 화면은 보여줍니다 */ }
  }
  return json(dbg ? { ok: true, cached: false, ...debugHeat(data) }
    : { ok: true, cached: false, ...data })
}
