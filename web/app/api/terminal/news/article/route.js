import {getNewsArticle} from '@/lib/terminal/news-article'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=30
export async function GET(request){
  const url=new URL(request.url).searchParams.get('url')||''
  return Response.json(await getNewsArticle(url),{headers:{'Cache-Control':'no-store'}})
}
