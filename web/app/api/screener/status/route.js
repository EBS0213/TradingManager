// ============================================================
//  진행 상태 · 마지막 결과 시각 · 서버 생존 여부 (누구나 조회)
// ============================================================
import { NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth'
import { getSql } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const sql = await getSql()
  const snap = await sql`SELECT stamp, rows, passed FROM screener_snapshot
                         ORDER BY created_at DESC LIMIT 1`
  /* 시장마다 **가장 최근 결과 시각**을 따로 알려 줍니다 (2026-08-28).
     전에는 시장 구분 없이 마지막 하나만 보냈습니다. 그래서 미국 스크리너가
     끝나면 시각이 바뀌었다는 이유로 화면이 **한국 자료를 다시 받고**,
     정작 미국 목록은 낡은 채로 남았습니다.
     한 줄 질의로 두 시장의 최신 시각을 함께 가져옵니다. */
  let stamps = {}
  try {
    const per = await sql`
      SELECT DISTINCT ON (market) market, stamp
      FROM screener_snapshot ORDER BY market, created_at DESC`
    for (const r of per) stamps[String(r.market || 'KR')] = r.stamp
  } catch { stamps = {} }
  /* 오래 매달려 있는 작업을 치웁니다.
     2026-08-23: 45분 → 100분. 수동 실행이 **한국·미국을 연달아** 돌게 되면서
     한 번에 20~55분(느리면 그 이상)이 걸립니다. 45분으로 두면 **아직 돌고 있는데도**
     실패로 적혀 단추가 풀리고, 사용자가 또 누르면 같은 일을 두 번 하게 됩니다.
     반대로 너무 길게 두면 서버가 죽었을 때 단추가 오래 잠깁니다 — 100분이 그 사이입니다. */
  await sql`UPDATE screener_job SET status='failed', finished_at=now()
            WHERE status IN ('requested','running')
              AND requested_at < now() - interval '100 minutes'`
  const job = await sql`SELECT status FROM screener_job ORDER BY requested_at DESC LIMIT 1`
  const hb = await sql`SELECT beat_at FROM screener_heartbeat WHERE id = 1`
  const alive = hb[0]?.beat_at
    ? (Date.now() - new Date(hb[0].beat_at).getTime()) < 5 * 60 * 1000
    : false
  const u = await currentUser()

  return NextResponse.json({
    ok: true,
    stamp: snap[0]?.stamp || null,
    stamps,                       // { KR: '…', US: '…' }
    rows: snap[0]?.rows || 0,
    passed: snap[0]?.passed || 0,
    running: ['requested', 'running'].includes(job[0]?.status),
    agent: alive,
    signedIn: Boolean(u),
    admin: Boolean(u && u.role === 'admin'),
    email: u?.email || null,
  })
}
