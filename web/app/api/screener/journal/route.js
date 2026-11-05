// ============================================================
//  내 기록 + 워치리스트 — 사용자마다 따로 보관합니다.
// ============================================================
import { NextResponse } from 'next/server'
import { currentUser, ensureTables } from '@/lib/auth'
import { getSql } from '@/lib/db'
import { keyAdmin } from '@/lib/board'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  /* 맥이 SCREENER_KEY 를 들고 오면 **관리자 본인의 기록**을 읽어 갑니다 (2026-09-05).
     오후 매매평가가 이 기록(그날 매매·메모)을 읽어 실제 매매와 대조하기 때문입니다.
     키를 가진 쪽은 이미 관리자 이름으로 글을 올릴 수 있으니, 믿는 범위가 늘지는 않습니다. */
  const sql = await getSql()
  await ensureTables(sql)
  const auto = await keyAdmin(request, sql)
  const u = auto || await currentUser()
  if (!u) return NextResponse.json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 })
  const r = await sql`SELECT data, updated_at FROM screener_user_data WHERE user_id = ${u.id}`
  return NextResponse.json({
    ok: true, email: u.email, admin: u.role === 'admin',
    data: r[0]?.data || null, updated_at: r[0]?.updated_at || null,
  })
}

export async function PUT(request) {
  /* 읽기와 마찬가지로, 맥이 SCREENER_KEY 를 들고 오면 관리자 기록에 씁니다 (2026-09-05).
     아래 병합(merge) 덕분에 보낸 칸만 바뀌고 나머지는 그대로 남습니다. */
  const sql = await getSql()
  await ensureTables(sql)
  const auto = await keyAdmin(request, sql)
  const u = auto || await currentUser()
  if (!u) return NextResponse.json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 })
  let body
  try { body = await request.json() } catch { body = null }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    return NextResponse.json({ ok: false, error: '형식이 올바르지 않습니다.' }, { status: 400 })

  // Merge inside PostgreSQL so concurrent saves to different fields survive.
  const json = JSON.stringify(body)
  await sql`
    INSERT INTO screener_user_data (user_id, data, updated_at)
    VALUES (${u.id}, ${json}::jsonb, now())
    ON CONFLICT (user_id) DO UPDATE
      SET data = screener_user_data.data || EXCLUDED.data, updated_at = now()`
  return NextResponse.json({ ok: true, saved_at: new Date().toISOString() })
}
