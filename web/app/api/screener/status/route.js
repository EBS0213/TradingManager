// ============================================================
//  진행 상태 · 마지막 결과 시각 · 서버 생존 여부 (누구나 조회)
// ============================================================
import { NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth'
import { getSql } from '@/lib/db'
import { ensureScreenerJobs } from '@/lib/screener-jobs.mjs'

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
  await ensureScreenerJobs(sql)
  const jobs = await sql`SELECT DISTINCT ON(market) id,market,status,error,requested_at,finished_at
    FROM screener_job ORDER BY market,requested_at DESC,id DESC`
  const job = await sql`SELECT status FROM screener_job WHERE status IN ('requested','running') LIMIT 1`
  const hb = await sql`SELECT beat_at FROM screener_heartbeat WHERE id = 1`
  const alive = hb[0]?.beat_at
    ? (Date.now() - new Date(hb[0].beat_at).getTime()) < 5 * 60 * 1000
    : false
  const u = await currentUser()

  return NextResponse.json({
    ok: true,
    stamp: snap[0]?.stamp || null,
    stamps,                       // { KR: '…', US: '…' }
    jobs: Object.fromEntries(jobs.map(job=>[job.market,job])),
    rows: snap[0]?.rows || 0,
    passed: snap[0]?.passed || 0,
    running: ['requested', 'running'].includes(job[0]?.status),
    agent: alive,
    signedIn: Boolean(u),
    admin: Boolean(u && u.role === 'admin'),
    email: u?.email || null,
  })
}
