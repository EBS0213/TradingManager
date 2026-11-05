import {randomUUID} from 'node:crypto'
import {currentUser,db,json,sameOrigin,readBody,cases,stocksFor,validateCompleted,sessionRow} from '@/lib/training/api'
export const runtime='nodejs';export const dynamic='force-dynamic'
export async function GET(req){const user=await currentUser();if(!user)return json({error:'로그인이 필요합니다.'},401);try{const sql=await db(),owner=String(user.id),id=new URL(req.url).searchParams.get('id');if(id){const rows=await sql`SELECT payload FROM tm_training_sessions WHERE id=${id} AND owner=${owner}`;return rows[0]?json({session:rows[0].payload}):json({error:'기록을 찾을 수 없습니다.'},404)}const rows=await sql`SELECT * FROM tm_training_sessions WHERE owner=${owner} ORDER BY created_at DESC LIMIT 100`;return json({sessions:rows.map(sessionRow)})}catch{return json({error:'기록을 불러오지 못했습니다.'},503)}}
export async function POST(req){if(!sameOrigin(req))return json({error:'허용되지 않은 요청입니다.'},403);const user=await currentUser();if(!user)return json({error:'로그인이 필요합니다.'},401);try{
 const input=await readBody(req),s=input.session,localId=String(s?.runId??s?.id??''),name=String(input.nickname??user.nickname??'트레이더').trim();if(!localId||localId.length>100||!name||name.length>24)return json({error:'세션 또는 닉네임이 올바르지 않습니다.'},400)
 const sql=await db(),owner=String(user.id),runs=s.runId?await sql`SELECT owner,settings,ordering FROM tm_training_runs WHERE id=${s.runId}`:[],run=runs[0];if(s.runId&&!run)return json({error:'세션을 찾을 수 없습니다.'},400);if(run?.owner&&run.owner!==owner)return json({error:'다른 계정의 세션입니다.'},403)
 const all=await cases(),stocks=await stocksFor(s.order,all),verified=run?{...run,settings:JSON.stringify(run.settings),ordering:JSON.stringify(run.ordering)}:null
 // JSONB key order differs from request serialization: compare values before canonical validation.
 if(run){const keys=Object.keys(run.settings);if(keys.length!==Object.keys(s.settings).length||keys.some(k=>run.settings[k]!==s.settings[k]))return json({error:'세션 정보가 일치하지 않습니다.'},400);verified.settings=JSON.stringify(s.settings)}
 const result=validateCompleted(s,all,stocks,verified),eligible=run?.owner===owner
 const inserted=await sql`INSERT INTO tm_training_sessions(id,owner,local_id,nickname,return_pct,correct,eligible,payload) VALUES(${randomUUID()},${owner},${localId},${name},${result.returnPct},${result.correct},${eligible},${JSON.stringify(result.payload)}::jsonb) ON CONFLICT(owner,local_id) DO NOTHING RETURNING id`
 const rows=await sql`SELECT id,return_pct,correct,eligible FROM tm_training_sessions WHERE owner=${owner} AND local_id=${localId}`;return json({saved:rows[0],duplicate:!inserted.length},inserted.length?201:200)
 }catch(e){console.error('[training/sessions]',e.message);return json({error:/기록|세션|닉네임|문제|관망/.test(e.message)?e.message:'기록을 저장하지 못했습니다.'},400)}}
