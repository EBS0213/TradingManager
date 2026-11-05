import {getSql} from '@/lib/db'
// A shared, atomic quota is required before any paid model call. Database failure
// fails closed rather than falling back to a per-instance counter on serverless.
export async function reserveAIRequest(userId){
  const sql=await getSql()
  await sql`CREATE TABLE IF NOT EXISTS tm_terminal_ai_quota (
    user_id INTEGER NOT NULL, day DATE NOT NULL, used INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(user_id,day))`
  const rows=await sql`INSERT INTO tm_terminal_ai_quota(user_id,day,used)
    VALUES(${userId},CURRENT_DATE,1)
    ON CONFLICT(user_id,day) DO UPDATE SET used=tm_terminal_ai_quota.used+1
    WHERE tm_terminal_ai_quota.used<20 RETURNING used`
  return rows.length>0
}
export function validMessages(input){
  if(!Array.isArray(input)||input.length<1||input.length>12) return null
  if(input.some(m=>!m||!['user','assistant'].includes(m.role)||typeof m.content!=='string'||!m.content.trim()||m.content.length>2000))return null
  if(input.at(-1).role!=='user')return null
  return input.map(({role,content})=>({role,content:content.trim()}))
}
