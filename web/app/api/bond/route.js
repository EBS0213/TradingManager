// ============================================================
//  국채 금리 — 미국 10·30년 · 일본 10·30년 · 한국 10년
//
//  · GET /api/bond          → 다섯 줄 (30분 담아 둡니다)
//  · GET /api/bond?debug=1  → 어디에 물어봤고 무엇이 왔는지 함께 (고칠 때 씁니다)
//
//  하나가 빠져도 나머지는 그대로 내려줍니다. 화면은 빠진 줄만 '-' 로 그립니다.
//  금리는 하루 한 번 바뀌는 값이라 30분 담아 두어도 손해가 없고,
//  대신 사람이 들어올 때마다 재무부·재무성을 두드리지 않습니다.
// ============================================================
import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { ensureSettings } from '@/lib/settings'
import { fetchBonds } from '@/lib/bond'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const KEY = 'bond'
const TTL = 30 * 60 * 1000
const UTF8 = { 'content-type': 'application/json; charset=utf-8' }
const json = (o) => NextResponse.json(o, { headers: UTF8 })

export async function GET(request) {
  const debug = new URL(request.url).searchParams.get('debug') === '1'

  let sql = null
  try { sql = await getSql(); await ensureSettings(sql) } catch { sql = null }

  if (sql) {
    try {
      const r = await sql`SELECT value, updated_at FROM screener_settings WHERE key = ${KEY}`
      if (r.length && Array.isArray(r[0].value?.items) && r[0].value.items.length
          && Date.now() - new Date(r[0].updated_at).getTime() < TTL)
        return json({ ok: true, cached: true, stamp: r[0].updated_at,
                      items: r[0].value.items,
                      ...(debug ? { tried: r[0].value.tried, errors: r[0].value.errors } : {}) })
    } catch { /* 담아 둔 것이 없으면 새로 받습니다 */ }
  }

  let got = { items: [], errors: [], tried: [] }
  try { got = await fetchBonds() } catch (e) { got.errors.push(String(e?.message || e)) }

  // 하나도 못 받았으면 **담아 둔 옛 값이라도** 내보냅니다.
  //  어제 금리라도 보여 주는 편이 빈 표보다 낫습니다.
  if (!got.items.length && sql) {
    try {
      const r = await sql`SELECT value, updated_at FROM screener_settings WHERE key = ${KEY}`
      if (Array.isArray(r[0]?.value?.items) && r[0].value.items.length)
        return json({ ok: true, stale: true, stamp: r[0].updated_at, items: r[0].value.items,
                      ...(debug ? { tried: got.tried, errors: got.errors } : {}) })
    } catch { /* 그것도 없으면 빈 채로 갑니다 */ }
  }

  if (sql && got.items.length) {
    try {
      const v = JSON.stringify(got)
      await sql`
        INSERT INTO screener_settings (key, value, updated_at)
        VALUES (${KEY}, ${v}::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = ${v}::jsonb, updated_at = now()`
    } catch { /* 저장 못 해도 화면에는 보여줍니다 */ }
  }

  return json({ ok: true, cached: false, stamp: new Date().toISOString(), items: got.items,
                ...(debug ? { tried: got.tried, errors: got.errors } : {}) })
}
