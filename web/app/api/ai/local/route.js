import { NextResponse } from 'next/server'
import { aiSql, enqueueAI, claimAI, finishAI, failAI, localAIStatus } from '@/lib/local-ai'
import { bofaResult, briefText } from '@/lib/local-ai-validation.mjs'
import { assembleBrief } from '@/lib/newsbrief'
import { sendTelegram, todayKst } from '@/lib/brief'
import { randomUUID } from 'node:crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
const json = (data, status = 200) => NextResponse.json(data, { status, headers: { 'cache-control': 'no-store' } })
const allowed = request => Boolean(process.env.SCREENER_KEY)
  && request.headers.get('x-screener-key') === process.env.SCREENER_KEY
const uuid = x => typeof x === 'string' && /^[0-9a-f-]{36}$/i.test(x)

export async function GET(request) {
  if (!allowed(request)) return json({ ok: false }, 401)
  const id = new URL(request.url).searchParams.get('id')
  if (id) {
    if (!uuid(id)) return json({ ok: false }, 400)
    const sql = await aiSql()
    const job = (await sql`SELECT id,kind,status,result,error FROM tm_local_ai_job WHERE id=${id}::uuid`)[0]
    return json({ ok: true, job: job || null })
  }
  return json({ ok: true, ...await localAIStatus() })
}

export async function POST(request) {
  if (!allowed(request)) return json({ ok: false }, 401)
  let body
  try { body = await request.json() } catch { return json({ ok: false }, 400) }
  if (body.action === 'claim') return json({ ok: true, job: await claimAI() })
  // 게시·지표 변경 없는 연결 시험. 작업 지시문은 클라이언트로부터 받지 않는다.
  if (body.action === 'probe') return json({ ok: true, job: await enqueueAI('probe', {}, `probe:${randomUUID()}`) })
  if (!uuid(body.id) || !uuid(body.token)) return json({ ok: false }, 400)
  if (body.action === 'fail') return json({ ok: Boolean(await failAI(body.id, body.token, body.quota === true)) })
  if (body.action !== 'complete') return json({ ok: false }, 400)
  const sql = await aiSql()
  const job = (await sql`SELECT * FROM tm_local_ai_job WHERE id=${body.id}::uuid AND token=${body.token}::uuid`)[0]
  if (!job) return json({ ok: false, error: '작업 소유권 불일치' }, 409)
  if (job.status === 'done') return json({ ok: true, duplicate: true })
  let target = null, payload = null, result, text = null
  try {
    if (job.kind === 'bofa') {
      const hit = bofaResult(body.result)
      result = { found: Boolean(hit), value: hit }
      if (hit) { target = 'bofa_bb'; payload = hit }
    } else if (job.kind === 'brief') {
      if (job.input.facts.day !== todayKst().day) throw new Error('지난 날짜의 브리핑은 저장하지 않습니다')
      text = briefText(body.result)
      const brief = assembleBrief(job.input.slot, job.input.facts, text, 'ai', { model: 'gpt-6.1-sol', provider: 'local-codex' })
      result = { saved: !job.input.preview, preview: job.input.preview ? brief.text : undefined }
      if (!job.input.preview) { target = 'brief_log'; payload = { items: [brief] } }
    } else if (job.kind === 'probe') {
      if (body.result?.text?.trim() !== 'READY') throw new Error('연결 시험 응답 불일치')
      result = { checked: true, model: 'gpt-6-luna' }
    } else throw new Error('지원하지 않는 작업')
  } catch (e) { return json({ ok: false, error: String(e.message) }, 422) }
  if (!await finishAI(body.id, body.token, result, target, payload))
    return json({ ok: false, error: '실행 기한 만료 또는 이미 완료됨' }, 409)
  let notificationError = null
  if (job.kind === 'brief' && job.input.send && !job.input.preview) {
    try { await sendTelegram(text) } catch { notificationError = '글은 저장했으나 텔레그램 발송 실패' }
  }
  return json({ ok: true, result, notificationError })
}
