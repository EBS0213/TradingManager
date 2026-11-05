// 댓글 지우기
import { NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth'
import { ensureBoard } from '@/lib/board'
import { getSql } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function DELETE(request, { params }) {
  const u = await currentUser()
  if (!u) return NextResponse.json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 })
  const cid = Number((await params).cid)

  const sql = await getSql()
  await ensureBoard(sql)
  const c = await sql`SELECT user_id FROM screener_comment WHERE id = ${cid}`
  if (!c.length) return NextResponse.json({ ok: false, error: '없는 댓글입니다.' }, { status: 404 })
  if (Number(c[0].user_id) !== Number(u.id) && u.role !== 'admin')
    return NextResponse.json({ ok: false, error: '지울 권한이 없습니다.' }, { status: 403 })

  await sql`DELETE FROM screener_comment WHERE id = ${cid}`
  return NextResponse.json({ ok: true })
}
