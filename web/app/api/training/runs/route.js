import {randomUUID,randomInt} from 'node:crypto'
import {currentUser,db,json,sameOrigin,guestId,guestCookie,koreaDay,readBody,cases,selectCases,validateSettings} from '@/lib/training/api'
export const runtime='nodejs';export const dynamic='force-dynamic'
export async function POST(req){if(!sameOrigin(req))return json({error:'허용되지 않은 요청입니다.'},403);try{
 const {settings,exclude=[]}=await readBody(req),all=await cases();if(!validateSettings(settings)||settings.capital!==10000||!Array.isArray(exclude)||exclude.length>10||exclude.some(id=>!all.some(c=>c.id===id)))return json({error:'세션 설정이 올바르지 않습니다.'},400)
 const user=await currentUser(),owner=user?String(user.id):null,guest=owner?null:guestId(req)??randomUUID(),id=randomUUID(),day=koreaDay(),order=selectCases(all,{months:settings.horizonMonths??3,exclude,random:()=>randomInt(0,2**32)/2**32}),sql=await db()
 let result
 if(owner)result=await sql`INSERT INTO tm_training_runs(id,owner,settings,ordering) VALUES(${id},${owner},${JSON.stringify(settings)}::jsonb,${JSON.stringify(order)}::jsonb) RETURNING id`
 else result=await sql`WITH quota AS (INSERT INTO tm_training_quota(guest,day,used) VALUES(${guest},${day},1) ON CONFLICT(guest,day) DO UPDATE SET used=tm_training_quota.used+1 WHERE tm_training_quota.used<2 RETURNING used) INSERT INTO tm_training_runs(id,guest,settings,ordering) SELECT ${id},${guest},${JSON.stringify(settings)}::jsonb,${JSON.stringify(order)}::jsonb FROM quota RETURNING id`
 const headers=guest?{'Set-Cookie':guestCookie(req,guest)}:{};if(!result.length)return json({error:'오늘의 방문자 훈련 2회를 모두 사용했습니다. 로그인하면 계속할 수 있습니다.',code:'daily_limit'},429,headers)
 return json({id,order,ranked:!!owner,owner},201,headers)
 }catch(e){console.error('[training/runs]',e.message);return json({error:'세션을 시작하지 못했습니다.'},503)}}
