// ============================================================
//  시장 심리 게이지 세 개 (공포/탐욕 · 버핏지수 · BofA 불&베어)
//
//  · GET /api/gauge          → 세 값 (30분 캐시)
//  · GET /api/gauge?force=1  → 캐시 무시하고 새로 받기 (SCREENER_KEY 필요)
//
//  자료가 하나 빠져도 나머지는 그대로 내려줍니다.
//  화면은 빠진 칸만 '자료 없음' 으로 그리면 됩니다.
// ============================================================
import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { buildGauges, BOFA_SELL, BOFA_BUY } from '@/lib/gauge'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// FRED 가 느려 25초까지 기다립니다. 기본 제한(10초) 이면 그 전에 잘립니다.
export const maxDuration = 60

export async function GET(request) {
  const u = new URL(request.url)
  const key = request.headers.get('x-screener-key') || u.searchParams.get('k') || ''
  const mayForce = Boolean(process.env.SCREENER_KEY) && key === process.env.SCREENER_KEY
  const force = mayForce && u.searchParams.get('force') === '1'

  let sql = null
  try { sql = await getSql() } catch { sql = null }
  if (!sql) {
    return NextResponse.json(
      { ok: false, error: '데이터베이스에 연결하지 못했습니다' }, { status: 503 })
  }
  try {
    const g = await buildGauges(sql, { force })
    return NextResponse.json({ ok: true, ...g, bofaSell: BOFA_SELL, bofaBuy: BOFA_BUY })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
