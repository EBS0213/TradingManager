import {getSql} from '@/lib/db'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET() {
  try{
    const sql=await getSql(),rows=await sql`SELECT value FROM screener_settings WHERE key='terminal_auto_data_status_v1'`
    return Response.json({status:rows[0]?.value||null},{headers:{'Cache-Control':'no-store'}})
  }catch{return Response.json({status:null},{headers:{'Cache-Control':'no-store'}})}
}
