import {currentUser} from '@/lib/auth'
import {requestOrigin} from '@/lib/request-security.mjs'
import crypto from 'node:crypto'
import {store,online,cleanup,quota} from '@/lib/chat/store'
import {hash,parseQuestion,sessionId,publicJob} from '@/lib/chat/core.mjs'
import {readBody,json} from '@/lib/terminal/http'
export const runtime='nodejs'
export const dynamic='force-dynamic'
async function identity(request){
 const user=await currentUser(), session=sessionId(request)
 return {user,owner:user?hash('account:'+user.id):session?hash(session):null}
}
export async function GET(request){
 try{
 const sql=await store(), {user,owner}=await identity(request), params=new URL(request.url).searchParams, id=params.get('id')
 if(id){
  if(!owner||! /^[a-f0-9-]{36}$/.test(id))return json({error:'질문을 찾을 수 없습니다.'},404)
  const rows=await sql`SELECT id,status,answer,error,lease_until,created_at FROM tm_chat_job WHERE id=${id} AND owner=${owner} AND (user_id IS NOT NULL OR created_at>now()-interval '24 hours')`
  if(!rows.length)return json({error:'질문을 찾을 수 없습니다.'},404)
  const row=rows[0]
  if((row.status==='running'&&Date.parse(row.lease_until)<Date.now())||(row.status==='queued'&&Date.parse(row.created_at)<Date.now()-1200000))return json({id,status:'error',error:'응답 시간이 초과되었습니다. 다시 질문해주세요.'})
  return json(publicJob(row))
 }
 let history
 if(params.get('history')==='1'&&owner){
  await cleanup(sql)
  const before=params.get('before')
  if(before&&!/^[a-f0-9-]{36}$/.test(before))return json({error:'잘못된 기록 요청입니다.'},400)
  const rows=before?await sql`SELECT id,question,answer,status,error,created_at FROM tm_chat_job WHERE owner=${owner} AND (user_id IS NOT NULL OR created_at>now()-interval '24 hours') AND (created_at,id)<(SELECT created_at,id FROM tm_chat_job WHERE id=${before} AND owner=${owner}) ORDER BY created_at DESC,id DESC LIMIT 51`:await sql`SELECT id,question,answer,status,error,created_at FROM tm_chat_job WHERE owner=${owner} AND (user_id IS NOT NULL OR created_at>now()-interval '24 hours') ORDER BY created_at DESC,id DESC LIMIT 51`
  const page=rows.slice(0,50)
  history={jobs:page.reverse(),nextCursor:rows.length>50?page[0].id:null}
 }
 const res=json({online:await online(sql),viewer:owner,authenticated:!!user,retentionHours:user?null:24,...history})
 if(!owner)res.headers.set('Set-Cookie',`tm_chat=${crypto.randomBytes(32).toString('hex')}; HttpOnly; SameSite=Strict; Path=/api/chat; Max-Age=86400${new URL(request.url).protocol==='https:'?'; Secure':''}`)
 return res
 }catch{ return json({error:'챗봇 연결을 확인하고 있습니다.',online:false},503)}
}
export async function POST(request){
 if(request.headers.get('origin')!==requestOrigin(request))return json({error:'허용되지 않은 요청입니다.'},403)
 let user,owner;try{({user,owner}=await identity(request))}catch{return json({error:'계정을 확인하지 못했습니다. 다시 시도해주세요.'},503)}
 if(!owner)return json({error:'챗봇을 다시 열어주세요.'},401)
 let input;try{input=parseQuestion(await readBody(request,8192))}catch(e){return json({error:e.message},400)}
 try{
 const sql=await store();await cleanup(sql)
 if(!await online(sql))return json({error:'현재 AI가 오프라인입니다. 잠시 후 다시 이용해주세요.'},503)
 const active=await sql`SELECT id FROM tm_chat_job WHERE owner=${owner} AND status IN ('queued','running') LIMIT 1`
 if(active.length)return json({error:'이전 질문에 답변 중입니다.',id:active[0].id},409)
 const ip=request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()||'unknown'
 const fingerprint=crypto.createHmac('sha256',process.env.AUTH_SECRET||'chat-quota').update(ip).digest('hex')
 const hour=Math.floor(Date.now()/3600000)
 if(!await quota(sql,`ip:${fingerprint}:${hour}`,12)||!await quota(sql,`session:${owner}:${hour}`,6))return json({error:'잠시 쉬었다가 질문해주세요. 시간당 질문 한도에 도달했습니다.'},429)
 if(user){
  const previous=await sql`SELECT question,answer FROM tm_chat_job WHERE owner=${owner} AND status='done' ORDER BY created_at DESC,id DESC LIMIT 2`
  input.history=previous.reverse().flatMap(j=>[{role:'user',content:j.question.slice(0,1000)},{role:'assistant',content:j.answer.slice(0,1000)}])
 }
 const id=crypto.randomUUID()
 for(let slot=0;slot<3;slot++){
  try{await sql`INSERT INTO tm_chat_job(id,owner,user_id,question,context,slot) VALUES(${id},${owner},${user?.id??null},${input.question},${JSON.stringify({history:input.history,page:input.page})}::jsonb,${slot})`;return json({id,status:'queued'},202)}
  catch(e){if(e.code!=='23505')throw e}
 }
 return json({error:'현재 질문이 몰려 있습니다. 잠시 후 다시 질문해주세요.'},429)
 }catch{return json({error:'질문을 접수하지 못했습니다. 잠시 후 다시 시도해주세요.'},503)}
}
