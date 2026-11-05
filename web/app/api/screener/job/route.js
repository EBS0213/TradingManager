// ============================================================
//  AWS 서버가 30초마다 물어보는 곳: "지금 실행할 일이 있나요?"
//  비밀 키(SCREENER_KEY)로 확인합니다.
// ============================================================
import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'

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

  /* 오래 매달려 있는 작업을 치웁니다.
     2026-08-23: 45분 → 100분. 수동 실행이 **한국·미국을 연달아** 돌게 되면서
     한 번에 20~55분(느리면 그 이상)이 걸립니다. 45분으로 두면 **아직 돌고 있는데도**
     실패로 적혀 단추가 풀리고, 사용자가 또 누르면 같은 일을 두 번 하게 됩니다.
     반대로 너무 길게 두면 서버가 죽었을 때 단추가 오래 잠깁니다 — 100분이 그 사이입니다. */
  await sql`UPDATE screener_job SET status='failed', finished_at=now()
            WHERE status IN ('requested','running')
              AND requested_at < now() - interval '100 minutes'`

  /* 2026-09-19 — market 을 함께 돌려줍니다.
     서버의 tools/agent.py 는 `r.get('market')` 으로 **누른 시장**을 읽어
     그쪽을 먼저 돌리게 되어 있는데(2026-08-23), 여기서 그 값을 한 번도
     보내 준 적이 없습니다. 그래서 무엇을 누르든 늘 KR 로 읽혀
     「미국 지금 다시 스크리너」를 눌러도 한국부터 돌았습니다. */
  const rows = await sql`
    UPDATE screener_job SET status='running'
    WHERE id = (SELECT id FROM screener_job WHERE status='requested'
                ORDER BY requested_at LIMIT 1)
    RETURNING id, market`
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
  await sql`
    INSERT INTO screener_heartbeat (id, beat_at) VALUES (1, now())
    ON CONFLICT (id) DO UPDATE SET beat_at = now()`
  return NextResponse.json({ ok: true })
}
