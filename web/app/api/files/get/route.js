// ============================================================
//  자료실 — 내려받기 (2026-08-24)
//
//  · GET /api/files/get?id=12   →  그 파일을 그대로 내려줍니다
//  · 공개 글 속 그림은 로그인 없이 받을 수 있습니다. 미게시 파일은 소유자·관리자만 받습니다.
//  · **글에 붙은 PDF 등 문서 첨부는 로그인한 회원만** 받습니다 (2026-10-05, Jun 지정).
//    게시판·리서치의 글 내용은 무료로 열어 두고, PDF 전문은 회원 전용으로 둡니다.
//    맥이 게시 직후 첨부를 대조할 때 쓰는 x-screener-key 는 계속 통과시킵니다.
//
//  Content-Disposition 에 attachment 를 붙여 브라우저가 열지 않고
//  받도록 합니다. PDF 는 브라우저가 그냥 열어버리는 일이 많은데,
//  화면의 '받기' 를 눌렀는데 새 창에서 열리면 안 받아진 줄 압니다.
// ============================================================
import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { ensureFiles } from '@/lib/files'
import { currentUser } from '@/lib/auth'
import { ADMIN_ONLY, isAdmin, keyAdmin } from '@/lib/board'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UTF8 = { 'content-type': 'application/json; charset=utf-8' }
const bad = (msg, status) => NextResponse.json({ ok: false, error: msg }, { status, headers: UTF8 })

export async function GET(request) {
  const id = Number(new URL(request.url).searchParams.get('id'))
  if (!Number.isFinite(id) || id <= 0) return bad('id 가 없습니다', 400)

  let sql = null
  try { sql = await getSql(); await ensureFiles(sql) }
  catch { return bad('자료실을 열지 못했습니다', 503) }

  const r = await sql`SELECT filename, mime, bytes, data, post_id, user_id FROM screener_file WHERE id = ${id}`
  if (!r.length) return bad('없는 파일입니다', 404)

  // Authorize metadata first; failures must never release private content.
  let me
  try {
    me = await keyAdmin(request, sql) || await currentUser()
    if (!r[0].post_id) {
      if (!me || (!isAdmin(me) && Number(me.id) !== Number(r[0].user_id)))
        return bad('없는 파일입니다', 404)
    } else {
      const posts = await sql`SELECT cat FROM screener_post WHERE id = ${r[0].post_id}`
      if (!posts.length || (ADMIN_ONLY.has(String(posts[0].cat || '')) && !isAdmin(me)))
        return bad('없는 파일입니다', 404)
      if (!String(r[0].mime || '').startsWith('image/') && !me)
        return bad('PDF 전문은 로그인한 회원만 볼 수 있습니다', 401)
    }
  } catch {
    return bad('파일 접근 권한을 확인할 수 없습니다', 503)
  }

  const row = r[0]
  const buf = Buffer.from(String(row.data || ''), 'base64')
  if (!buf.length) return bad('파일 내용이 비어 있습니다', 410)

  // 몇 번 받아갔는지만 세어 둡니다 (누가 받았는지는 기록하지 않습니다).
  //  세다가 실패해도 파일은 내려줍니다 — 세는 것이 받는 것을 막으면 안 됩니다.
  try { await sql`UPDATE screener_file SET downloads = downloads + 1 WHERE id = ${id}` }
  catch { /* 그냥 넘어갑니다 */ }

  // 파일 이름에 한글이나 띄어쓰기가 있어도 깨지지 않게 두 가지로 적습니다.
  //  filename   — 옛 브라우저용 (아스키만)
  //  filename*  — RFC 5987. 요즘 브라우저는 이쪽을 씁니다.
  const name = String(row.filename || 'file')
  const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_')
  const utf8 = encodeURIComponent(name)

  return new NextResponse(buf, {
    headers: {
      'content-type': row.mime || 'application/octet-stream',
      'content-length': String(buf.length),
      'content-disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`,
      // 자료실 파일은 바뀌지 않습니다 (바꾸려면 지우고 다시 올립니다)
      'cache-control': 'private, no-store',
    },
  })
}
