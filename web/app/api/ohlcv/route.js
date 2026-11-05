// ============================================================
//  일봉 · 주봉 — 검색 화면 큰 차트에서 씁니다.
//
//  2026-08-23 에 세 가지를 바꿨습니다.
//   ① **미국 종목도 됩니다.** 예전에는 종목코드를 숫자만 남기고 6자리로 맞춰서,
//      'AKTS' 같은 티커가 '000000' 이 되어 네이버에 물어보고 빈 값이 왔습니다.
//      (화면에 뜨던 "시세가 비어 있습니다" 가 그것입니다)
//      미국은 Massive(옛 Polygon) 일봉을 씁니다 — lib/massive.js 와 같은 창구.
//   ② **한 종목당 요청 한 번.** 일봉을 넉넉히(기본 420봉) 내려주고
//      주봉은 그것을 묶어서 만듭니다. 탭을 눌러도 다시 부르지 않습니다.
//   ③ **담아 두는 시간을 장 시간에 맞춰 늘렸습니다.** 봉은 하루에 한 번
//      정해지므로, 장이 닫혀 있으면 10분마다 다시 받을 이유가 없습니다.
//
//  · 로그인한 사람만 볼 수 있습니다 (상세 정보와 같은 기준).
// ============================================================
import { NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth'
import { getSql } from '@/lib/db'
import { ensureSettings } from '@/lib/settings'
import { fetchOhlcv, fetchUsLong } from '@/lib/naver'
import { fetchUsOhlcv, hasUS } from '@/lib/massive'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const UTF8 = { 'content-type': 'application/json; charset=utf-8' }
const json = (o, init) => NextResponse.json(o, { ...init, headers: UTF8 })

const BARS = 420            // 일봉 몇 개를 내려줄까 (주봉 80개를 만들 수 있는 양)
const LONG_YEARS = 20       // span=long — 주봉·월봉을 몇 년치 내려줄까 (2026-10-03)
const LONG_DAY_YEARS = 10   // span=long — 일봉은 10년치 (끌어서 옛날로 계속 갈 수 있게)

/* 담아 둘 시간.
   한국 — 장중(평일 08:50~15:50 KST)에는 10분, 그 밖에는 6시간.
   미국 — 종가가 하루 한 번이라 12시간. */
function ttlFor(market) {
  if (market === 'US') return 12 * 3600 * 1000
  const k = new Date(Date.now() + 9 * 3600 * 1000)      // KST
  const wd = k.getUTCDay()                              // 0 일 · 6 토
  const min = k.getUTCHours() * 60 + k.getUTCMinutes()
  const open = wd >= 1 && wd <= 5 && min >= 530 && min <= 950
  return open ? 10 * 60 * 1000 : 6 * 3600 * 1000
}

/* 일봉을 주봉으로 묶습니다.
   시가 = 그 주 첫날 시가 · 고가 = 최고 · 저가 = 최저 · 종가 = 마지막 날 종가.
   화면(app.html)의 toWeek() 과 같은 규칙입니다 — 한쪽만 고치지 말 것. */
function toWeek(rows) {
  const out = []
  let cur = null; let key = null
  for (const r of rows) {
    const d = String(r.d)
    // 그 날짜가 속한 주의 월요일을 열쇠로 씁니다
    const dt = new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)))
    dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7))
    const k = dt.toISOString().slice(0, 10)
    if (k !== key) {
      if (cur) out.push(cur)
      key = k
      cur = { d: r.d, o: r.o, h: r.h, l: r.l, c: r.c, v: r.v || 0 }
    } else {
      if (r.h != null) cur.h = cur.h == null ? r.h : Math.max(cur.h, r.h)
      if (r.l != null) cur.l = cur.l == null ? r.l : Math.min(cur.l, r.l)
      cur.c = r.c
      cur.d = r.d                       // 그 주 마지막 거래일로 적습니다
      cur.v = (cur.v || 0) + (r.v || 0)
    }
  }
  if (cur) out.push(cur)
  return out
}

export async function GET(request) {
  const u = await currentUser()
  if (!u) return json({ ok: false, error: '로그인이 필요합니다' }, { status: 401 })

  const q = new URL(request.url).searchParams
  const raw = String(q.get('code') || '').trim().toUpperCase()
  const tf = q.get('tf') === 'week' ? 'week' : 'day'

  // 시장 가르기.
  //  한국 — 숫자로 시작하는 6글자. **끝 한 글자가 알파벳일 수 있습니다.**
  //    신형우선주가 그렇습니다 (CJ4우 00104K · 한화3우B 03473K …).
  //    2026-08-24 전까지는 \d{6} 만 봐서 이런 종목의 차트가 통째로 비었습니다.
  //  미국 — 알파벳으로 시작하는 티커.
  let market = null; let code = null
  if (/^\d{5}[0-9A-Z]$/.test(raw)) { market = 'KR'; code = raw }
  else if (/^[A-Z][A-Z.\-]{0,6}$/.test(raw)) { market = 'US'; code = raw }
  else return json({ ok: false, error: `종목코드를 알아보지 못했습니다 (${raw.slice(0, 12)})` })

  if (market === 'US' && !hasUS())
    return json({ ok: false, error: '미국 일별 시세를 아직 받지 못했습니다' })

  const long = q.get('span') === 'long'
  const key = long
    ? `ohlcvL2_${market}_${code}`        // 일봉 10년치가 더해져 이름을 바꿨습니다
    : `ohlcv2_${market}_${code}`        // 모양이 바뀌어 이름도 바꿨습니다
  const TTL = ttlFor(market)

  let sql = null
  try { sql = await getSql(); await ensureSettings(sql) } catch { sql = null }

  /* ── 긴 차트 (2026-10-03) ─────────────────────────────────────
     일봉 420개(1년 8개월)로는 3년·5년·10년을 볼 수 없습니다.
     주봉·월봉은 봉 수가 적으니 20년치를 따로 한 번에 내려줍니다.
     화면은 일봉을 먼저 그리고, 주봉·월봉을 누르거나 긴 기간을 고를 때만 이것을 부릅니다.
     최근 몇 주·몇 달은 화면이 일봉으로 만든 것을 그대로 쓰고 이 자료는 그 앞에 잇습니다. */
  if (long) {
    if (sql) {
      try {
        const r = await sql`SELECT value, updated_at FROM screener_settings WHERE key = ${key}`
        if (r.length && Array.isArray(r[0].value?.weekly)
            && Date.now() - new Date(r[0].updated_at).getTime() < TTL)
          return json({ ok: true, cached: true, code, market, ...r[0].value })
      } catch { /* 없으면 새로 받습니다 */ }
    }
    let weekly, monthly, daily
    try {
      ;[weekly, monthly, daily] = market === 'US'
        ? await Promise.all([fetchUsLong(code, 'week', LONG_YEARS),
                             fetchUsLong(code, 'month', LONG_YEARS),
                             fetchUsLong(code, 'day', LONG_DAY_YEARS).catch(() => [])])
        : await Promise.all([fetchOhlcv(code, 'week', LONG_YEARS * 53),
                             fetchOhlcv(code, 'month', LONG_YEARS * 12),
                             fetchOhlcv(code, 'day', LONG_DAY_YEARS * 250).catch(() => [])])
    } catch (e) {
      return json({ ok: false, error: String(e?.message || e) })
    }
    if (!Array.isArray(weekly) || weekly.length < 3)
      return json({ ok: false, error: '긴 시세가 비어 있습니다' })
    const value = { weekly, monthly: Array.isArray(monthly) ? monthly : [],
                    daily: Array.isArray(daily) ? daily : [] }
    if (sql) {
      try {
        const v = JSON.stringify(value)
        await sql`
          INSERT INTO screener_settings (key, value, updated_at)
          VALUES (${key}, ${v}::jsonb, now())
          ON CONFLICT (key) DO UPDATE SET value = ${v}::jsonb, updated_at = now()`
      } catch { /* 저장 실패해도 화면은 보여줍니다 */ }
    }
    return json({ ok: true, cached: false, code, market, ...value })
  }

  const send = (rows, cached) => json({
    ok: true, cached, code, market, tf,
    // 예전 화면은 tf 에 맞는 봉만 받습니다. 새 화면은 rows(일봉) 하나만 받아
    //  주봉을 스스로 만듭니다 — 그래서 종목당 요청이 한 번으로 줄었습니다.
    rows: tf === 'week' ? toWeek(rows) : rows,
    daily: rows,
  })

  if (sql) {
    try {
      const r = await sql`SELECT value, updated_at FROM screener_settings WHERE key = ${key}`
      if (r.length && Array.isArray(r[0].value?.rows)
          && Date.now() - new Date(r[0].updated_at).getTime() < TTL)
        return send(r[0].value.rows, true)
    } catch { /* 없으면 새로 받습니다 */ }
  }

  let rows
  try {
    rows = market === 'US'
      ? await fetchUsOhlcv(code, BARS)
      : await fetchOhlcv(code, 'day', BARS)
  } catch (e) {
    return json({ ok: false, error: String(e?.message || e) })
  }
  if (!Array.isArray(rows) || rows.length < 3)
    return json({ ok: false, error: '시세가 비어 있습니다' })

  if (sql) {
    try {
      const v = JSON.stringify({ rows })
      await sql`
        INSERT INTO screener_settings (key, value, updated_at)
        VALUES (${key}, ${v}::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = ${v}::jsonb, updated_at = now()`
      /* 오래 안 본 봉 자료는 치웁니다 (2026-08-24).
         한 종목이 420봉 × 여러 칸이라 한 줄에 30~40KB 입니다. 검색으로 훑다 보면
         수백 줄이 쌓이는데, 사흘 지난 것은 어차피 다시 받아야 하는 값입니다.
         저장공간이 꽉 차 사이트가 멈춘 날(2026-08-24) 얻은 교훈입니다 —
         **담아 두는 것에는 반드시 치우는 규칙이 함께 있어야 합니다.**
         매번 훑으면 그것대로 부담이라 스무 번에 한 번만 합니다. */
      if (Math.random() < 0.05)
        await sql`DELETE FROM screener_settings
                  WHERE key LIKE 'ohlcv%' AND updated_at < now() - interval '3 days'`
    } catch { /* 저장 실패해도 화면은 보여줍니다 */ }
  }
  return send(rows, false)
}
