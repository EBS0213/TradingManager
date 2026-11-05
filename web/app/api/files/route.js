// ============================================================
//  게시판 첨부파일 — 올리기 · 목록 · 고치기 · 지우기 (2026-08-24)
//
//  · GET    /api/files?post=12    그 글에 붙은 파일들. 게시판과 같이 누구나.
//  · POST   /api/files            올리기. 로그인한 사람만. 아직 글에는 안 붙습니다
//                                 (글을 저장할 때 게시판이 붙여 줍니다).
//  · PATCH  /api/files            제목·설명 고치기. 올린 본인이나 관리자만.
//  · DELETE /api/files?id=12      지우기. 올린 본인이나 관리자만.
// ============================================================
import { NextResponse } from 'next/server'
import crypto from 'node:crypto'
import { currentUser } from '@/lib/auth'
import { keyAdmin, ADMIN_ONLY, isAdmin } from '@/lib/board'
import { getSql } from '@/lib/db'
import { ensureFiles, kindOf, isImage, MAX_BYTES, MAX_PER_POST, sweepOrphans } from '@/lib/files'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UTF8 = { 'content-type': 'application/json; charset=utf-8' }
const json = (o, init) => NextResponse.json(o, { ...init, headers: UTF8 })

const clean = (v, n) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n)

/* 올린 사람 이름 — 별명이 있으면 별명, 없으면 이메일 앞부분.
   이메일 전체는 화면에 싣지 않습니다 (스팸에 긁어가기 좋은 형태라). */
function whoName(u) {
  if (!u) return ''
  if (u.nickname) return String(u.nickname).slice(0, 24)
  const id = String(u.email || '').split('@')[0]
  return id ? `${id.slice(0, 3)}***` : '회원'
}

// ── 한 글의 첨부 목록 ───────────────────────────────────
export async function GET(request) {
  const post = Number(new URL(request.url).searchParams.get('post'))
  if (!Number.isFinite(post) || post <= 0) return json({ ok: true, items: [] })

  let sql = null
  try { sql = await getSql(); await ensureFiles(sql) }
  catch { return json({ ok: false, error: '첨부를 열지 못했습니다' }, { status: 503 }) }

  let u
  try {
    u = await keyAdmin(request, sql) || await currentUser()
    const posts = await sql`SELECT cat FROM screener_post WHERE id = ${post}`
    if (!posts.length || (ADMIN_ONLY.has(String(posts[0].cat || '')) && !isAdmin(u)))
      return json({ ok: false, error: '없는 글입니다' }, { status: 404 })
  } catch {
    return json({ ok: false, error: '첨부 접근 권한을 확인할 수 없습니다' }, { status: 503 })
  }
  // **data(파일 내용)는 절대 고르지 않습니다.** 한 번이라도 넣으면
  //  목록 한 번에 수십 MB 가 오갑니다 (전송량이 꽉 차 사이트가 멈춘 적이 있습니다).
  const rows = await sql`
    SELECT id, created_at, uploader, title, note, filename, mime, bytes, downloads, user_id
    FROM screener_file WHERE post_id = ${post} ORDER BY id`

  return json({ ok: true, items: rows.map((r) => fileRow(r, u)) })
}

function fileRow(r, u) {
  return {
    id: Number(r.id), at: r.created_at, uploader: r.uploader,
    title: r.title, note: r.note, filename: r.filename,
    mime: r.mime, bytes: Number(r.bytes), downloads: Number(r.downloads),
    image: isImage(r.mime),
    // 이 사람이 지울 수 있는 파일인지 화면이 알 수 있게 표시만 해 줍니다.
    //  (실제 판단은 지울 때 서버가 다시 합니다 — 화면 표시는 믿지 않습니다)
    mine: Boolean(u && (u.role === 'admin' || Number(r.user_id) === Number(u.id))),
  }
}

// ── 올리기 ──────────────────────────────────────────────
export async function POST(request) {
  // 맥이 아침 보고서 PDF 를 올릴 때는 로그인 대신 SCREENER_KEY 를 들고 옵니다 (2026-09-03).
  //  게시판(/api/board)과 **같은 함수**로 사람을 정합니다 — 글과 첨부의 주인이
  //  같아야 첨부가 그 글에 붙습니다.
  const sql0 = await getSql()
  const auto = await keyAdmin(request, sql0)
  const u = auto || await currentUser()
  if (!u) return json({ ok: false, error: '로그인해야 올릴 수 있습니다' }, { status: 401 })

  let form
  try { form = await request.formData() }
  catch { return json({ ok: false, error: '파일을 읽지 못했습니다 (너무 클 수 있습니다)' }, { status: 400 }) }

  const files = form.getAll('file').filter((f) => f && typeof f.arrayBuffer === 'function')
  if (!files.length) return json({ ok: false, error: '파일이 없습니다' }, { status: 400 })

  const title = clean(form.get('title'), 120)
  const note = clean(form.get('note'), 300)

  const sql = sql0
  await ensureFiles(sql)
  await sweepOrphans(sql)        // 글에 못 붙고 남은 옛 파일 치우기

  // 글 하나에 너무 많이 붙이지 못하게 합니다
  if (files.length > MAX_PER_POST)
    return json({ ok: false, error: `한 번에 ${MAX_PER_POST}개까지 올릴 수 있습니다` },
      { status: 400 })

  const done = []
  const skipped = []
  for (const f of files) {
    const name = clean(f.name || 'file', 160) || 'file'
    const kind = kindOf(name)
    if (!kind) { skipped.push(`${name}: 올릴 수 없는 갈래입니다`); continue }
    if (f.size > MAX_BYTES) {
      skipped.push(`${name}: 4MB 를 넘습니다`); continue
    }

    const buf = Buffer.from(await f.arrayBuffer())
    if (!buf.length) { skipped.push(`${name}: 빈 파일입니다`); continue }
    // 이름만 바꾼 파일을 거릅니다 (앞글자를 아는 갈래만)
    if (kind.magic && buf.subarray(0, kind.magic.length).toString('latin1') !== kind.magic) {
      skipped.push(`${name}: ${kind.label} 파일이 아닙니다`); continue
    }

    const sha = crypto.createHash('sha256').update(buf).digest('hex')
    const dup = await sql`SELECT id FROM screener_file WHERE sha = ${sha} LIMIT 1`
    if (dup.length) {
      // 자동 게재는 같은 날 두 번 돌 수 있습니다. 그때 PDF 가 한 글자도 안 바뀌었으면
      //  여기로 옵니다 — 사람에게는 '이미 있습니다' 라고 알리면 되지만, 맥은
      //  **붙일 번호**가 필요합니다. 그래서 이미 있는 것의 번호를 그대로 돌려줍니다.
      if (auto) done.push({ id: Number(dup[0].id), name, bytes: buf.length,
        mime: kind.mime, image: isImage(kind.mime), 그대로: true })
      else skipped.push(`${name}: 이미 올라와 있는 파일입니다`)
      continue
    }

    const r = await sql`
      INSERT INTO screener_file (user_id, uploader, title, note, filename, mime, bytes, sha, data)
      VALUES (${u.id}, ${whoName(u)}, ${title || name}, ${note}, ${name},
              ${kind.mime}, ${buf.length}, ${sha}, ${buf.toString('base64')})
      RETURNING id`
    done.push({ id: Number(r[0].id), name, bytes: buf.length,
                mime: kind.mime, image: isImage(kind.mime) })
  }

  return json({ ok: true, 올림: done, 건너뜀: skipped })
}

// ── 고치기 (제목·설명) ──────────────────────────────────
//  파일 자체는 바꿀 수 없습니다. 내용이 달라졌으면 지우고 새로 올리는 것이
//  맞습니다 — 같은 자리에서 파일만 바뀌면 받아 간 사람과 어긋납니다.
export async function PATCH(request) {
  const u = await currentUser()
  if (!u) return json({ ok: false, error: '로그인이 필요합니다' }, { status: 401 })

  let body
  try { body = await request.json() } catch { body = null }
  const id = Number(body?.id)
  if (!Number.isFinite(id) || id <= 0)
    return json({ ok: false, error: 'id 가 없습니다' }, { status: 400 })

  const sql = await getSql()
  await ensureFiles(sql)

  const r = await sql`SELECT user_id, filename FROM screener_file WHERE id = ${id}`
  if (!r.length) return json({ ok: false, error: '없는 파일입니다' }, { status: 404 })

  // 화면이 보낸 '내 파일' 표시를 믿지 않고 여기서 다시 봅니다
  const mine = Number(r[0].user_id) === Number(u.id)
  if (!mine && u.role !== 'admin')
    return json({ ok: false, error: '올린 사람이나 관리자만 고칠 수 있습니다' }, { status: 403 })

  // 제목을 비우면 파일 이름으로 되돌립니다 (빈 제목은 목록에서 이름 없는 줄이 됩니다)
  const title = clean(body?.title, 120) || String(r[0].filename || '')
  const note = clean(body?.note, 300)
  await sql`UPDATE screener_file SET title = ${title}, note = ${note} WHERE id = ${id}`
  return json({ ok: true, title, note })
}

// ── 지우기 ──────────────────────────────────────────────
export async function DELETE(request) {
  const u = await currentUser()
  if (!u) return json({ ok: false, error: '로그인이 필요합니다' }, { status: 401 })

  const id = Number(new URL(request.url).searchParams.get('id'))
  if (!Number.isFinite(id) || id <= 0)
    return json({ ok: false, error: 'id 가 없습니다' }, { status: 400 })

  const sql = await getSql()
  await ensureFiles(sql)

  const r = await sql`SELECT user_id FROM screener_file WHERE id = ${id}`
  if (!r.length) return json({ ok: false, error: '없는 파일입니다' }, { status: 404 })

  // 화면이 보낸 '내 파일' 표시를 믿지 않고 여기서 다시 봅니다
  const mine = Number(r[0].user_id) === Number(u.id)
  if (!mine && u.role !== 'admin')
    return json({ ok: false, error: '올린 사람이나 관리자만 지울 수 있습니다' }, { status: 403 })

  await sql`DELETE FROM screener_file WHERE id = ${id}`
  return json({ ok: true })
}
