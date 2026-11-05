// ============================================================
//  GET /api/v1/kr/scout — 한국 스크리너 최신 결과 (API 키 필요)
//    ?code=005930        그 종목 한 줄만
//    ?fields=종목명,종합점수  필요한 칸만 (쉼표로 구분)
//  미국 결과(market=US)는 내주지 않습니다 — 유료 시세로 만든 값이라서입니다.
// ============================================================
import { apiGate, apiJson, apiErr, KR_CODE, US_LIKE, US_REFUSED } from '@/lib/apiv1'
import { ensureMarketColumn } from '@/lib/settings'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 화면 창구(/api/screener/latest)와 같은 까닭으로, 같은 결과는 다시 풀지 않습니다
let MEMO = null      // { stamp, result }

export async function GET(request) {
  const g = await apiGate(request)
  if (g.res) return g.res
  const { sql } = g

  const q = new URL(request.url).searchParams
  if (String(q.get('market') || 'KR').toUpperCase() !== 'KR') return apiErr(US_REFUSED, 403)
  const code = String(q.get('code') || '').trim().toUpperCase()
  if (code && !KR_CODE.test(code))
    return US_LIKE.test(code) ? apiErr(US_REFUSED, 403) : apiErr('종목코드를 알아보지 못했습니다.')
  const fields = String(q.get('fields') || '').split(',').map((s) => s.trim()).filter(Boolean)

  try { await ensureMarketColumn(sql) } catch { /* 이미 있으면 그만 */ }
  const head = await sql`
    SELECT stamp FROM screener_snapshot WHERE market = 'KR' ORDER BY created_at DESC LIMIT 1`
  if (!head.length) return apiJson({ ok: true, market: 'KR', stamp: null, count: 0, rows: [] })
  if (!MEMO || MEMO.stamp !== head[0].stamp) {
    const snap = await sql`
      SELECT stamp, payload FROM screener_snapshot
      WHERE market = 'KR' ORDER BY created_at DESC LIMIT 1`
    let result = []
    try { result = JSON.parse(snap[0].payload) } catch { result = [] }
    MEMO = { stamp: snap[0].stamp, result }
  }

  let rows = MEMO.result
  if (code) rows = rows.filter((r) => String(r['코드'] || '').toUpperCase() === code)
  if (fields.length) {
    const keep = ['코드', ...fields.filter((f) => f !== '코드')]
    rows = rows.map((r) => Object.fromEntries(keep.filter((k) => k in r).map((k) => [k, r[k]])))
  }
  return apiJson({ ok: true, market: 'KR', stamp: MEMO.stamp, count: rows.length, rows })
}
