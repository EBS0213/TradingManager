// 비용 표 저장 — 관리자만
import { NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth'
import { getSql } from '@/lib/db'
import { ensureSettings } from '@/lib/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function PUT(request) {
  const u = await currentUser()
  if (!u || u.role !== 'admin')
    return NextResponse.json({ ok: false, error: '관리자만 수정할 수 있습니다.' }, { status: 403 })

  let body
  try { body = await request.json() } catch { body = null }
  const items = Array.isArray(body?.items) ? body.items : null
  if (!items) return NextResponse.json({ ok: false, error: '형식이 올바르지 않습니다.' }, { status: 400 })
  const rate = Number(body?.rate) > 0 ? Number(body.rate) : 1400

  const sql = await getSql()
  await ensureSettings(sql)
  const json = JSON.stringify({ items, rate })
  await sql`
    INSERT INTO screener_settings (key, value, updated_at)
    VALUES ('costs', ${json}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = ${json}::jsonb, updated_at = now()`
  return NextResponse.json({ ok: true })
}
