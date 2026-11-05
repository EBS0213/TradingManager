import {getTerminalNews} from '@/lib/terminal/news'
import {json} from '@/lib/terminal/http'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=30
export async function GET(request){
  const query=new URL(request.url).searchParams.get('query')||''
  if(query.length>120) return json({error:'검색어는 120자 이하여야 합니다'},400)
  return json(await getTerminalNews(query))
}
