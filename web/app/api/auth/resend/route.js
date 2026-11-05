// 인증 메일 다시 보내기
import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { getSql } from '@/lib/db'
import { ensureTables, normalizeEmail } from '@/lib/auth'
import { sendMail, verifyMailHtml } from '@/lib/mail'
import { tooMany, clientIp } from '@/lib/limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request) {
  let body
  try { body = await request.json() } catch { body = null }
  const email = normalizeEmail(body?.email)
  const sql = await getSql()
  await ensureTables(sql)
  if (await tooMany(sql, `resend:${clientIp(request)}`, 5, 60))
    return NextResponse.json({ ok: true })      // 티 내지 않고 조용히 넘깁니다
  const r = await sql`SELECT id, verified FROM screener_user WHERE email = ${email}`
  // 가입 여부를 알려주지 않기 위해 항상 같은 응답을 돌려줍니다
  if (r.length && !r[0].verified) {
    const token = crypto.randomBytes(24).toString('hex')
    await sql`
      UPDATE screener_user SET verify_token = ${token},
        verify_expires = now() + interval '24 hours' WHERE id = ${r[0].id}`
    const base = (process.env.SITE_URL || new URL(request.url).origin).replace(/\/$/, '')
    try {
      await sendMail({
        to: email,
        subject: '[TradingManager 26] 이메일 인증을 완료해 주세요',
        html: verifyMailHtml(`${base}/api/auth/verify?token=${token}`),
      })
    } catch {}
  }
  return NextResponse.json({ ok: true })
}
