// ============================================================
//  글 하나 — 보기 / 고치기 / 지우기
// ============================================================
import { NextResponse } from 'next/server'
import { currentUser, ensureTables } from '@/lib/auth'
import { ensureBoard, showName, catOf, ADMIN_ONLY, AUTO_ONLY, isAdmin, keyAdmin } from '@/lib/board'
import { ensureFiles, linkFiles, isImage } from '@/lib/files'
import { getSql } from '@/lib/db'
import { reportMetadata } from '@/lib/research-metadata'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 글 읽기는 로그인 없이도 됩니다. 댓글·수정·삭제는 회원만 가능합니다.
export async function GET(request, { params }) {
  const u = await currentUser()
  const id = Number((await params).id)
  if (!id) return NextResponse.json({ ok: false, error: '잘못된 주소입니다.' }, { status: 400 })

  const sql = await getSql()
  await ensureTables(sql)
  await ensureBoard(sql)

  const p = await sql`
    SELECT p.id, p.title, p.body, p.cat, p.created_at, p.updated_at, p.user_id, u.email, u.nickname, u.role
    FROM screener_post p JOIN screener_user u ON u.id = p.user_id WHERE p.id = ${id}`
  if (!p.length) return NextResponse.json({ ok: false, error: '없는 글입니다.' }, { status: 404 })

  /* 관리자 전용 갈래(평가)의 글은 관리자에게만 보여 줍니다 (2026-09-05).
     목록에서 감추는 것만으로는 모자랍니다 — 글 번호를 알면 바로 열리기 때문입니다.
     '없는 글' 이라고 답합니다. 있다는 사실 자체를 알릴 까닭이 없습니다. */
  if (ADMIN_ONLY.has(String(p[0].cat || '')) && !isAdmin(u))
    return NextResponse.json({ ok: false, error: '없는 글입니다.' }, { status: 404 })

  const c = await sql`
    SELECT c.id, c.body, c.created_at, u.email, u.nickname, u.role
    FROM screener_comment c JOIN screener_user u ON u.id = c.user_id
    WHERE c.post_id = ${id} ORDER BY c.created_at`

  /* 첨부파일. **data(파일 내용)는 고르지 않습니다** — 목록에 실으면
     글 한 번 열 때마다 수 MB 가 오갑니다. 내용은 /api/files/get 이 따로 내줍니다. */
  let files = []
  try {
    await ensureFiles(sql)
    const f = await sql`
      SELECT id, filename, title, mime, bytes FROM screener_file
      WHERE post_id = ${id} ORDER BY id`
    files = f.map((x) => ({
      id: Number(x.id), filename: x.filename, title: x.title,
      bytes: Number(x.bytes), image: isImage(x.mime),
    }))
  } catch { /* 첨부를 못 읽어도 글은 보여줍니다 */ }

  const mine = Boolean(u) && p[0].email === u.email
  return NextResponse.json({
    ok: true,
    me: u ? { email: u.email, admin: u.role === 'admin' } : null,
    canWrite: Boolean(u),
    post: {
      id: Number(p[0].id), title: p[0].title, body: p[0].body, cat: p[0].cat || 'free',
      ...reportMetadata(p[0].body, files.map(file => file.filename)),
      author: showName(p[0]), authorRole: p[0].role, mine,
      canDelete: mine || (Boolean(u) && u.role === 'admin'),
      created_at: p[0].created_at, updated_at: p[0].updated_at,
    },
    files,
    comments: c.map((x) => ({
      id: Number(x.id), body: x.body, author: showName(x), authorRole: x.role,
      canDelete: Boolean(u) && (x.email === u.email || u.role === 'admin'),
      created_at: x.created_at,
    })),
  })
}

export async function PATCH(request, { params }) {
  const sql = await getSql()
  const auto = await keyAdmin(request, sql)
  const u = auto || await currentUser()
  if (!u) return NextResponse.json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 })
  const id = Number((await params).id)
  let body
  try { body = await request.json() } catch { body = null }
  const title = String(body?.title || '').trim()
  const text = String(body?.body || '').trim()
  if (!title) return NextResponse.json({ ok: false, error: '제목을 넣어 주세요.' }, { status: 400 })

  await ensureBoard(sql)
  const p = await sql`SELECT user_id, cat FROM screener_post WHERE id = ${id}`
  if (!p.length) return NextResponse.json({ ok: false, error: '없는 글입니다.' }, { status: 404 })
  if (Number(p[0].user_id) !== Number(u.id))
    return NextResponse.json({ ok: false, error: '내가 쓴 글만 고칠 수 있습니다.' }, { status: 403 })

  const cat = body?.cat === undefined ? catOf(p[0].cat) : catOf(body.cat)
  if (!auto && (AUTO_ONLY.has(cat) || AUTO_ONLY.has(p[0].cat)))
    return NextResponse.json({ ok: false, error: '이 갈래는 자동으로만 수정할 수 있습니다.' }, { status: 403 })
  if (title.length > 120 || text.length > (auto ? 400000 : 20000))
    return NextResponse.json({ ok: false, error: '제목 또는 내용이 너무 깁니다.' }, { status: 400 })
  await sql`UPDATE screener_post SET title = ${title}, body = ${text}, cat = ${cat},
                                     updated_at = now()
            WHERE id = ${id}`
  // 고치면서 새로 붙인 파일도 이 글에 답니다 (이미 붙어 있던 것은 그대로)
  await ensureFiles(sql)
  await linkFiles(sql, id, u.id, body?.files)
  return NextResponse.json({ ok: true })
}

export async function DELETE(request, { params }) {
  const u = await currentUser()
  if (!u) return NextResponse.json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 })
  const id = Number((await params).id)

  const sql = await getSql()
  await ensureBoard(sql)
  const p = await sql`SELECT user_id FROM screener_post WHERE id = ${id}`
  if (!p.length) return NextResponse.json({ ok: false, error: '없는 글입니다.' }, { status: 404 })
  if (Number(p[0].user_id) !== Number(u.id) && u.role !== 'admin')
    return NextResponse.json({ ok: false, error: '지울 권한이 없습니다.' }, { status: 403 })

  // 첨부파일도 함께 지웁니다.
  //  screener_file 은 screener_post 를 외래키로 걸지 않았습니다 — 글보다 먼저
  //  올라가는 파일이 있어서(post_id 가 비어 있는 동안) 걸 수가 없습니다.
  //  그래서 여기서 손으로 지웁니다. 안 지우면 주인 없는 파일이 남습니다.
  try { await ensureFiles(sql); await sql`DELETE FROM screener_file WHERE post_id = ${id}` }
  catch { /* 첨부를 못 지워도 글은 지웁니다 */ }
  await sql`DELETE FROM screener_post WHERE id = ${id}`
  return NextResponse.json({ ok: true })
}
