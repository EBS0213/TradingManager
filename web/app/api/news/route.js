// ============================================================
//  공시 · 뉴스 — 로그인 없이 누구나 볼 수 있습니다.
//  · 공시: 전자공시(DART) 공개 API
//  · 뉴스: 언론사 RSS (제목·링크만)
//  · 15분 동안은 저장해 둔 값을 그대로 씁니다.
// ============================================================
import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { ensureSettings } from '@/lib/settings'
import { fetchDisclosures } from '@/lib/dart'
import { fetchNews } from '@/lib/rss'
import { readPushed } from '@/lib/newspush'
import { filterNews } from '@/lib/newsfilter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const TTL = 15 * 60 * 1000        // 15분
const CACHE_VER = 7   // 7: 안 받는 언론사(머니투데이) 제외 · 6: 스포츠·연예·사건사고 걸러냄

async function build(sql) {
  const errors = []
  const [disc, news] = await Promise.all([
    fetchDisclosures({ days: 7, keepDays: 2 }).catch((e) => {
      errors.push(`공시: ${e?.message || e}`); return []
    }),
    fetchNews({ max: 40 }).catch((e) => {
      errors.push(`뉴스: ${e?.message || e}`); return { items: [], errors: [] }
    }),
  ])
  errors.push(...(news.errors || []))
  if (!disc.length) errors.push('공시: 최근 7일 안에 공시가 없습니다 (주말·연휴)')

  // 로컬 수집기가 보내 준 기사를 합칩니다.
  //  뉴스1·한국경제는 해외 데이터센터에서 오는 요청을 막습니다(403).
  //  이 사이트는 미국 서버에서 도니 직접은 못 받고, 서울 서버를 거쳐 받습니다.
  const pushed = await readPushed(sql)
  const seen = new Set()
  const merged = []
  for (const x of [...(news.items || []), ...pushed]) {
    const k = String(x.title || '').replace(/\s/g, '')
    if (!k || seen.has(k)) continue
    seen.add(k)
    merged.push(x)
  }
  merged.sort((a, b) => (b.ms || 0) - (a.ms || 0))
  // 경제·정치·세계만 남깁니다 ([포토] 사진 기사, 스포츠·연예·사건사고는 버림).
  //  제목의 &#039; 같은 실체 참조도 여기서 풀어 줍니다.
  const kept = filterNews(merged)
  const feeds = [...(news.feeds || [])]
  const byPush = {}
  pushed.forEach((x) => { byPush[x.source] = (byPush[x.source] || 0) + 1 })
  for (const [name, count] of Object.entries(byPush))
    feeds.push({ name, ok: true, count, via: '맥미니 로컬' })

  const now = new Date(Date.now() + 9 * 3600 * 1000)
  const p = (n) => String(n).padStart(2, '0')
  return {
    v: CACHE_VER,
    stamp: `${now.getUTCFullYear()}-${p(now.getUTCMonth() + 1)}-${p(now.getUTCDate())} `
      + `${p(now.getUTCHours())}:${p(now.getUTCMinutes())}`,
    disclosures: disc,
    news: kept.slice(0, 80),
    feeds,
    errors,
  }
}

export async function GET() {
  let sql = null
  try { sql = await getSql(); await ensureSettings(sql) } catch { sql = null }

  if (sql) {
    try {
      const r = await sql`SELECT value, updated_at FROM screener_settings WHERE key = 'news'`
      if (r.length && r[0].value?.v === CACHE_VER
          && Date.now() - new Date(r[0].updated_at).getTime() < TTL)
        return NextResponse.json({ ok: true, cached: true, ...r[0].value },
          { headers: { 'content-type': 'application/json; charset=utf-8' } })
    } catch { /* 저장된 값이 없으면 새로 받습니다 */ }
  }

  const data = await build(sql)
  if (sql) {
    try {
      const json = JSON.stringify(data)
      await sql`
        INSERT INTO screener_settings (key, value, updated_at)
        VALUES ('news', ${json}::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = ${json}::jsonb, updated_at = now()`
    } catch { /* 저장 실패해도 화면은 보여줍니다 */ }
  }
  return NextResponse.json({ ok: true, cached: false, ...data },
    { headers: { 'content-type': 'application/json; charset=utf-8' } })
}
