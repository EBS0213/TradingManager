import {once} from '@/lib/once'
import {ensureSettings} from '@/lib/settings'
import {sendTelegram} from '@/lib/brief'
import {createCallAlertDispatcher} from './call-alert-dispatcher.mjs'

export const ensureCallAlerts=once('conference-call-alerts',async sql=>{
  await ensureSettings(sql)
  await sql`CREATE TABLE IF NOT EXISTS conference_call_alerts (
    call_key TEXT PRIMARY KEY,payload JSONB NOT NULL,status TEXT NOT NULL DEFAULT 'pending',
    due_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    claimed_at TIMESTAMPTZ,sent_at TIMESTAMPTZ,message_id TEXT,note TEXT
  )`
})

export function callAlertDispatcher(sql) {
  return createCallAlertDispatcher({
    send:text=>sendTelegram(text,{signal:AbortSignal.timeout(15000)}),
    store:{
      async rules(){
        const rows=await sql`SELECT value FROM screener_settings WHERE key='conference_call_telegram_rules'`
        return rows[0]?.value||null
      },
      async enqueue(key,payload,due){
        const rows=await sql`INSERT INTO conference_call_alerts(call_key,payload,due_at)
          VALUES(${key},${JSON.stringify(payload)}::jsonb,${due.toISOString()}::timestamptz)
          ON CONFLICT(call_key) DO NOTHING RETURNING call_key`
        return rows.length>0
      },
      async ready(time){
        const rows=await sql`SELECT call_key,payload FROM conference_call_alerts
          WHERE status='pending' AND due_at<=${time.toISOString()}::timestamptz
          ORDER BY created_at LIMIT 20`
        return rows.map(row=>({key:row.call_key,payload:row.payload}))
      },
      async skip(key,reason){await sql`UPDATE conference_call_alerts SET status='skipped',note=${reason}
        WHERE call_key=${key} AND status='pending'`},
      async claim(key){
        const rows=await sql`UPDATE conference_call_alerts SET status='sending',claimed_at=now()
          WHERE call_key=${key} AND status='pending' RETURNING call_key`
        return rows.length>0
      },
      async sent(key,id){await sql`UPDATE conference_call_alerts SET status='sent',sent_at=now(),message_id=${id}
        WHERE call_key=${key} AND status='sending'`},
      async uncertain(key){await sql`UPDATE conference_call_alerts SET status='uncertain',note='발송 결과 확인 필요: 자동 중복 재발송하지 않음'
        WHERE call_key=${key} AND status='sending'`},
    },
  })
}

export async function enqueueCallAlerts(sql,items) {
  await ensureCallAlerts(sql)
  const dispatcher=callAlertDispatcher(sql)
  const queued=await dispatcher.enqueue(items)
  const delivery=await dispatcher.flush()
  return {...queued,...delivery}
}
