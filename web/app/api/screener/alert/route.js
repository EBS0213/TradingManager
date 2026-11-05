// ============================================================
//  서버 작업이 실패했을 때 텔레그램으로 알립니다.
//
//  왜 이렇게 하나
//   텔레그램 토큰은 Vercel 에만 있고 AWS 서버에는 없습니다.
//   서버에 토큰을 또 복사해 두면 새는 곳이 하나 늘어납니다.
//   그래서 서버는 SCREENER_KEY 만 들고 이 주소를 두드리고,
//   실제 발송은 사이트가 대신 합니다.
//
//  POST /api/screener/alert
//    헤더 x-screener-key: <SCREENER_KEY>
//    본문 { "text": "보낼 내용" }
// ============================================================
import { NextResponse } from 'next/server'
import { sendTelegram } from '@/lib/brief'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function keyOk(request) {
  const k = request.headers.get('x-screener-key') || ''
  return Boolean(process.env.SCREENER_KEY) && k === process.env.SCREENER_KEY
}

export async function POST(request) {
  if (!keyOk(request)) {
    return NextResponse.json({ ok: false, error: 'key' }, { status: 401 })
  }
  let body = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'body' }, { status: 400 })
  }
  const text = String(body.text || '').slice(0, 3500)
  if (!text.trim()) {
    return NextResponse.json({ ok: false, error: 'empty' }, { status: 400 })
  }
  try {
    await sendTelegram(text)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
  }
}
