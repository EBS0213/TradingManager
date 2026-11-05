// ============================================================
//  한국 경제지표 일정 — 관리자가 직접 넣습니다.
//  · 한국은행·통계청은 공표일정을 주는 창구가 마땅치 않아,
//    당분간 관리 페이지에서 손으로 넣고 /api/calendar 에 합칩니다.
// ============================================================
import { NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth'
import { getSql } from '@/lib/db'
import { ensureSettings } from '@/lib/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UTF8 = { 'content-type': 'application/json; charset=utf-8' }
const KEY = 'calendar_kr'

/** 지난 일정은 60일까지만 남깁니다 */
function tidy(items) {
  const cut = new Date(Date.now() + 9 * 3600 * 1000 - 60 * 86400 * 1000)
  const p = (n) => String(n).padStart(2, '0')
  const min = `${cut.getUTCFullYear()}-${p(cut.getUTCMonth() + 1)}-${p(cut.getUTCDate())}`
  return items
    .filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x.day || '')) && String(x.title || '').trim())
    .filter((x) => x.day >= min)
    .map((x) => ({
      day: String(x.day),
      time: /^\d{2}:\d{2}$/.test(String(x.time || '')) ? String(x.time) : '',
      title: String(x.title).trim().slice(0, 60),
      impact: ['High', 'Medium', 'Low'].includes(x.impact) ? x.impact : 'Medium',
    }))
    .sort((a, b) => (a.day + a.time).localeCompare(b.day + b.time))
    .slice(0, 200)
}

export async function GET() {
  const u = await currentUser()
  if (!u || u.role !== 'admin')
    return NextResponse.json({ ok: false, error: '관리자만 볼 수 있습니다.' },
      { status: 403, headers: UTF8 })
  const sql = await getSql()
  await ensureSettings(sql)
  const r = await sql`SELECT value FROM screener_settings WHERE key = ${KEY}`
  const items = Array.isArray(r[0]?.value?.items) ? r[0].value.items : []
  return NextResponse.json({ ok: true, items }, { headers: UTF8 })
}

export async function PUT(request) {
  const u = await currentUser()
  if (!u || u.role !== 'admin')
    return NextResponse.json({ ok: false, error: '관리자만 수정할 수 있습니다.' },
      { status: 403, headers: UTF8 })

  let body
  try { body = await request.json() } catch { body = null }
  if (!Array.isArray(body?.items))
    return NextResponse.json({ ok: false, error: '형식이 올바르지 않습니다.' },
      { status: 400, headers: UTF8 })

  const items = tidy(body.items)
  const sql = await getSql()
  await ensureSettings(sql)
  const json = JSON.stringify({ items })
  await sql`
    INSERT INTO screener_settings (key, value, updated_at)
    VALUES (${KEY}, ${json}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = ${json}::jsonb, updated_at = now()`
  // 캘린더 저장분을 지워 다음 조회 때 바로 반영되게 합니다
  try { await sql`DELETE FROM screener_settings WHERE key = 'calendar'` } catch {}
  return NextResponse.json({ ok: true, saved: items.length }, { headers: UTF8 })
}
