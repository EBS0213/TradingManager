import {getMarketData,refreshStatus} from '@/lib/terminal/market'
import {json,adminUser,sameOrigin} from '@/lib/terminal/http'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET(){return json({ok:true,...refreshStatus(),message:'Redis 시드 대신 관측 시세를 요청 시 읽습니다.'})}
export async function POST(request){
  if(!sameOrigin(request)||!await adminUser()) return json({error:'관리자 로그인이 필요합니다'},403)
  const data=await getMarketData({force:true})
  return json({ok:data.status!=='unavailable',...refreshStatus(),coverage:data.coverage,status:data.status})
}
