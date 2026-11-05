// ============================================================
//  공개 API(v1) 공통 — 키 확인과 답 모양 (2026-10-08)
//  /api/v1/kr/* 는 화면용 창구와 따로 둡니다. 화면 창구를 고쳐도 API 를 쓰는
//  사람의 프로그램이 깨지지 않게 하려는 것입니다.
// ============================================================
import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { checkApiKey } from '@/lib/apikey'

const HEAD = {
  'content-type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
}
export const apiJson = (o, status = 200) => NextResponse.json(o, { status, headers: HEAD })
export const apiErr = (msg, status = 400) => apiJson({ ok: false, error: msg }, status)

/** 키를 확인하고 sql 을 돌려줍니다. 실패하면 { res } 에 보낼 답이 들어 있습니다. */
export async function apiGate(request) {
  // 키처럼 생긴 것이 아예 없으면 DB 에 묻지 않고 바로 돌려보냅니다 (아무나 두드리는 요청)
  const h = request.headers
  if (!/tmk_/.test(h.get('authorization') || '') && !/^tmk_/.test(h.get('x-api-key') || ''))
    return { res: apiErr('API 키가 없습니다. Authorization: Bearer <키> 로 보내 주세요.', 401) }
  const sql = await getSql()
  const g = await checkApiKey(sql, request)
  if (g.error) return { res: apiErr(g.error, g.status) }
  return { sql, user: g.user }
}

// 한국 종목코드 — 숫자 5자리 + 숫자·영문 1자리 (신형우선주 00104K 등)
export const KR_CODE = /^\d{5}[0-9A-Z]$/
// 미국 티커처럼 보이면 따로 알려 줍니다 (유료 자료라 API 로 열지 않습니다)
export const US_LIKE = /^[A-Z][A-Z.\-]{0,6}$/
export const US_REFUSED = '미국 자료는 API 로 제공하지 않습니다. 한국 종목코드(6자리)만 받습니다.'
