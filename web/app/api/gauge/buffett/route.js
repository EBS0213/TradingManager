// ============================================================
//  버핏지수 받아 두기 (서울 서버가 밀어 넣습니다)
//
//  왜 이렇게 하나
//   사이트는 미국 서버에서 도는데 FRED 가 응답하지 않습니다
//   (25초를 기다려도 aborted). 뉴스1·한국경제와 같은 상황이라
//   같은 해법을 씁니다 — 서울 서버가 받아서 여기로 보냅니다.
//
//  POST /api/gauge/buffett   { ratio, anchor, anchorAt, approx, note }
//    헤더 x-screener-key
// ============================================================
import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { ensureSettings } from '@/lib/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KEY = 'buffett'

function keyOk(request) {
  const k = request.headers.get('x-screener-key')
    || new URL(request.url).searchParams.get('k') || ''
  return Boolean(process.env.SCREENER_KEY) && k === process.env.SCREENER_KEY
}

export async function POST(request) {
  if (!keyOk(request)) return NextResponse.json({ ok: false, error: 'key' }, { status: 401 })

  let b = {}
  try { b = await request.json() } catch { b = {} }
  const ratio = Number(b.ratio)
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1000) {
    return NextResponse.json(
      { ok: false, error: 'ratio 는 0 에서 1000 사이 숫자여야 합니다' }, { status: 400 })
  }

  let sql = null
  try { sql = await getSql() } catch { sql = null }
  if (!sql) return NextResponse.json({ ok: false, error: 'db' }, { status: 503 })
  await ensureSettings(sql)

  const payload = {
    ok: true,
    ratio: Math.round(ratio * 10) / 10,
    anchor: Number.isFinite(Number(b.anchor)) ? Math.round(Number(b.anchor) * 10) / 10 : null,
    anchorAt: String(b.anchorAt || ''),
    approx: Boolean(b.approx),
    note: String(b.note || ''),
    at: new Date().toISOString(),
    via: 'seoul',
  }
  const v = JSON.stringify(payload)
  await sql`
    INSERT INTO screener_settings (key, value, updated_at)
    VALUES (${KEY}, ${v}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = ${v}::jsonb, updated_at = now()`
  return NextResponse.json({ ok: true, saved: payload })
}

export async function GET(request) {
  if (!keyOk(request)) return NextResponse.json({ ok: false, error: 'key' }, { status: 401 })
  let sql = null
  try { sql = await getSql() } catch { sql = null }
  if (!sql) return NextResponse.json({ ok: false, error: 'db' }, { status: 503 })
  const r = await sql`SELECT value, updated_at FROM screener_settings WHERE key = ${KEY}`
  return NextResponse.json({ ok: true, current: r.length ? r[0].value : null })
}
