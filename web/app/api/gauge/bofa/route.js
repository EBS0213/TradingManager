// ============================================================
//  BofA 불&베어 값 넣기
//
//  · POST { "value": 9.7, "prev": 9.4 }   → 손으로 넣기
//  · POST { "auto": true }                → 기사에서 찾아 넣기 (주 1회 크론)
//  둘 다 x-screener-key 가 있어야 합니다.
//
//  자동이 못 찾으면 아무것도 바꾸지 않습니다. 마지막 값이 그대로 남고
//  화면이 '며칠 전 값' 이라고 밝힙니다 — 억지로 채우는 것보다 낫습니다.
// ============================================================
import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { writeBofa, readBofa } from '@/lib/gauge'
import { findBofa } from '@/lib/bofa'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function keyOk(request) {
  const k = request.headers.get('x-screener-key')
    || new URL(request.url).searchParams.get('k') || ''
  return Boolean(process.env.SCREENER_KEY) && k === process.env.SCREENER_KEY
}

export async function POST(request) {
  if (!keyOk(request)) return NextResponse.json({ ok: false, error: 'key' }, { status: 401 })

  let sql = null
  try { sql = await getSql() } catch { sql = null }
  if (!sql) return NextResponse.json({ ok: false, error: 'db' }, { status: 503 })

  let body = {}
  try { body = await request.json() } catch { body = {} }

  if (body.auto) {
    let hit = null
    try { hit = await findBofa() } catch (e) {
      return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 })
    }
    if (!hit) {
      const cur = await readBofa(sql)
      return NextResponse.json({ ok: false, found: false,
        message: '이번 주 기사에서 값을 찾지 못했습니다 — 마지막 값을 그대로 둡니다',
        current: cur })
    }
    if (hit.queued) return NextResponse.json({ ok: true, queued: true, job: hit.job,
      current: await readBofa(sql), message: '맥미니 확인 대기 중입니다. 마지막 값을 유지합니다.' }, { status: 202 })
    const saved = await writeBofa(sql, hit)
    return NextResponse.json({ ok: true, found: true, saved })
  }

  const v = Number(body.value)
  if (!Number.isFinite(v) || v < 0 || v > 10) {
    return NextResponse.json(
      { ok: false, error: 'value 는 0 에서 10 사이 숫자여야 합니다' }, { status: 400 })
  }
  const saved = await writeBofa(sql, {
    value: v,
    prev: Number.isFinite(Number(body.prev)) ? Number(body.prev) : null,
    source: body.source || '', title: body.title || '', by: 'manual',
  })
  return NextResponse.json({ ok: true, saved })
}

export async function GET(request) {
  if (!keyOk(request)) return NextResponse.json({ ok: false, error: 'key' }, { status: 401 })
  let sql = null
  try { sql = await getSql() } catch { sql = null }
  if (!sql) return NextResponse.json({ ok: false, error: 'db' }, { status: 503 })
  return NextResponse.json({ ok: true, current: await readBofa(sql) })
}
