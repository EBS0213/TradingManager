import { NextResponse } from 'next/server'
import { allowedWriteOrigin } from './lib/request-security.mjs'
import { isLocalOwnerRequest } from './lib/local-owner.mjs'
import { safeReturnPath } from './lib/workspace-routing.mjs'
export function proxy(request) {
  if (process.env.TM26_LOCAL_ONLY === '1') {
    const host = request.headers.get('host') || ''
    if (!/^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(host))
      return new NextResponse('Local access only', {status:403})
    if (!isLocalOwnerRequest(request.headers))
      return new NextResponse('Local access only', {status:403})
    if (request.nextUrl.pathname === '/login') {
      const next = safeReturnPath(request.nextUrl.searchParams.get('next'))
      const target = new URL(next, 'http://' + host)
      if (target.pathname === '/login') target.href = 'http://' + host + '/'
      return NextResponse.redirect(target)
    }
    if (/^\/api\/auth\/(signup|verify|resend)$/.test(request.nextUrl.pathname))
      return NextResponse.json({ok:false,error:'로컬 프로그램은 회원가입을 사용하지 않습니다.'},{status:410})
  }
  if (!allowedWriteOrigin(request))
    return NextResponse.json({ ok: false, error: '허용되지 않은 요청 출처입니다.' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } })
  return NextResponse.next()
}
export const config = { matcher: '/:path*' }
