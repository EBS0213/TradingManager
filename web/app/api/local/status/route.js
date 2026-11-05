import {getSql} from '@/lib/db'
import {readJson,dataRoot} from '@/lib/local-market.mjs'
import path from 'node:path'
export const dynamic='force-dynamic'
export async function GET(){
 if(process.env.TM26_LOCAL_ONLY!=='1')return new Response(null,{status:404})
 try{
  const sql=await getSql();await sql`SELECT 1 AS ready`
  const collection=await readJson(path.join(dataRoot(),'us-collection-status.json'))
  return Response.json({ok:true,mode:'local',database:'ready',collection},{headers:{'Cache-Control':'no-store'}})
 }catch{return Response.json({ok:false,database:'unavailable'},{status:503})}
}
