// ============================================================
//  내 API 키 — 보기 · 발급(다시 발급) · 폐기  (2026-10-08)
//  [내 계정] 창에서 부릅니다. 본인만 자기 키를 다룹니다.
//  발급할 때는 비밀번호를 한 번 더 받습니다 — 로그인 쿠키만 훔친 사람이
//  키를 새로 만들어 들고 나가지 못하게 하려는 것입니다.
// ============================================================
import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { currentUser, verifyPassword } from '@/lib/auth'
import { tooMany, clientIp } from '@/lib/limit'
import { keyStatus, issueKey, revokeKey, LIMIT_PER_MIN, LIMIT_PER_DAY } from '@/lib/apikey'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NOSTORE = { 'Cache-Control': 'no-store' }
const bad = (msg, code = 400) =>
  NextResponse.json({ ok: false, error: msg }, { status: code, headers: NOSTORE })
const ok = (o) => NextResponse.json({ ok: true, ...o }, { headers: NOSTORE })

const limits = { perMin: LIMIT_PER_MIN, perDay: LIMIT_PER_DAY }

export async function GET() {
  const u = await currentUser()
  if (!u) return bad('로그인이 필요합니다.', 401)
  const sql = await getSql()
  return ok({ key: await keyStatus(sql, u.id), limits })
}

export async function POST(request) {
  const u = await currentUser()
  if (!u) return bad('로그인이 필요합니다.', 401)
  let body
  try { body = await request.json() } catch { body = null }
  const pw = String(body?.password || '')

  const sql = await getSql()
  if (await tooMany(sql, `apikey:${u.id}:${clientIp(request)}`, 5, 10))
    return bad('시도가 너무 잦습니다. 10분 뒤에 다시 해 주세요.', 429)
  const r = await sql`SELECT pass_hash FROM screener_user WHERE id = ${u.id}`
  if (!u.local && (!r.length || !verifyPassword(pw, r[0].pass_hash)))
    return bad('비밀번호가 맞지 않습니다.', 403)

  const { key, hint } = await issueKey(sql, u.id)
  return ok({ key, hint, limits })
}

export async function DELETE() {
  const u = await currentUser()
  if (!u) return bad('로그인이 필요합니다.', 401)
  const sql = await getSql()
  await revokeKey(sql, u.id)
  return ok({ revoked: true })
}
