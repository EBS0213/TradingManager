// 댓글 달기
import { NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth'
import { ensureBoard, ADMIN_ONLY, isAdmin } from '@/lib/board'
import { getSql } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  const u = await currentUser()
  if (!u) return NextResponse.json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 })
  const id = Number((await params).id)
  let body
  try { body = await request.json() } catch { body = null }
  const text = String(body?.body || '').trim()
  if (!text) return NextResponse.json({ ok: false, error: '내용을 넣어 주세요.' }, { status: 400 })
  if (text.length > 2000)
    return NextResponse.json({ ok: false, error: '댓글이 너무 깁니다.' }, { status: 400 })

  const sql = await getSql()
  await ensureBoard(sql)

  /* 관리자 전용 갈래(평가)의 글에는 관리자만 댓글을 답니다 (2026-09-05).
     읽지도 못하는 글에 댓글이 달릴 일은 없지만, 글 번호를 찍어 넣으면
     '그런 글이 있구나' 를 알게 됩니다. 여기서도 '없는 글' 이라고 답합니다. */
  const posts = await sql`SELECT cat FROM screener_post WHERE id = ${id}`
  if (!posts.length || (ADMIN_ONLY.has(String(posts[0].cat || '')) && !isAdmin(u)))
    return NextResponse.json({ ok: false, error: '없는 글입니다.' }, { status: 404 })

  await sql`INSERT INTO screener_comment (post_id, user_id, body) VALUES (${id}, ${u.id}, ${text})`
  return NextResponse.json({ ok: true })
}
