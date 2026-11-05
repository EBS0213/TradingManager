// ============================================================
//  내 계정 — 닉네임 변경 · 비밀번호 변경 · 탈퇴
//  본인만 자기 계정을 고칠 수 있습니다.
// ============================================================
import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import {
  currentUser, ensureTables, hashPassword, verifyPassword, clearSession,
} from '@/lib/auth'
import { tooMany, clientIp } from '@/lib/limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bad = (msg, code = 400) => NextResponse.json({ ok: false, error: msg }, { status: code })

/** 닉네임 규칙: 2~16자, 앞뒤 공백 없음, @ 와 꺾쇠 금지 */
function checkNick(v) {
  const s = String(v ?? '').trim()
  if (s === '') return { ok: true, value: null }        // 빈 값이면 이메일 표시로 되돌립니다
  if (s.length < 2 || s.length > 16) return { ok: false, error: '닉네임은 2~16자로 지어 주세요.' }
  if (/[@<>"'\\/]/.test(s)) return { ok: false, error: '닉네임에 쓸 수 없는 문자가 있습니다.' }
  if (/관리자|운영자|admin/i.test(s)) return { ok: false, error: '오해를 살 수 있는 닉네임입니다.' }
  return { ok: true, value: s }
}

/* ── 내 계정 정보 ─────────────────────────────────────── */
export async function GET() {
  const u = await currentUser()
  if (!u) return bad('로그인이 필요합니다.', 401)
  return NextResponse.json({
    ok: true, email: u.email, nickname: u.nickname || null,
    admin: u.role === 'admin',
  })
}

/* ── 닉네임 / 비밀번호 변경 ───────────────────────────── */
export async function PATCH(request) {
  const u = await currentUser()
  if (!u) return bad('로그인이 필요합니다.', 401)

  let body
  try { body = await request.json() } catch { body = null }
  if (!body || typeof body !== 'object') return bad('형식이 올바르지 않습니다.')

  const sql = await getSql()
  await ensureTables(sql)

  // ── 닉네임
  if ('nickname' in body) {
    const c = checkNick(body.nickname)
    if (!c.ok) return bad(c.error)
    if (c.value) {
      const dup = await sql`
        SELECT id FROM screener_user
        WHERE lower(nickname) = lower(${c.value}) AND id <> ${u.id}`
      if (dup.length) return bad('이미 쓰고 있는 닉네임입니다.', 409)
    }
    await sql`UPDATE screener_user SET nickname = ${c.value} WHERE id = ${u.id}`
    return NextResponse.json({ ok: true, nickname: c.value })
  }

  // ── 비밀번호
  if ('newPassword' in body) {
    const cur = String(body.currentPassword || '')
    const next = String(body.newPassword || '')
    if (cur.length > 1024 || next.length > 1024) return bad('입력 길이를 확인해 주세요.')
    if (next.length < 8) return bad('새 비밀번호는 8자 이상이어야 합니다.')
    if (next === cur) return bad('지금 쓰는 비밀번호와 같습니다.')

    if (await tooMany(sql, `pw:${u.id}:${clientIp(request)}`, 5, 10))
      return bad('시도가 너무 잦습니다. 10분 뒤에 다시 해 주세요.', 429)

    const r = await sql`SELECT pass_hash FROM screener_user WHERE id = ${u.id}`
    if (!r.length || !verifyPassword(cur, r[0].pass_hash))
      return bad('지금 쓰는 비밀번호가 맞지 않습니다.', 403)

    await sql`UPDATE screener_user SET pass_hash = ${hashPassword(next)} WHERE id = ${u.id}`
    return NextResponse.json({ ok: true, changed: 'password' })
  }

  return bad('바꿀 내용이 없습니다.')
}

/* ── 탈퇴 ─────────────────────────────────────────────── */
export async function DELETE(request) {
  const u = await currentUser()
  if (!u) return bad('로그인이 필요합니다.', 401)
  if (u.role === 'admin')
    return bad('관리자 계정은 화면에서 지울 수 없습니다.', 403)

  let body
  try { body = await request.json() } catch { body = null }
  const pw = String(body?.password || '')
  if (pw.length > 1024) return bad('입력 길이를 확인해 주세요.')

  const sql = await getSql()
  await ensureTables(sql)

  if (await tooMany(sql, `quit:${u.id}:${clientIp(request)}`, 5, 10))
    return bad('시도가 너무 잦습니다. 10분 뒤에 다시 해 주세요.', 429)

  const r = await sql`SELECT pass_hash FROM screener_user WHERE id = ${u.id}`
  if (!r.length || !verifyPassword(pw, r[0].pass_hash))
    return bad('비밀번호가 맞지 않습니다.', 403)

  // 내 기록·워치리스트·게시글·댓글은 계정과 함께 지워집니다 (ON DELETE CASCADE)
  await sql`DELETE FROM screener_user WHERE id = ${u.id}`
  await clearSession()
  return NextResponse.json({ ok: true, deleted: true })
}
