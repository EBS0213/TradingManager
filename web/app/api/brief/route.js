// ============================================================
//  뉴스 브리핑
//  · GET  /api/brief            → 사이트에 보여줄 지난 브리핑 목록 (누구나)
//  · GET  /api/brief?run=am|mid|pm → 브리핑을 만들어 저장하고 텔레그램으로 보냅니다
//                                 (am 08:00 장전 · mid 12:00 장중 · close 16:30 장마감 · pm 23:00 해외)
//                                 (x-screener-key 또는 관리자만)
//  · ?preview=1 을 붙이면 보내지 않고 글만 보여줍니다.
//  · ?test=1    을 붙이면 '작동 확인용' 이라고 글 앞에 밝혀 둡니다.
//  · ?purge=all 또는 ?purge=YYYY-MM-DD 로 저장된 브리핑을 지웁니다.
// ============================================================
import { NextResponse } from 'next/server'
import { currentUser } from '@/lib/auth'
import { ensureSettings } from '@/lib/settings'
import { getSql } from '@/lib/db'
import { sendTelegram, todayKst } from '@/lib/brief'
import { buildNewsBrief, saveBrief, readBriefs, purgeBriefs, gatherFacts, briefPrompt, assembleBrief } from '@/lib/newsbrief'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// 재료를 다 모으고 + 웹 검색까지 하고 + 글까지 쓰는 데 60초는 빠듯합니다.
// (2026-08 확인: Hobby 요금제도 300초까지 됩니다. 요금제를 올릴 필요가 없었습니다.)
export const maxDuration = 300

const UTF8 = { 'content-type': 'application/json; charset=utf-8' }
const json = (o, init) => NextResponse.json(o, { ...init, headers: UTF8 })

function origin(request) {
  return (process.env.SITE_URL || new URL(request.url).origin).replace(/\/$/, '')
}

async function allowed(request) {
  const key = request.headers.get('x-screener-key') || ''
  if (process.env.SCREENER_KEY && key === process.env.SCREENER_KEY) return true
  const auth = request.headers.get('authorization') || ''
  if (process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`) return true
  try { const u = await currentUser(); if (u && u.role === 'admin') return true } catch { /* 손님 */ }
  return false
}

async function run(request) {
  const sp = new URL(request.url).searchParams
  const slot = sp.get('run')

  // ── 텔레그램 채널이 잘 읽히는지 확인용 (관리자만)
  if (sp.get('debug') === 'tg') {
    if (!await allowed(request))
      return json({ ok: false, error: '권한이 없습니다.' }, { status: 403 })
    const { fetchTgFeeds, TG_CHANNELS } = await import('@/lib/tgfeed')
    const r = await fetchTgFeeds({ perChannel: 5 })
    return json({ ok: true, channels: TG_CHANNELS.map((c) => c.id), ...r })
  }

  // ── 거시 지표가 잘 읽히는지 확인용 (관리자만)
  if (sp.get('debug') === 'macro') {
    if (!await allowed(request))
      return json({ ok: false, error: '권한이 없습니다.' }, { status: 403 })
    const { fetchMacro } = await import('@/lib/macro')
    const m = await fetchMacro()
    return json({ ok: true, count: m.items.length, ...m })
  }

  // ── 지난 브리핑 지우기 (관리자만)
  //   ?purge=2026-08-18  → 8월 18일보다 앞선 것을 전부 버립니다
  //   ?purge=all         → 전부 버립니다
  if (sp.get('purge')) {
    if (!await allowed(request))
      return json({ ok: false, error: '권한이 없습니다.' }, { status: 403 })
    const v = sp.get('purge')
    const before = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null
    if (!before && v !== 'all')
      return json({ ok: false, error: 'purge 는 YYYY-MM-DD 또는 all' }, { status: 400 })
    try { const sql = await getSql(); await ensureSettings(sql) } catch { /* 없어도 됩니다 */ }
    return json({ ok: true, ...(await purgeBriefs(before)) })
  }

  // ── 재료만 보기 (관리자만) — 글이 이상할 때 무엇을 보고 썼는지 확인
  if (sp.get('debug') === 'facts') {
    if (!await allowed(request))
      return json({ ok: false, error: '권한이 없습니다.' }, { status: 403 })
    const { gatherFacts } = await import('@/lib/newsbrief')
    return json({ ok: true, facts: await gatherFacts(origin(request), sp.get('run') || 'am') })
  }

  // ── 읽기 (누구나)
  if (!slot) {
    try { const sql = await getSql(); await ensureSettings(sql) } catch { /* 없어도 됩니다 */ }
    const items = await readBriefs()
    const dashboard = sp.get('view') === 'dashboard'
    const visibleItems = dashboard ? items.slice(0, 24).map(({ day, slot, at, title, text, writer }) => ({ day, slot, at, title, text, writer })) : items
    // 중간 서버(CDN)에 담아 두는 시간.
    //  전에는 5분 + 낡은 것 1시간 허용이었는데, 그러면 정각에 새 브리핑이
    //  올라와도 한 시간 가까이 옛 목록이 그대로 보였습니다(12시 브리핑이
    //  만들어졌는데 화면에 없던 일). 하루 네 번뿐이라 짧게 잡아도 됩니다.
    return NextResponse.json({ ok: true, items: visibleItems }, { headers: {
      ...UTF8,
      'cache-control': 'public, s-maxage=60, stale-while-revalidate=120',
    } })
  }

  // ── 만들기 (권한 필요)
  if (!['am', 'mid', 'pm', 'close'].includes(slot))
    return json({ ok: false, error: 'run 은 am · mid · pm 중 하나여야 합니다' }, { status: 400 })
  if (!await allowed(request))
    return json({ ok: false, error: '권한이 없습니다.' }, { status: 403 })

  /* ── 맥미니가 쓰는 길 (2026-10-05) ───────────────────────────────
     ① ?prepare=1  — 재료를 모아 지시문과 함께 내줍니다. 재료는 저장해 둡니다.
     ② POST ?save=1 {text} — 맥미니(Claude Code)가 쓴 글을 ①의 재료와 묶어 저장합니다.
     사이트의 Anthropic API 크레딧을 쓰지 않습니다. */
  const PKEY = `brief_pending_${slot}`
  if (sp.get('prepare') === '1') {
    const facts = await gatherFacts(origin(request), slot)
    try {
      const sql = await getSql(); await ensureSettings(sql)
      const v = JSON.stringify({ at: Date.now(), facts })
      await sql`INSERT INTO screener_settings (key, value, updated_at) VALUES (${PKEY}, ${v}::jsonb, now())
                ON CONFLICT (key) DO UPDATE SET value = ${v}::jsonb, updated_at = now()`
    } catch (e) { return json({ ok: false, error: `재료를 저장하지 못했습니다: ${e?.message || e}` }, { status: 500 }) }
    return json({ ok: true, slot, day: facts.day, krClosed: facts.krClosed || null, ...briefPrompt(facts) })
  }
  if (sp.get('save') === '1' && request.method === 'POST') {
    let text = ''
    try { text = String((await request.json())?.text || '').trim() } catch { /* 아래에서 거릅니다 */ }
    if (text.length < 200) return json({ ok: false, error: '글이 너무 짧습니다' }, { status: 400 })
    let facts = null
    try {
      const sql = await getSql(); await ensureSettings(sql)
      const r = await sql`SELECT value FROM screener_settings WHERE key = ${PKEY}`
      facts = r[0]?.value?.facts || null
    } catch { /* 아래에서 거릅니다 */ }
    if (!facts) return json({ ok: false, error: '먼저 ?prepare=1 로 재료를 받아야 합니다' }, { status: 409 })
    const brief = assembleBrief(slot, facts, text, 'ai', { model: 'gpt-6.1-sol', provider: 'local-codex' })
    const saved = await saveBrief(brief)
    return json({ ok: true, saved, slot, day: brief.day, length: text.length })
  }

  const preview = sp.get('preview') === '1'
  const force = sp.get('force') === '1'
  // 아침·오후 브리핑은 사이트에만 올립니다.
  // 텔레그램은 오후 4시 30분 마감 브리핑 하나만 나갑니다 (?send=1 을 붙이면 이것도 보냅니다).
  const send = sp.get('send') === '1'

  // 주말에는 보내지 않습니다 (장이 없으니까요)
  const t = todayKst()
  if (!force && (t.dow === 0 || t.dow === 6))
    return json({ ok: true, skipped: '주말' })

  // 시험용 — 주소로 모델과 검색을 바꿔볼 수 있습니다.
  //  예) ?run=am&preview=1&force=1&model=claude-opus-5&search=1
  const opt = { preview, send }
  if (sp.get('model')) opt.model = sp.get('model')
  if (sp.get('search')) opt.search = sp.get('search') === '1'

  let brief
  try { brief = await buildNewsBrief(origin(request), slot, opt) }
  catch (e) {
    return json({ ok: false, error: `글을 만들지 못했습니다: ${e?.message || e}` }, { status: 500 })
  }

  if (brief.writer === 'queued') return json({ ok: true, queued: true, job: brief.job,
    statusUrl: `/api/ai/local?id=${brief.job.id}`, message: '맥미니 Codex 처리 대기 중입니다' }, { status: 202 })

  if (preview)
    return new NextResponse(brief.text, { headers: { 'content-type': 'text/plain; charset=utf-8' } })

  // ?test=1 — 작동 확인용으로 지금 만든 글임을 글 맨 앞에 밝혀 둡니다.
  //  예정 시각에 자동으로 올라온 글과 헷갈리지 않게 하기 위한 것입니다.
  //  (예정된 시각의 자동 실행이 같은 자리를 덮어쓰므로 따로 지울 필요는 없습니다)
  if (sp.get('test') === '1') {
    const when = { am: '오전 8시 장전', mid: '정오 12시 장중', pm: '밤 11시 해외' }[slot] || ''
    brief.text = `<b>※ 작동 확인용</b> — 지금 손으로 만든 글입니다. `
      + `예정된 ${when} 브리핑이 아닙니다. ${when} 브리핑은 그 시각에 따로 올라옵니다.\n\n`
      + brief.text
  }

  //  AI 가 쓰지 못한 예비 틀(숫자와 텔레그램 채널 이름만 나열한 글)은 **저장도 발송도 하지 않습니다**
  //  (2026-10-05 사용자 지시). 크레딧·사용량이 떨어진 날 채널 이름만 줄줄이 실린 글이 나갔습니다.
  if (brief.writer !== 'ai')
    return json({ ok: true, saved: false, sent: false, skipped: 'AI 글이 아니어서 올리지 않습니다',
      errors: brief.errors })

  try { const sql = await getSql(); await ensureSettings(sql) } catch { /* 저장 못 해도 발송은 합니다 */ }
  const saved = await saveBrief(brief)

  if (!send)
    return json({ ok: true, saved, sent: false, writer: brief.writer,
      meta: brief.meta, errors: brief.errors })

  try { await sendTelegram(`<b>📰 TM2026 ${brief.title}</b>\n\n${brief.text}`) }
  catch (e) {
    return json({ ok: false, saved, error: String(e?.message || e) }, { status: 502 })
  }
  return json({ ok: true, saved, sent: true, writer: brief.writer })
}

export async function GET(request) { return run(request) }
export async function POST(request) { return run(request) }
