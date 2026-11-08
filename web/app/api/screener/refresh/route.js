// ============================================================
//  "지금 다시 스크리닝" — 관리자만 실행할 수 있습니다.
//  할 일 하나를 표에 적어두면 로컬 워커가 다음 확인 주기에 가져가 실행합니다.
// ============================================================
import { NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth'
import { getSql } from '@/lib/db'
import { requestScreening } from '@/lib/screener-jobs.mjs'

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
  const queued = await requestScreening(sql, market)
  if (!queued.length)
    return NextResponse.json(
      { ok: false, error: `${market === 'US' ? '미국' : '한국'} 스크리너가 이미 진행 중입니다.` },
      { status: 409 })

  return NextResponse.json({ ok: true, market, job: queued[0].id })
}
