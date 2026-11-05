import {db,json,sessionRow} from '@/lib/training/api'
export const runtime='nodejs';export const dynamic='force-dynamic'
export async function GET(){try{const sql=await db();const rows=await sql`SELECT nickname,return_pct,correct,created_at,payload FROM (SELECT *,row_number() OVER(PARTITION BY owner ORDER BY return_pct DESC,created_at ASC,id ASC) AS best FROM tm_training_sessions WHERE eligible=true) ranked WHERE best=1 ORDER BY return_pct DESC,created_at ASC LIMIT 50`;return json({scores:rows.map(sessionRow)})}catch{return json({error:'스코어보드를 불러오지 못했습니다.'},503)}}
