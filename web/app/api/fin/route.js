// ============================================================
//  재무제표 보기 — /api/fin?code=131290
//  · 서버(서울)가 DART 에서 받아 보내 준 것을 그대로 돌려줍니다.
//  · 로그인한 사람만 볼 수 있습니다 (숫자를 통째로 퍼가는 것을 막습니다).
// ============================================================
import { NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth'
import { getSql } from '@/lib/db'
import { ensureSettings } from '@/lib/settings'
import { readFin, FIN_KEY } from '@/lib/fin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UTF8 = { 'content-type': 'application/json; charset=utf-8' }
const json = (o, init) => NextResponse.json(o, { ...init, headers: UTF8 })

export async function GET(request) {
  const u = await currentUser()
  if (!u) return json({ ok: false, error: '로그인이 필요합니다' }, { status: 401 })

  const q = new URL(request.url).searchParams
  const code = String(q.get('code') || '').replace(/\D/g, '')

  let sql = null
  try { sql = await getSql(); await ensureSettings(sql) } catch { sql = null }

  // 코드가 없으면 '무엇을 갖고 있는지' 만 알려줍니다
  if (code.length !== 6) {
    try {
      const r = await sql`SELECT value, updated_at FROM screener_settings WHERE key = ${FIN_KEY}`
      const all = r[0]?.value || {}
      const codes = Object.keys(all)
      return json({ ok: true, 보유종목: codes.length,
        재무있음: codes.filter((c) => (all[c]?.분기 || []).length).length,
        갱신: r[0]?.updated_at || null })
    } catch {
      return json({ ok: true, 보유종목: 0, 재무있음: 0, 갱신: null })
    }
  }

  const fin = await readFin(sql, code)
  if (!fin)
    return json({ ok: true, code, fin: null,
      note: '아직 이 종목의 재무를 받지 않았습니다 (워치리스트에 넣으면 다음 날 들어옵니다)' })
  return json({ ok: true, code, fin })
}
