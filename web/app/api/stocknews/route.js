// ============================================================
//  종목별 관련 뉴스 — 검색 상세의 [관련 뉴스] 칸이 씁니다.
//  · /api/stocknews?code=005930
//  · 종목마다 20분 동안은 저장해 둔 값을 그대로 씁니다.
//
//  한국 — 네이버 종목 뉴스(lib/naver.js 의 fetchStockNews).
//  미국 — 종목별 뉴스를 무료로 받을 곳이 마땅치 않습니다. 그래서 홈 화면이 쓰는
//        전체 뉴스에서 **회사 이름·티커가 제목에 든 것**만 걸러 냅니다.
//        (한국 매체 기사라 미국 소형주는 대개 0건입니다. 없으면 없다고 적습니다 —
//         빈 칸을 '불러오지 못했습니다' 로 보여주면 고장으로 오해합니다)
// ============================================================
import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { ensureSettings } from '@/lib/settings'
import { fetchStockNews } from '@/lib/naver'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const TTL = 20 * 60 * 1000        // 20분
const CACHE_KEY = 'stocknews'
const MAX = 20                    // 한 종목당 최대 기사 수

const UTF8 = { 'content-type': 'application/json; charset=utf-8' }
const json = (o, init) => NextResponse.json(o, { ...init, headers: UTF8 })

/* 전체 뉴스에서 이름으로 걸러 내기 — 미국 종목과, 한국인데 네이버가 비었을 때의 대비책 */
async function fromFeed(sql, words) {
  if (!sql || !words.length) return []
  try {
    const r = await sql`SELECT value FROM screener_settings WHERE key = 'news'`
    const items = Array.isArray(r[0]?.value?.news) ? r[0].value.news : []
    const hit = []
    for (const x of items) {
      const t = String(x.title || '')
      if (words.some((w) => w && t.includes(w))) {
        hit.push({
          title: t, url: x.url || x.link || '', source: x.source || '',
          day: x.day || '', time: '',
          // 전체 뉴스 쪽에도 그림이 있으면 그대로 씁니다 (2026-09-13)
          image: String(x.image || x.thumbnail || x.imageUrl || '').trim(),
        })
      }
      if (hit.length >= MAX) break
    }
    return hit
  } catch { return [] }
}

export async function GET(request) {
  const q = new URL(request.url).searchParams
  const raw = String(q.get('code') || '').trim()
  const name = String(q.get('name') || '').trim()
  if (!raw) return json({ ok: true, items: [], source: 'none' })

  const isKR = /^\d{6}$/.test(raw)
  const key = `${raw.toUpperCase()}`

  let sql = null
  try { sql = await getSql(); await ensureSettings(sql) } catch { sql = null }

  // 담아 둔 것이 아직 새것이면 그대로 씁니다
  let store = {}
  if (sql) {
    try {
      const r = await sql`SELECT value FROM screener_settings WHERE key = ${CACHE_KEY}`
      if (r.length && r[0].value && typeof r[0].value === 'object') store = r[0].value
      const hit = store[key]
      if (hit && Date.now() - (hit.t || 0) < TTL)
        return json({ ok: true, cached: true, items: hit.items || [], source: hit.src || '' })
    } catch { /* 없으면 새로 받습니다 */ }
  }

  let items = []
  let src = ''
  if (isKR) {
    try { items = await fetchStockNews(raw, MAX); src = '네이버 종목뉴스' }
    catch { items = [] }
  }
  if (!items.length) {
    // 회사 이름은 '주식회사' 같은 꼬리를 떼고, 두 글자 이상만 씁니다
    const words = [name.replace(/\s*(주식회사|Inc\.?|Corp\.?|Ltd\.?|plc|Co\.?)\s*/gi, '').trim(),
                   isKR ? '' : raw.toUpperCase()].filter((w) => w && w.length >= 2)
    items = await fromFeed(sql, words)
    if (items.length) src = '전체 뉴스에서 걸러 냄'
  }

  if (sql) {
    try {
      const now = Date.now()
      store[key] = { t: now, items, src }
      // 오래된 것은 버려 저장값이 계속 커지지 않게 합니다
      const keep = {}
      for (const [k, v] of Object.entries(store))
        if (now - (v?.t || 0) < 3 * TTL) keep[k] = v
      const val = JSON.stringify(keep)
      await sql`
        INSERT INTO screener_settings (key, value, updated_at)
        VALUES (${CACHE_KEY}, ${val}::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = ${val}::jsonb, updated_at = now()`
    } catch { /* 저장 실패해도 화면은 보여줍니다 */ }
  }
  return json({ ok: true, cached: false, items, source: src })
}
