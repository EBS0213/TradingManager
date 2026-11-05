import crypto from 'node:crypto'
import {getSql} from '@/lib/db'
import {ensureTables,hashPassword,setSession} from '@/lib/auth'
import {getLocalOwner,isLocalOwnerRequest} from '@/lib/local-owner.mjs'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function POST(request) {
  if(process.env.TM26_LOCAL_ONLY!=='1')return new Response(null,{status:404})
  if(!isLocalOwnerRequest(request.headers))return new Response(null,{status:403})
  const key=process.env.TM26_LOCAL_TOKEN||'',got=request.headers.get('x-local-launch-token')||''
  if(key.length<32||got.length!==key.length||!crypto.timingSafeEqual(Buffer.from(got),Buffer.from(key)))return new Response(null,{status:401})
  const sql=await getSql();await ensureTables(sql)
  const owner=await getLocalOwner(sql,()=>hashPassword(crypto.randomBytes(32).toString('hex')))
  await setSession(owner.id)
  return Response.json({ok:true},{headers:{'Cache-Control':'no-store'}})
}
