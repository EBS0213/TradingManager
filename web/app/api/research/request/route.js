// ============================================================
//  리서치 — 기업분석 리포트 요청 (2026-10-16 신설)
//
//  리서치에서 회사를 찾았는데 아직 다룬 리포트가 없으면 [리포트 요청] 을 누릅니다.
//  맥의 자동 제작(종목고르기.py)이 하루 한 번 대기 중인 요청을 받아 가서
//  정원과 상관없이 만들고 **리서치에만** 올립니다 — 텔레그램 채널로는 나가지 않습니다.
//
//   GET                  누구나 — 대기 중인 요청 코드 목록 (화면이 '요청됨' 표시에 씁니다)
//   GET   + 맥 키        맥 — 대기 중인 요청 전체
//   POST  {code,name,market}   회원 — 요청하기 (한 사람 하루 3건, 관리자는 제한 없음)
//   PATCH {code,status,note}   맥 — 다 만들었거나(done) 못 만들 때(rejected)
// ============================================================
import { NextResponse } from 'next/server'
import { currentUser, ensureTables } from '@/lib/auth'
import { keyAdmin } from '@/lib/board'
import { getSql } from '@/lib/db'
import { once } from '@/lib/once'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DAILY = 3

const ensureRequests = once('report_request', async (sql) => {
  await sql`
    CREATE TABLE IF NOT EXISTS screener_report_request (
      id         BIGSERIAL PRIMARY KEY,
      code       TEXT NOT NULL,
      name       TEXT NOT NULL DEFAULT '',
      market     TEXT NOT NULL DEFAULT 'KR',
      user_id    BIGINT REFERENCES screener_user(id) ON DELETE SET NULL,
      status     TEXT NOT NULL DEFAULT 'pending',
      note       TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      done_at    TIMESTAMPTZ
    )`
  await sql`CREATE INDEX IF NOT EXISTS screener_report_request_status
            ON screener_report_request (status, created_at)`
})

const json = (o, init) => NextResponse.json(o, init)

/* 코드 모양만 봅니다 — 한국 6자리 숫자, 미국 티커(BRK.B 같은 점 포함). 실제로 있는 종목인지는
   맥이 자료를 모을 때 가려집니다(못 모으면 rejected 로 돌려놓습니다). */
function cleanCode(v, market) {
  const c = String(v || '').trim().toUpperCase()
  if (market === 'KR') return /^\d{6}$/.test(c) ? c : ''
  return /^[A-Z][A-Z0-9.\-]{0,9}$/.test(c) ? c : ''
}

async function prep() {
  const sql = await getSql()
  await ensureTables(sql)
  await ensureRequests(sql)
  return sql
}

export async function GET(request) {
  const sql = await prep()
  const mac = await keyAdmin(request, sql)
  const rows = await sql`SELECT code, name, market, created_at FROM screener_report_request
                         WHERE status = 'pending' ORDER BY created_at ASC`
  if (mac) {
    return json({ ok: true, requests: rows.map((r) => ({
      code: r.code, name: r.name, market: r.market, created_at: r.created_at })) })
  }
  return json({ ok: true, pending: rows.map((r) => r.code) })
}

export async function POST(request) {
  const sql = await prep()
  const u = await currentUser()
  if (!u) return json({ ok: false, error: '로그인이 필요합니다.' }, { status: 401 })

  let b
  try { b = await request.json() } catch { b = null }
  const market = b?.market === 'US' ? 'US' : 'KR'
  const code = cleanCode(b?.code, market)
  const name = String(b?.name || '').trim().slice(0, 80)
  if (!code) return json({ ok: false, error: '종목 코드가 올바르지 않습니다.' }, { status: 400 })

  const same = await sql`SELECT id FROM screener_report_request
                         WHERE code = ${code} AND status = 'pending' LIMIT 1`
  if (same.length) return json({ ok: true, already: true })

  if (u.role !== 'admin') {
    const c = await sql`SELECT count(*)::int AS n FROM screener_report_request
                        WHERE user_id = ${u.id} AND created_at > now() - interval '1 day'`
    if ((Number(c[0]?.n) || 0) >= DAILY) {
      return json({ ok: false, error: `요청은 하루 ${DAILY}건까지입니다.` }, { status: 429 })
    }
  }
  await sql`INSERT INTO screener_report_request (code, name, market, user_id)
            VALUES (${code}, ${name}, ${market}, ${u.id})`
  return json({ ok: true, already: false }, { status: 201 })
}

export async function PATCH(request) {
  const sql = await prep()
  const mac = await keyAdmin(request, sql)
  if (!mac) return json({ ok: false, error: '권한이 없습니다.' }, { status: 401 })
  let b
  try { b = await request.json() } catch { b = null }
  const code = String(b?.code || '').trim().toUpperCase()
  const status = b?.status === 'rejected' ? 'rejected' : 'done'
  const note = String(b?.note || '').slice(0, 200) || null
  if (!code) return json({ ok: false, error: 'code 가 없습니다.' }, { status: 400 })
  const r = await sql`UPDATE screener_report_request
                      SET status = ${status}, note = ${note}, done_at = now()
                      WHERE code = ${code} AND status = 'pending' RETURNING id`
  return json({ ok: true, updated: r.length })
}
