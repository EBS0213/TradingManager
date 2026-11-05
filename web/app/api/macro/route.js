// ============================================================
//  지표 화면 — GET 은 보여주기, POST 는 서울 서버가 밀어 넣기
//
//  GET  /api/macro          누구나. 10분 동안은 담아 둔 값을 그대로 돌려줍니다.
//  POST /api/macro          헤더 x-screener-key. 본문 { groups:[...] }
//                           (tools/push_macro.py 가 하루 한 번 보냅니다)
// ============================================================
import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { ensureSettings } from '@/lib/settings'
import { buildMacroFeed, cleanGroups, PUSH_KEY } from '@/lib/macrofeed'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CACHE_KEY = 'macro_feed_cache'
const TTL = 10 * 60 * 1000        // 10분

function keyOk(request) {
  const k = request.headers.get('x-screener-key')
    || new URL(request.url).searchParams.get('k') || ''
  return Boolean(process.env.SCREENER_KEY) && k === process.env.SCREENER_KEY
}

export async function GET(request) {
  const fresh = new URL(request.url).searchParams.get('fresh') === '1'
  let sql = null
  try { sql = await getSql() } catch { sql = null }
  if (sql) await ensureSettings(sql)

  if (sql && !fresh) {
    try {
      const r = await sql`SELECT value, updated_at FROM screener_settings WHERE key = ${CACHE_KEY}`
      if (r.length && Date.now() - new Date(r[0].updated_at).getTime() < TTL) {
        return NextResponse.json({ ...r[0].value, cached: true })
      }
    } catch { /* 담아 둔 값이 없으면 그냥 새로 만듭니다 */ }
  }

  const feed = await buildMacroFeed(sql)
  if (sql) {
    try {
      const v = JSON.stringify(feed)
      await sql`
        INSERT INTO screener_settings (key, value, updated_at)
        VALUES (${CACHE_KEY}, ${v}::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = ${v}::jsonb, updated_at = now()`
    } catch { /* 못 담아도 화면은 나갑니다 */ }
  }
  return NextResponse.json(feed)
}

export async function POST(request) {
  if (!keyOk(request)) return NextResponse.json({ ok: false, error: 'key' }, { status: 401 })
  let b = {}
  try { b = await request.json() } catch { b = {} }
  const groups = cleanGroups(b.groups)
  if (!groups.length) {
    return NextResponse.json({ ok: false, error: '쓸 수 있는 줄이 없습니다' }, { status: 400 })
  }
  let sql = null
  try { sql = await getSql() } catch { sql = null }
  if (!sql) return NextResponse.json({ ok: false, error: 'db' }, { status: 503 })
  await ensureSettings(sql)

  const payload = { at: new Date().toISOString(), via: 'seoul', groups }
  const v = JSON.stringify(payload)
  await sql`
    INSERT INTO screener_settings (key, value, updated_at)
    VALUES (${PUSH_KEY}, ${v}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = ${v}::jsonb, updated_at = now()`
  // 담아 둔 화면 값은 버립니다 — 다음에 열 때 새 자료로 다시 만듭니다
  try { await sql`DELETE FROM screener_settings WHERE key = ${CACHE_KEY}` } catch { /* 무시 */ }
  return NextResponse.json({ ok: true, groups: groups.length,
    rows: groups.reduce((n, g) => n + g.rows.length, 0) })
}
