// ============================================================
//  이메일 인증 링크 — 누르면 계정이 열리고 바로 로그인됩니다.
// ============================================================
import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { ensureTables, setSession } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request) {
  const token = new URL(request.url).searchParams.get('token') || ''
  const base = new URL(request.url).origin
  if (!token) return NextResponse.redirect(`${base}/login?e=notoken`)

  const sql = await getSql()
  await ensureTables(sql)
  const r = await sql`
    SELECT id FROM screener_user
    WHERE verify_token = ${token} AND verify_expires > now()`
  if (!r.length) return NextResponse.redirect(`${base}/login?e=expired`)

  await sql`
    UPDATE screener_user
    SET verified = true, verify_token = NULL, verify_expires = NULL, last_login = now()
    WHERE id = ${r[0].id}`
  await setSession(r[0].id)
  return NextResponse.redirect(`${base}/?welcome=1`)
}
