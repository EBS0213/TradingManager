// ============================================================
//  컨퍼런스콜 — 실적 발표 자료를 한국어로 요약하고 전망까지 붙여 둔 곳
//
//  GET  /api/calls            최근 60건.
//       /api/calls?archive=1&page=1&q=NVDA  전체 기록 검색·페이지 이동
//  POST /api/calls            헤더 x-screener-key. 맥이 만들어 밀어 넣습니다.
//                             본문 { items: [ {...}, ... ] }
//
//  documents에는 수집한 영문 전문과 같은 원문에서 만든 한국어 전문을 보관합니다.
//  목록에서는 전문을 빼고, 선택한 콜만 /api/calls/transcript에서 읽습니다.
// ============================================================
import { NextResponse } from 'next/server'
import { getSql } from '@/lib/db'
import { ensureCallArchive } from '@/lib/terminal/call-archive'
import { normalizeTranscriptSource, fiscalPeriod, retainTranscriptSource } from '@/lib/terminal/call-transcript-data.mjs'
import { normalizeCallDocuments, mergeCallDocuments } from '@/lib/terminal/call-documents.mjs'
import { enqueueCallAlerts } from '@/lib/terminal/call-alerts'
import { callCatalog } from '@/lib/terminal/call-catalog.mjs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UTF8 = { 'content-type': 'application/json; charset=utf-8' }
const json = (o, init) => NextResponse.json(o, { ...init, headers: {...UTF8,'cache-control':'no-store',...init?.headers} })

function keyOk(request) {
  const k = request.headers.get('x-screener-key') || ''
  return Boolean(process.env.SCREENER_KEY) && k === process.env.SCREENER_KEY
}

const 글 = (v, n) => String(v ?? '').trim().slice(0, n)

/** 밀려 들어온 한 건을 쓸 만한 모양으로 다듬습니다 */
function 다듬기(x) {
  const code = 글(x?.code, 20).toUpperCase()
  const name = 글(x?.name, 80)
  if (!code || !name) return null
  const transcriptSource = normalizeTranscriptSource(x?.transcriptSource)
  const period = fiscalPeriod(x?.quarter)
  const documents = normalizeCallDocuments(x?.documents, {code, quarter: x?.quarter})
  let pipeline = null
  if (['foolcalls-codex-v1', 'local-transcript-v1'].includes(x?.pipeline?.id)) {
    const local = x.pipeline.id === 'local-transcript-v1'
    if (!documents?.translation || !(local ? /^(Codex|Claude Code) · / : /^Codex · /).test(String(documents.translation.model))
        || !String(x?.summary || '').trim() || !String(x?.call || '').trim()
        || x?.transcriptSource?.collector !== (local ? 'local-public' : 'foolcalls')) {
      throw new Error('원문·한국어 전문·정리본과 실제 작성 AI 정보가 모두 필요합니다.')
    }
    pipeline = {id:x.pipeline.id,model:글(documents.translation.model,100),
      collectedAt:글(x.pipeline.collectedAt,40),completedAt:documents.translation.generatedAt}
  }
  return {
    code,
    name,
    market: 글(x?.market, 4) === '해외' ? '해외' : (/^\d{6}$/.test(code) ? '국내' : '해외'),
    quarter: 글(x?.quarter, 20),          // 예: 2026 2분기
    date: 글(x?.date, 10),                // 발표일 YYYY-MM-DD
    sector: 글(x?.sector, 40),
    headline: 글(x?.headline, 200),       // 한 줄 요약
    summary: 글(x?.summary, 6000),        // 통화 요약 (우리가 쓴 글)
    //  콜을 따라가며 쓴 상세 해설 — 발표 내용 · 가이던스 근거 · Q&A 쟁점 (2026-10-01).
    //   요약만으로는 「그날 무슨 말을 했나」가 안 보인다는 지적에서 넣었습니다.
    //   원문 번역이 아니라 **우리가 읽고 풀어 쓴 글**입니다 (지시문/컨퍼런스콜.md 참고).
    call: 글(x?.call, 14000),
    // Only the verified public source/provenance is stored; the original is read
    // on selection through /api/calls/transcript rather than copied into this row.
    transcriptSource: transcriptSource && period?.year === transcriptSource.year && period?.quarter === transcriptSource.quarter ? transcriptSource : null,
    documents,
    pipeline,
    industry: 글(x?.industry, 4000),      // 산업 전망
    outlook: 글(x?.outlook, 4000),        // 기업 전망
    numbers: Array.isArray(x?.numbers) ? x.numbers.slice(0, 12).map((n) => ({
      k: 글(n?.k, 30), v: 글(n?.v, 40), note: 글(n?.note, 60),
    })) : [],
    sources: Array.isArray(x?.sources) ? x.sources.slice(0, 6).map((s) => ({
      label: 글(s?.label, 60), url: 글(s?.url, 400),
    })) : [],
    madeAt: new Date().toISOString(),
  }
}

export async function GET(request) {
  const q = new URL(request.url).searchParams
  const code = 글(q.get('code'), 20).toUpperCase()
  const archive = q.get('archive') === '1'
  const search = 글(q.get('q'), 80)
  const pattern = `%${search}%`
  const page = Math.min(100000, Math.max(1, Number.parseInt(q.get('page') || '1', 10) || 1))
  const limit = archive ? 30 : 60
  const offset = archive ? (page - 1) * limit : 0
  try {
    const sql = await getSql()
    await ensureCallArchive(sql)
    if (['index','detail'].includes(q.get('view'))) return await callCatalog(request,sql)
    if(q.get('export')==='1'){
      if(!keyOk(request))return json({ok:false,error:'키가 올바르지 않습니다.'},{status:401})
      const records=await sql`SELECT payload FROM conference_call_archive ORDER BY call_date DESC`
      const legacy=await sql`SELECT value FROM screener_settings WHERE key='conf_calls'`
      return json({ok:true,items:records.map(row=>row.payload),legacyItems:legacy[0]?.value?.items||[]},
        {headers:{...UTF8,'cache-control':'no-store'}})
    }
    const rows = await sql`
      SELECT payload - 'documents' AS payload, updated_at FROM conference_call_archive
      WHERE payload->'pipeline'->>'id' IN ('foolcalls-codex-v1', 'local-transcript-v1')
        AND (${code} = '' OR code = ${code})
        AND (${search} = '' OR code ILIKE ${pattern}
          OR quarter ILIKE ${pattern}
          OR payload->>'name' ILIKE ${pattern}
          OR payload->>'headline' ILIKE ${pattern})
      ORDER BY call_date DESC, updated_at DESC, code ASC
      LIMIT ${limit} OFFSET ${offset}`
    const count = archive ? await sql`
      SELECT COUNT(*)::int AS total FROM conference_call_archive
      WHERE payload->'pipeline'->>'id' IN ('foolcalls-codex-v1', 'local-transcript-v1')
        AND (${code} = '' OR code = ${code})
        AND (${search} = '' OR code ILIKE ${pattern}
          OR quarter ILIKE ${pattern}
          OR payload->>'name' ILIKE ${pattern}
          OR payload->>'headline' ILIKE ${pattern})` : null
    const total = count?.[0]?.total ?? rows.length
    const progress = await sql`SELECT value FROM screener_settings WHERE key='conf_calls_ingestion'`
    return json({ ok: true, items: rows.map(row => row.payload), updated_at: rows[0]?.updated_at || null,
      page: archive ? page : 1, pages: Math.max(1, Math.ceil(total / limit)), total,
      ingestion:progress[0]?.value||null })
  } catch {
    return json({ ok: false, error: '컨퍼런스콜 저장 자료를 불러오지 못했습니다.', items: [] }, { status: 503 })
  }
}

export async function POST(request) {
  if (!keyOk(request)) return json({ ok: false, error: '키가 올바르지 않습니다.' }, { status: 401 })

  let body
  try { body = await request.json() } catch { return json({ ok: false, error: '본문을 읽지 못했습니다' }, { status: 400 }) }
  if (body?.operation === 'progress') {
    const stage = body.stage
    if (!['collecting','translating','summarizing','waiting','complete','error'].includes(stage)
        || !/^[A-Z][A-Z0-9.\-]{0,9}$/.test(String(body.code||'')))
      return json({ok:false,error:'처리 상태가 올바르지 않습니다.'},{status:400})
    const value = JSON.stringify({code:body.code,stage,
      completed:Math.max(0,Math.min(10000,Number(body.completed)||0)),
      total:Math.max(0,Math.min(10000,Number(body.total)||0)),
      totalCalls:Math.max(0,Math.min(10000,Number(body.totalCalls)||0)),
      completedCalls:Math.max(0,Math.min(10000,Number(body.completedCalls)||0)),
      failedCalls:Math.max(0,Math.min(10000,Number(body.failedCalls)||0)),updatedAt:new Date().toISOString()})
    const sql = await getSql()
    await ensureCallArchive(sql)
    await sql`INSERT INTO screener_settings(key,value,updated_at) VALUES('conf_calls_ingestion',${value}::jsonb,now())
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`
    return json({ok:true})
  }
  let 새것
  try { 새것 = (Array.isArray(body?.items) ? body.items : []).map(다듬기).filter(Boolean) }
  catch (error) { return json({ok:false,error:error.message}, {status:422}) }
  if (!새것.length) return json({ ok: false, error: '담을 것이 없습니다' }, { status: 400 })

  const sql = await getSql()
  await ensureCallArchive(sql)
  const codes = [...new Set(새것.map(item => item.code))]
  const existing = await sql`SELECT code, quarter, payload FROM conference_call_archive WHERE code = ANY(${codes}::text[])`
  const byKey = new Map(existing.map(row => [`${row.code}|${row.quarter}`, row.payload]))
  const incoming = new Map()
  for (const item of 새것) {
    const key = `${item.code}|${item.quarter}`
    const prior = incoming.get(key) || byKey.get(key)
    if (['foolcalls-codex-v1','local-transcript-v1'].includes(prior?.pipeline?.id) && !item.pipeline)
      return json({ok:false,error:'게시된 Codex 콜은 영문·한국어 전문·정리본을 함께 갱신해야 합니다.'},{status:422})
    incoming.set(key, { ...item, transcriptSource: retainTranscriptSource(item, prior),
      documents: mergeCallDocuments(item.documents, prior?.documents, item) })
  }
  const payload = JSON.stringify([...incoming.values()])
  await sql`
    INSERT INTO conference_call_archive (code, quarter, call_date, payload, updated_at)
    SELECT item->>'code', COALESCE(item->>'quarter', ''), COALESCE(item->>'date', ''), item, now()
    FROM jsonb_array_elements(${payload}::jsonb) AS source(item)
    ON CONFLICT (code, quarter) DO UPDATE
      SET call_date = EXCLUDED.call_date, payload = EXCLUDED.payload, updated_at = now()`
  const total = await sql`SELECT COUNT(*)::int AS total FROM conference_call_archive`
  let telegram
  try { telegram=await enqueueCallAlerts(sql,[...incoming.values()]) }
  catch { telegram={pending:true,error:'알림 대기열 확인 필요'} }
  return json({ ok: true, saved: incoming.size, 담긴것: total[0].total,telegram })
}
