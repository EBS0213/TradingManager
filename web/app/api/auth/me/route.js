// 지금 접속한 사람이 누구인지 알려줍니다 (화면이 메뉴를 정할 때 씁니다)
import { NextResponse } from 'next/server'
import { currentUser, setSession } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const u = await currentUser()

  // 들어올 때마다 로그인 기한을 30일로 다시 채웁니다.
  // (자주 쓰는 사람이 갑자기 로그아웃되는 일을 막습니다)
  if (u && !u.local) { try { await setSession(u.id) } catch {} }

  const body = u
    ? { ok: true, signedIn: true, email: u.email, nickname: u.nickname || null,
        role: u.role, admin: u.role === 'admin', local: u.local === true }
    : { ok: true, signedIn: false, admin: false }

  return NextResponse.json(body, {
    // 이 답은 어디에도 저장되면 안 됩니다.
    // (남의 '로그인 안 됨' 답이 저장돼 내려오면 멀쩡히 로그인해도 로그아웃처럼 보입니다)
    headers: {
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      'CDN-Cache-Control': 'no-store',
      'Vercel-CDN-Cache-Control': 'no-store',
    },
  })
}
