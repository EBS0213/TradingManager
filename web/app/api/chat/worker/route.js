import crypto from 'node:crypto'
import {store,worker,cleanup} from '@/lib/chat/store'
import {readBody,json} from '@/lib/terminal/http'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request){
 try{
 const sql=await store(),who=await worker(sql,request)
 if(!who)return json({error:'Unauthorized'},401)
 const body=await readBody(request,20000)
 await sql`UPDATE tm_chat_worker SET seen_at=now() WHERE id=${who}`
 if(body.action==='heartbeat'){
  if(/^[a-f0-9-]{36}$/.test(body.lease||''))await sql`UPDATE tm_chat_job SET lease_until=now()+interval '12 minutes' WHERE lease=${body.lease} AND status='running'`
  return json({ok:true})
 }
 if(body.action==='claim'){
  await cleanup(sql)
  const lease=crypto.randomUUID()
  const rows=await sql`UPDATE tm_chat_job SET status='running',lease=${lease},lease_until=now()+interval '12 minutes' WHERE id=(SELECT id FROM tm_chat_job WHERE status='queued' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING id,question,context,lease`
  return json({job:rows[0]||null})
 }
 if(body.action==='complete'){
  if(!/^[a-f0-9-]{36}$/.test(body.id||'')||!/^[a-f0-9-]{36}$/.test(body.lease||''))return json({error:'Invalid job'},400)
  const answer=typeof body.answer==='string'?body.answer.trim().slice(0,6000):''
  const error=body.error?'AI 응답을 만들지 못했습니다. 질문을 짧게 바꾸어 다시 시도해주세요.':null
  if(!answer&&!error)return json({error:'Empty answer'},400)
  const rows=await sql`UPDATE tm_chat_job SET status=${error?'error':'done'},answer=${error?null:answer},error=${error},finished_at=now() WHERE id=${body.id} AND lease=${body.lease} AND status='running' AND lease_until>now() RETURNING id`
  return json({ok:rows.length>0},rows.length?200:409)
 }
 return json({error:'Invalid action'},400)
 }catch{return json({error:'Worker request failed'},503)}
}
