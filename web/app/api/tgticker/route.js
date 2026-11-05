// ============================================================
//  실시간 피드 전광판 — 머리글에서 지수 전광판 아래로 흐르는 줄.
//
//  텔레그램 공개 채널 @hyperspect 의 **글 제목(첫 줄)과 원문 링크만** 씁니다.
//  본문은 받지도 저장하지도 보여주지도 않습니다 — 뉴스와 같은 원칙입니다.
//  제목을 누르면 텔레그램 원문으로 넘어갑니다.
//
//  · 공개 채널의 미리보기 페이지(t.me/s/채널)를 읽습니다. 로그인도 봇도 없습니다.
//  · 5분 동안은 담아 둔 값을 그대로 씁니다. 머리글은 어느 화면에서나 뜨므로
//    사람마다 매번 텔레그램을 두드리면 채널 쪽에 실례입니다.
//  · 로그인하지 않아도 보입니다 (지수 전광판과 같은 자리라 가릴 이유가 없습니다).
// ============================================================
import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { ensureSettings } from '@/lib/settings'
import { fetchTgChannel } from '@/lib/tgfeed'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const CH = { id: 'hyperspect', name: 'hyperspect', kind: '해외' }
const KEY = 'tgticker'
const TTL = 5 * 60 * 1000        // 5분
const MAX = 24                   // 전광판 한 바퀴에 담을 글 수

const UTF8 = { 'content-type': 'application/json; charset=utf-8' }
const json = (o) => NextResponse.json(o, { headers: UTF8 })

export async function GET() {
  let sql = null
  try { sql = await getSql(); await ensureSettings(sql) } catch { sql = null }

  if (sql) {
    try {
      const r = await sql`SELECT value, updated_at FROM screener_settings WHERE key = ${KEY}`
      if (r.length && Array.isArray(r[0].value?.items)
          && Date.now() - new Date(r[0].updated_at).getTime() < TTL)
        return json({ ok: true, cached: true, items: r[0].value.items })
    } catch { /* 담아 둔 것이 없으면 새로 받습니다 */ }
  }

  let items = []
  let error = ''
  try {
    const rows = await fetchTgChannel(CH)
    items = rows
      .filter((x) => x.title && x.title.length >= 4)
      .slice(0, MAX)
      // 제목과 링크, 올린 시각. 그게 전부입니다.
      .map((x) => ({ title: x.title.slice(0, 120), url: x.url, ms: x.ms ?? null }))
  } catch (e) {
    error = String(e?.message || e)
  }

  // 못 받았으면 **담아 둔 옛 값이라도** 내보냅니다.
  //  전광판이 통째로 사라지는 것보다 조금 지난 소식이 도는 편이 낫습니다.
  if (!items.length && sql) {
    try {
      const r = await sql`SELECT value FROM screener_settings WHERE key = ${KEY}`
      if (Array.isArray(r[0]?.value?.items)) items = r[0].value.items
    } catch { /* 그래도 없으면 빈 채로 갑니다 — 화면이 줄을 감춥니다 */ }
    return json({ ok: true, stale: true, items, error })
  }

  if (sql && items.length) {
    try {
      const v = JSON.stringify({ items })
      await sql`
        INSERT INTO screener_settings (key, value, updated_at)
        VALUES (${KEY}, ${v}::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = ${v}::jsonb, updated_at = now()`
    } catch { /* 저장 실패해도 화면은 보여줍니다 */ }
  }
  return json({ ok: true, cached: false, items, error })
}
