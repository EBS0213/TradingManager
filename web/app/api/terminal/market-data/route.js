import {getMarketData} from '@/lib/terminal/market'
import {json,readBody,sameOrigin,adminUser} from '@/lib/terminal/http'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=30
export async function GET(request){
  const includeDaily=new URL(request.url).searchParams.get('history')==='daily'
  return json(await getMarketData({includeDaily}))
}
export async function POST(request){
  if(!sameOrigin(request)) return json({error:'허용되지 않은 출처'},403)
  let body;try{body=await readBody(request,1024)}catch{return json({error:'잘못된 요청'},400)}
  if(!['update','refresh'].includes(body?.action)) return json({error:'지원하지 않는 action'},400)
  if(body.action==='refresh' && !await adminUser()) return json({error:'관리자 로그인이 필요합니다'},403)
  return json(await getMarketData({force:body.action==='refresh'}))
}
