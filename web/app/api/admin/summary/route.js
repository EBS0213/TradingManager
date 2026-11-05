// ============================================================
//  관리 페이지 자료 — 관리자만 볼 수 있습니다.
// ============================================================
import { NextResponse } from 'next/server'
import { currentUser, ensureTables } from '@/lib/auth'
import { getSql } from '@/lib/db'
import { ensureSettings } from '@/lib/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 처음 열었을 때 채워져 있을 기본 비용 (화면에서 고칠 수 있습니다)
const DEFAULT_COSTS = [
  { 항목: 'AWS Lightsail (스크리닝 서버)', 금액: 12, 통화: 'USD', 주기: '월' },
  { 항목: 'Vercel (웹사이트)', 금액: 0, 통화: 'USD', 주기: '월', 메모: 'Hobby 무료' },
  { 항목: 'Neon (데이터베이스)', 금액: 0, 통화: 'USD', 주기: '월', 메모: '무료 구간' },
  { 항목: 'Resend (메일 발송)', 금액: 0, 통화: 'USD', 주기: '월', 메모: '무료 구간' },
  { 항목: 'Massive/Polygon (미국 주가)', 금액: 29, 통화: 'USD', 주기: '월',
    메모: 'Stocks Starter — 호출 무제한 · 당일 종가' },
  { 항목: 'Anthropic (브리핑 글쓰기)', 금액: 0, 통화: 'USD', 주기: '월', 메모: '쓴 만큼' },
  { 항목: '도메인 tradingmanagerkr.com', 금액: 20000, 통화: 'KRW', 주기: '연' },
]

export async function GET() {
  const u = await currentUser()
  if (!u || u.role !== 'admin')
    return NextResponse.json({ ok: false, error: '관리자만 볼 수 있습니다.' }, { status: 403 })

  const sql = await getSql()
  await ensureTables(sql)
  await ensureSettings(sql)

  const users = await sql`
    SELECT id, email, nickname, role, verified, created_at, last_login
    FROM screener_user ORDER BY created_at DESC`

  const s = await sql`SELECT value FROM screener_settings WHERE key = 'costs'`
  const saved = s[0]?.value
  const costs = Array.isArray(saved?.items) ? saved.items : (u.local ? [] : DEFAULT_COSTS)
  const rate = Number(saved?.rate) > 0 ? Number(saved.rate) : 1400

  const now = Date.now()
  const days = (d) => (d ? (now - new Date(d).getTime()) / 86400000 : 1e9)

  return NextResponse.json({
    ok: true,
    counts: {
      total: users.length,
      verified: users.filter((x) => x.verified).length,
      pending: users.filter((x) => !x.verified).length,
      new7: users.filter((x) => days(x.created_at) <= 7).length,
      active7: users.filter((x) => days(x.last_login) <= 7).length,
    },
    users: users.map((x) => ({
      email: x.email, nickname: x.nickname || null, role: x.role, verified: x.verified,
      created_at: x.created_at, last_login: x.last_login,
    })),
    costs, rate,
  })
}
