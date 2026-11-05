// 예전 비밀번호 한 개 방식은 계정 로그인(/api/auth/login)으로 대체되었습니다.
import { NextResponse } from 'next/server'
export const runtime = 'nodejs'
export async function POST() {
  return NextResponse.json(
    { ok: false, error: '이제 이메일 계정으로 로그인합니다.' }, { status: 410 })
}
