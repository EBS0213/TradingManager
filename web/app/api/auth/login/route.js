// ============================================================
//  로그인
// ============================================================
import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { ensureTables, ensureAdmin, verifyPassword, setSession, normalizeEmail } from '@/lib/auth'
import { tooMany, clearLimit, clientIp } from '@/lib/limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request) {
  let body
  try { body = await request.json() } catch { body = null }
  const email = normalizeEmail(body?.email)
  const password = String(body?.password || '')
  if (email.length > 254 || password.length > 1024)
    return NextResponse.json({ ok: false, error: '입력 길이를 확인해 주세요.' }, { status: 400 })

  const sql = await getSql()
  await ensureTables(sql)
  await ensureAdmin(sql)          // 관리자 계정이 없으면 여기서 만들어집니다

  // 비밀번호를 찍어보는 것을 막습니다 (같은 계정 10분에 10번, 같은 주소 10분에 30번)
  const ip = clientIp(request)
  const byUser = `login:${email}`
  if (await tooMany(sql, byUser, 10, 10) || await tooMany(sql, `login-ip:${ip}`, 30, 10))
    return NextResponse.json(
      { ok: false, error: '로그인 시도가 너무 잦습니다. 10분 뒤에 다시 시도해 주세요.' },
      { status: 429 })

  const r = await sql`SELECT id, pass_hash, verified, role FROM screener_user WHERE email = ${email}`
  const u = r[0]
  if (!u || !verifyPassword(password, u.pass_hash))
    return NextResponse.json({ ok: false, error: '이메일 또는 비밀번호가 맞지 않습니다.' }, { status: 401 })
  if (!u.verified)
    return NextResponse.json(
      { ok: false, error: '이메일 인증이 아직 안 끝났습니다. 받은 메일의 링크를 눌러 주세요.',
        needVerify: true }, { status: 403 })

  await clearLimit(sql, byUser)
  await sql`UPDATE screener_user SET last_login = now() WHERE id = ${u.id}`
  await setSession(u.id)
  return NextResponse.json({ ok: true, email, role: u.role })
}
