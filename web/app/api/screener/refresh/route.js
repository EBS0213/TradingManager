// ============================================================
//  "지금 다시 스크리닝" — 관리자만 실행할 수 있습니다.
//  할 일 하나를 표에 적어두면 AWS 서버가 30초 안에 가져가 실행합니다.
// ============================================================
import { NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth'
import { getSql } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request) {
  const u = await currentUser()
  if (!u || u.role !== 'admin')
    return NextResponse.json({ ok: false, error: '관리자만 실행할 수 있습니다.' }, { status: 403 })

  // 어느 시장을 돌릴지. 없으면 한국(예전과 같음).
  const market =
    new URL(request.url).searchParams.get('market') === 'US' ? 'US' : 'KR'

  const sql = await getSql()
  // 예전 표에는 market 칸이 없었습니다. 있으면 그냥 넘어갑니다.
  await sql`ALTER TABLE screener_job ADD COLUMN IF NOT EXISTS market TEXT NOT NULL DEFAULT 'KR'`

  // 같은 시장이 이미 돌고 있을 때만 막습니다.
  //  한국이 도는 중이라고 미국까지 못 돌릴 이유는 없습니다 — 다른 서버 작업입니다.
  const busy = await sql`
    SELECT id FROM screener_job
    WHERE status IN ('requested','running') AND market = ${market}
      AND requested_at > now() - interval '45 minutes' LIMIT 1`
  if (busy.length)
    return NextResponse.json(
      { ok: false, error: `${market === 'US' ? '미국' : '한국'} 스크리너가 이미 진행 중입니다.` },
      { status: 409 })

  await sql`INSERT INTO screener_job (status, market) VALUES ('requested', ${market})`
  return NextResponse.json({ ok: true, market })
}
