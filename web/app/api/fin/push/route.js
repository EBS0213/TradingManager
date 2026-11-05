// ============================================================
//  재무제표 받아두기 — AWS 서버(서울) → 여기로 POST
//
//  DART 재무제표는 회사당 12번을 불러야 12분기가 모입니다.
//  화면을 열 때마다 그럴 수는 없으니, 서버가 하루 한 번 받아 두고
//  여기로 보냅니다. 리포트는 이 자료를 재료로 씁니다.
//
//  ※ 담기는 것은 숫자와 계산값뿐입니다. 공시 원문은 담지 않습니다.
// ============================================================
import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { ensureSettings } from '@/lib/settings'
import { FIN_KEY } from '@/lib/fin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UTF8 = { 'content-type': 'application/json; charset=utf-8' }
const json = (o, init) => NextResponse.json(o, { ...init, headers: UTF8 })

function keyOk(request) {
  const k = request.headers.get('x-screener-key') || ''
  return Boolean(process.env.SCREENER_KEY) && k === process.env.SCREENER_KEY
}

export async function POST(request) {
  if (!keyOk(request)) return json({ ok: false, error: '키가 올바르지 않습니다.' }, { status: 401 })

  let body
  try { body = await request.json() }
  catch { return json({ ok: false, error: '본문을 읽지 못했습니다' }, { status: 400 }) }

  const src = body?.fin
  if (!src || typeof src !== 'object')
    return json({ ok: false, error: 'fin 이 없습니다' }, { status: 400 })

  const sql = await getSql()
  await ensureSettings(sql)

  // 이미 담아 둔 것과 합칩니다 (이번에 안 보낸 종목을 잃지 않도록)
  let store = {}
  try {
    const r = await sql`SELECT value FROM screener_settings WHERE key = ${FIN_KEY}`
    if (r.length && r[0].value && typeof r[0].value === 'object') store = r[0].value
  } catch { /* 없으면 새로 */ }

  let n = 0
  for (const [code, d] of Object.entries(src)) {
    if (!/^\d{6}$/.test(code)) continue
    if (!d || typeof d !== 'object') continue
    store[code] = d
    n++
  }

  const v = JSON.stringify(store)
  await sql`
    INSERT INTO screener_settings (key, value, updated_at)
    VALUES (${FIN_KEY}, ${v}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = ${v}::jsonb, updated_at = now()`

  const withData = Object.values(store).filter((x) => (x?.분기 || []).length).length
  return json({ ok: true, saved: n, 보유종목: Object.keys(store).length, 재무있음: withData })
}
