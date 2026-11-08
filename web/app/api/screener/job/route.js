// ============================================================
//  로컬 워커가 30초마다 물어보는 곳: "지금 실행할 일이 있나요?"
//  비밀 키(SCREENER_KEY)로 확인합니다.
// ============================================================
import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { claimScreening, finishScreening } from '@/lib/screener-jobs.mjs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function keyOk(request) {
  const key = request.headers.get('x-screener-key') || ''
  return Boolean(process.env.SCREENER_KEY) && key === process.env.SCREENER_KEY
}

/** 대기 중인 요청이 있으면 '실행 중'으로 바꾸고 알려줍니다 */
export async function GET(request) {
  if (!keyOk(request)) return NextResponse.json({ ok: false }, { status: 401 })
  const sql = await getSql()

  const rows = await claimScreening(sql)
  return NextResponse.json({
    ok: true,
    job: rows[0]?.id || null,
    market: rows[0]?.market === 'US' ? 'US' : 'KR',
  })
}

/** 서버가 살아 있다는 신호 */
export async function POST(request) {
  if (!keyOk(request)) return NextResponse.json({ ok: false }, { status: 401 })
  const sql = await getSql()
  const body = await request.json().catch(() => null)
  if (body?.job) {
    if (!/^\d+$/.test(String(body.job)) || !['KR','US'].includes(body.market) || !['done','failed'].includes(body.status))
      return NextResponse.json({ok:false,error:'잘못된 작업 상태입니다.'},{status:400})
    await finishScreening(sql,body.job,body.market,body.status==='done',String(body.error||'스크리너 실행에 실패했습니다. 실행 로그를 확인하세요.'))
  }
  await sql`
    INSERT INTO screener_heartbeat (id, beat_at) VALUES (1, now())
    ON CONFLICT (id) DO UPDATE SET beat_at = now()`
  return NextResponse.json({ ok: true })
}
