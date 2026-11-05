// ============================================================
//  경제 캘린더 — 미국 · 일본 · 중국
//  · 자료: Forex Factory 공개 주간 피드 (키 없이 열립니다)
//  · 30분 동안은 저장해 둔 값을 그대로 씁니다.
//  · 한국 지표는 한국은행·통계청 연동이 붙으면 여기에 합쳐집니다.
// ============================================================
import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { ensureSettings } from '@/lib/settings'
import { toKo } from '@/lib/calendar-ko'
import { krSchedule, aroundMonths } from '@/lib/calendar-kr'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const TTL = 30 * 60 * 1000        // 30분
// 저장 형식이 바뀌면 이 번호를 올립니다.
// 그러면 저장해 둔 옛 값은 무시하고 새로 받아옵니다.
const CACHE_VER = 7
// Forex Factory 는 '이번 주' 하나만 공개합니다 (nextweek·lastweek 는 404).
//  그리고 주가 바뀌면 지난주 발표치가 통째로 사라집니다.
//  그래서 실제 발표치는 볼 때마다 우리가 따로 쌓아 둡니다 (아래 ACT_KEY).
//  월요일 아침에 '지난 금요일 지표가 예상을 밑돌았다' 를 쓸 수 있으려면 이게 있어야 합니다.
const FEEDS = [
  'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
]
const ACT_KEY = 'calendar_actuals'
const ACT_DAYS = 10        // 열흘치만 보관합니다

// 보여줄 나라만 남깁니다
const WANT = { USD: '미국', JPY: '일본', CNY: '중국' }

/* 한국 시간으로 바꿉니다. 피드의 날짜에는 시차 정보가 붙어 있습니다. */
function toKst(iso) {
  const d = new Date(iso)
  if (isNaN(d)) return null
  const k = new Date(d.getTime() + 9 * 3600 * 1000)
  const p = (n) => String(n).padStart(2, '0')
  return {
    day: `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())}`,
    time: `${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`,
    dow: ['일', '월', '화', '수', '목', '금', '토'][k.getUTCDay()],
    ms: k.getTime(),
  }
}

/* 관리자가 넣어 둔 한국 일정 */
async function koreaItems() {
  try {
    const sql = await getSql()
    const r = await sql`SELECT value FROM screener_settings WHERE key = 'calendar_kr'`
    const items = Array.isArray(r[0]?.value?.items) ? r[0].value.items : []
    const dow = ['일', '월', '화', '수', '목', '금', '토']
    return items.map((x) => ({
      nation: '한국', code: 'KRW',
      title: String(x.title || ''), impact: String(x.impact || 'Medium'),
      forecast: '', previous: '',
      day: x.day, time: x.time || '',
      dow: dow[new Date(`${x.day}T00:00:00Z`).getUTCDay()],
      ms: new Date(`${x.day}T${x.time || '00:00'}:00Z`).getTime(),
    }))
  } catch { return [] }
}

async function build() {
  const items = []
  const errors = []

  // 해외 지표를 못 받아와도 한국 일정은 그대로 보여줍니다
  let raw = []
  for (const url of FEEDS) {
    try {
      const r = await fetch(url, { cache: 'no-store' })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      if (!Array.isArray(j)) throw new Error('형식이 다릅니다')
      raw.push(...j)
    } catch (e) {
      // 다음 주 것이 아직 없을 수도 있습니다. 이번 주 것만 있어도 화면은 돕니다.
      errors.push(`해외 지표(${url.includes('next') ? '다음주' : '이번주'}): ${e?.message || e}`)
    }
  }

  for (const x of raw) {
    const nation = WANT[x.country]
    if (!nation) continue
    const k = toKst(x.date)
    if (!k) continue
    items.push({
      nation, code: x.country,
      title: toKo(x.title),               // 우리말로. 사전에 없으면 영어 그대로
      titleEn: String(x.title || '').trim(),
      impact: String(x.impact || '').trim(),      // High · Medium · Low · Holiday
      // actual = 실제 발표치. 발표 전에는 빈칸입니다.
      // 이게 있어야 '예상치를 밑돌았다' 같은 이야기를 쓸 수 있습니다.
      actual: String(x.actual ?? '').trim(),
      forecast: String(x.forecast || '').trim(),
      previous: String(x.previous || '').trim(),
      day: k.day, time: k.time, dow: k.dow, ms: k.ms,
    })
  }
  // ── 실제 발표치 보관 ─────────────────────────────────
  //  이번에 들어온 것 중 실제치가 찍힌 것을 쌓아 두고,
  //  피드에서 사라진 지난 며칠치를 도로 꺼내 붙입니다.
  try {
    const sql = await getSql()
    const r = await sql`SELECT value FROM screener_settings WHERE key = ${ACT_KEY}`
    const store = (r[0]?.value && typeof r[0].value === 'object') ? r[0].value : {}

    for (const x of items) {
      if (!x.actual) continue
      store[`${x.day}|${x.code}|${x.titleEn || x.title}`] = {
        nation: x.nation, code: x.code, title: x.title, titleEn: x.titleEn,
        impact: x.impact, day: x.day, time: x.time, dow: x.dow, ms: x.ms,
        actual: x.actual, forecast: x.forecast, previous: x.previous,
      }
    }
    // 오래된 것 버리기
    const cut = Date.now() - ACT_DAYS * 86400000
    const keep = {}
    for (const [k, v] of Object.entries(store)) {
      if (new Date(`${v.day}T00:00:00Z`).getTime() >= cut) keep[k] = v
    }
    // 이번 피드에 없는 날짜의 발표치를 되살립니다
    const have = new Set(items.map((x) => `${x.day}|${x.code}|${x.titleEn || x.title}`))
    for (const [k, v] of Object.entries(keep)) if (!have.has(k)) items.push(v)

    const json = JSON.stringify(keep)
    await sql`
      INSERT INTO screener_settings (key, value, updated_at)
      VALUES (${ACT_KEY}, ${json}::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = ${json}::jsonb, updated_at = now()`
  } catch (e) {
    errors.push(`발표치 보관: ${e?.message || e}`)
  }

  // 한국 일정: 규칙으로 만든 것 + 관리자가 직접 넣은 것.
  //  같은 날 같은 이름이면 관리자 입력이 이깁니다 (실제 공지가 우선).
  const manual = await koreaItems()
  const taken = new Set(manual.map((x) => `${x.day}|${x.title}`))
  for (const x of krSchedule(aroundMonths())) {
    if (!taken.has(`${x.day}|${x.title}`)) items.push(x)
  }
  items.push(...manual)
  items.sort((a, b) => a.ms - b.ms)

  const now = new Date(Date.now() + 9 * 3600 * 1000)
  const p = (n) => String(n).padStart(2, '0')
  const today = `${now.getUTCFullYear()}-${p(now.getUTCMonth() + 1)}-${p(now.getUTCDate())}`

  return { v: CACHE_VER, today, items, errors }
}

export async function GET() {
  let sql = null
  try { sql = await getSql(); await ensureSettings(sql) } catch { sql = null }

  if (sql) {
    try {
      const r = await sql`SELECT value, updated_at FROM screener_settings WHERE key = 'calendar'`
      if (r.length && r[0].value?.v === CACHE_VER
          && Date.now() - new Date(r[0].updated_at).getTime() < TTL)
        return NextResponse.json({ ok: true, cached: true, ...r[0].value },
          { headers: { 'content-type': 'application/json; charset=utf-8' } })
    } catch { /* 저장된 값이 없으면 새로 받습니다 */ }
  }

  let data
  try { data = await build() } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e), items: [] },
      { headers: { 'content-type': 'application/json; charset=utf-8' } })
  }

  if (sql) {
    try {
      const json = JSON.stringify(data)
      await sql`
        INSERT INTO screener_settings (key, value, updated_at)
        VALUES ('calendar', ${json}::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = ${json}::jsonb, updated_at = now()`
    } catch { /* 저장 실패해도 화면은 보여줍니다 */ }
  }
  return NextResponse.json({ ok: true, cached: false, ...data },
    { headers: { 'content-type': 'application/json; charset=utf-8' } })
}
