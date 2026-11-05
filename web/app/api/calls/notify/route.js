import {getSql} from '@/lib/db'
import {ensureCallArchive} from '@/lib/terminal/call-archive'
import {ensureCallAlerts,callAlertDispatcher} from '@/lib/terminal/call-alerts'

export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=60
const json=(value,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}})
function allowed(request){return Boolean(process.env.SCREENER_KEY)&&request.headers.get('x-screener-key')===process.env.SCREENER_KEY}

export async function GET(request){
  if(!allowed(request))return json({ok:false,error:'권한이 없습니다.'},401)
  const sql=await getSql();await ensureCallAlerts(sql)
  const counts=await sql`SELECT status,count(*)::int AS total FROM conference_call_alerts GROUP BY status`
  const rules=await sql`SELECT value FROM screener_settings WHERE key='conference_call_telegram_rules'`
  return json({ok:true,rulesConfigured:rules[0]?.value?.enabled===true,counts})
}

export async function POST(request){
  if(!allowed(request))return json({ok:false,error:'권한이 없습니다.'},401)
  let body;try{body=await request.json()}catch{return json({ok:false,error:'본문이 올바르지 않습니다.'},400)}
  const sql=await getSql();await ensureCallAlerts(sql)
  const dispatcher=callAlertDispatcher(sql)
  if(body.action==='configure'){
    const rules=body.rules
    if(rules?.kind!=='symbols'||!Array.isArray(rules.symbols)||!rules.symbols.length
      ||rules.symbols.some(code=>typeof code!=='string'||!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(code)))
      return json({ok:false,error:'기존 발송 대상 조건을 명시해야 합니다.'},422)
    const value=JSON.stringify({enabled:rules.enabled===true,kind:'symbols',symbols:[...new Set(rules.symbols)]})
    await sql`INSERT INTO screener_settings(key,value,updated_at) VALUES('conference_call_telegram_rules',${value}::jsonb,now())
      ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`
    return json({ok:true,configured:true,enabled:rules.enabled===true})
  }
  if(body.action==='backfill'){
    await ensureCallArchive(sql)
    const rows=await sql`SELECT payload FROM conference_call_archive
      WHERE payload->'pipeline'->>'id'='foolcalls-codex-v1' AND updated_at>now()-interval '24 hours'`
    return json({ok:true,...await dispatcher.enqueue(rows.map(row=>row.payload))})
  }
  if(body.action==='flush')return json({ok:true,...await dispatcher.flush()})
  return json({ok:false,error:'지원하지 않는 작업입니다.'},400)
}
