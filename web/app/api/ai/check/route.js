import { NextResponse } from 'next/server'
import { localAIStatus } from '@/lib/local-ai'
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET(request) {
  const key = request.headers.get('x-screener-key') || new URL(request.url).searchParams.get('k') || ''
  if (!process.env.SCREENER_KEY || key !== process.env.SCREENER_KEY)
    return NextResponse.json({ ok: false }, { status: 401 })
  const state = await localAIStatus()
  const online = Boolean(state.heartbeat?.at) && Date.now() - Date.parse(state.heartbeat.at) < 20 * 60000
  return NextResponse.json({ ok: true, online, ...state }, { headers: { 'cache-control': 'no-store' } })
}
