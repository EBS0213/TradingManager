import {currentUser,db,json,sameOrigin,readBody,guestId,cases,stocksFor} from '@/lib/training/api'
import {validateProgress} from '@/lib/training/validation.mjs'
export const runtime='nodejs';export const dynamic='force-dynamic'

export async function GET(req){
 const user=await currentUser();if(!user)return json({error:'로그인이 필요합니다.'},401)
 try{
  const sql=await db(),owner=String(user.id),id=new URL(req.url).searchParams.get('id')
  if(id){const rows=await sql`SELECT payload FROM tm_training_progress WHERE owner=${owner} AND run_id=${id}`;return rows[0]?json({session:rows[0].payload}):json({error:'저장한 진행 기록이 없습니다.'},404)}
  const rows=await sql`SELECT p.run_id,p.payload,p.updated_at FROM tm_training_progress p
    WHERE p.owner=${owner} AND NOT EXISTS(SELECT 1 FROM tm_training_sessions s WHERE s.owner=p.owner AND s.local_id=p.run_id)
    ORDER BY p.updated_at DESC LIMIT 100`
  return json({items:rows.map(r=>({id:r.run_id,updatedAt:r.updated_at,completed:Object.keys(r.payload.records||{}).length,horizonMonths:r.payload.settings.horizonMonths}))})
 }catch{return json({error:'진행 기록을 불러오지 못했습니다.'},503)}
}
export async function POST(req){
 if(!sameOrigin(req))return json({error:'허용되지 않은 요청입니다.'},403)
 const user=await currentUser();if(!user)return json({error:'로그인이 필요합니다.'},401)
 try{
  const {session}=await readBody(req),id=String(session?.runId||session?.id||''),owner=String(user.id),sql=await db()
  const rows=await sql`SELECT owner,guest,settings,ordering FROM tm_training_runs WHERE id=${id}`,run=rows[0]
  if(!run||!(run.owner===owner||(!run.owner&&run.guest&&run.guest===guestId(req))))return json({error:'본인의 세션만 저장할 수 있습니다.'},403)
  if(!session?.settings||Object.keys(run.settings).length!==Object.keys(session.settings).length||Object.keys(run.settings).some(k=>run.settings[k]!==session.settings[k]))return json({error:'세션 설정이 일치하지 않습니다.'},400)
  const all=await cases(),stocks=await stocksFor(session.order,all)
  const verified={...run,settings:JSON.stringify(session.settings),ordering:JSON.stringify(run.ordering)}
  const result=validateProgress(session,all,stocks,verified)
  result.payload.owner=owner
  await sql`INSERT INTO tm_training_progress(owner,run_id,payload) VALUES(${owner},${id},${JSON.stringify(result.payload)}::jsonb)
    ON CONFLICT(owner,run_id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now()`
  return json({saved:true,completed:result.completed})
 }catch(error){return json({error:/기록|세션|문제|관망|스탑|잔량/.test(error.message)?error.message:'진행 기록을 저장하지 못했습니다.'},400)}
}
