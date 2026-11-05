// ============================================================
//  뉴스 받아두기 — AWS 서버(서울) → 여기로 POST
//
//  왜 이런 우회로가 필요한가
//   뉴스1·한국경제 같은 곳은 해외 데이터센터에서 오는 요청을 403 으로 막습니다.
//   이 사이트는 미국 서버(Vercel)에서 도니까 그대로 막힙니다.
//   그런데 스크리너가 도는 AWS 서버는 서울에 있고 IP 도 고정입니다.
//   거기서 받아 이리로 보내면 됩니다. 공시·시세를 이미 그렇게 받고 있습니다.
//
//  ※ 보내는 것은 제목과 원문 링크뿐입니다. 본문은 받지도 저장하지도 않습니다.
// ============================================================
import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { ensureSettings } from '@/lib/settings'
import { NEWS_PUSH_KEY } from '@/lib/newspush'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const KEY = NEWS_PUSH_KEY
const MAX = 200
const UTF8 = { 'content-type': 'application/json; charset=utf-8' }
const json = (o, init) => NextResponse.json(o, { ...init, headers: UTF8 })

function keyOk(request) {
  const k = request.headers.get('x-screener-key') || ''
  return Boolean(process.env.SCREENER_KEY) && k === process.env.SCREENER_KEY
}

export async function POST(request) {
  if (!keyOk(request)) return json({ ok: false, error: '키가 올바르지 않습니다.' }, { status: 401 })

  let body
  try { body = await request.json() }
  catch (e) { return json({ ok: false, error: '본문을 읽지 못했습니다' }, { status: 400 }) }

  const rows = Array.isArray(body?.items) ? body.items : null
  if (!rows) return json({ ok: false, error: 'items 가 없습니다' }, { status: 400 })

  // 보내온 것을 그대로 믿지 않고 필요한 칸만 골라 담습니다
  const items = []
  for (const x of rows) {
    const title = String(x?.title || '').replace(/\s+/g, ' ').trim()
    const url = String(x?.url || '').trim()
    const source = String(x?.source || '').trim()
    if (!title || !source) continue
    if (!/^https?:\/\//i.test(url)) continue        // 이상한 링크는 버립니다
    const ms = Number(x?.ms)
    items.push({ source, title, url, ms: Number.isFinite(ms) ? ms : null })
    if (items.length >= MAX) break
  }
  if (!items.length) return json({ ok: false, error: '쓸 만한 기사가 없습니다' }, { status: 400 })

  const sql = await getSql()
  await ensureSettings(sql)
  const v = JSON.stringify({ at: new Date().toISOString(), items })
  await sql`
    INSERT INTO screener_settings (key, value, updated_at)
    VALUES (${KEY}, ${v}::jsonb, now())
    ON CONFLICT (key) DO UPDATE SET value = ${v}::jsonb, updated_at = now()`

  const by = {}
  items.forEach((x) => { by[x.source] = (by[x.source] || 0) + 1 })
  return json({ ok: true, saved: items.length, by })
}
