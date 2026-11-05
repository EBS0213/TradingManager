// ============================================================
//  회원가입 — 이메일 + 비밀번호. 인증 메일을 보냅니다.
// ============================================================
import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { getSql } from '@/lib/db'
import { ensureTables, hashPassword, normalizeEmail, emailLooksOk } from '@/lib/auth'
import { sendMail, verifyMailHtml } from '@/lib/mail'
import { tooMany, clientIp } from '@/lib/limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function siteUrl(request) {
  return (process.env.SITE_URL || new URL(request.url).origin).replace(/\/$/, '')
}

export async function POST(request) {
  let body
  try { body = await request.json() } catch { body = null }
  const email = normalizeEmail(body?.email)
  const password = String(body?.password || '')
  if (email.length > 254 || password.length > 1024)
    return NextResponse.json({ ok: false, error: '입력 길이를 확인해 주세요.' }, { status: 400 })

  if (!emailLooksOk(email))
    return NextResponse.json({ ok: false, error: '이메일 주소를 다시 확인해 주세요.' }, { status: 400 })
  if (password.length < 8)
    return NextResponse.json({ ok: false, error: '비밀번호는 8자 이상이어야 합니다.' }, { status: 400 })

  // 메일 설정이 안 되어 있으면 계정을 만들기 전에 멈춥니다
  if (!process.env.RESEND_API_KEY) {
    console.error('[가입] RESEND_API_KEY 환경변수가 없어 인증 메일을 보낼 수 없습니다.')
    return NextResponse.json(
      { ok: false, error: '지금은 가입을 받을 수 없습니다. 잠시 뒤 다시 시도해 주세요.' },
      { status: 503 })
  }

  const sql = await getSql()
  await ensureTables(sql)

  // 한 주소에서 메일을 무더기로 보내는 것을 막습니다 (1시간에 5번)
  if (await tooMany(sql, `signup:${clientIp(request)}`, 5, 60))
    return NextResponse.json(
      { ok: false, error: '가입 시도가 너무 잦습니다. 잠시 뒤에 다시 시도해 주세요.' },
      { status: 429 })

  const found = await sql`SELECT id, verified FROM screener_user WHERE email = ${email}`
  if (found.length && found[0].verified)
    return NextResponse.json({ ok: false, error: '이미 가입된 이메일입니다. 로그인해 주세요.' }, { status: 409 })

  const token = crypto.randomBytes(24).toString('hex')
  const hash = hashPassword(password)

  if (found.length) {
    // 인증을 안 끝낸 계정이면 비밀번호와 토큰을 새로 씁니다
    await sql`
      UPDATE screener_user
      SET pass_hash = ${hash}, verify_token = ${token},
          verify_expires = now() + interval '24 hours'
      WHERE id = ${found[0].id}`
  } else {
    await sql`
      INSERT INTO screener_user (email, pass_hash, verify_token, verify_expires)
      VALUES (${email}, ${hash}, ${token}, now() + interval '24 hours')`
  }

  try {
    await sendMail({
      to: email,
      subject: '[TradingManager 26] 이메일 인증을 완료해 주세요',
      html: verifyMailHtml(`${siteUrl(request)}/api/auth/verify?token=${token}`),
    })
  } catch (e) {
    console.error('[가입] 메일 발송 실패:', e?.message || e)
    return NextResponse.json(
      { ok: false,
        error: '인증 메일을 보내지 못했습니다. 이메일 주소를 다시 확인하시거나 잠시 뒤 시도해 주세요.' },
      { status: 500 })
  }
  return NextResponse.json({ ok: true, email })
}
