import {getTerminalAssets} from '@/lib/terminal/assets'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=30
export async function GET(request) {
  const group=new URL(request.url).searchParams.get('group')||'stocks'
  if(!['stocks','sectors','crypto'].includes(group))return Response.json({error:'지원하지 않는 자산 그룹입니다.'},{status:400})
  const result=await getTerminalAssets(group)
  return Response.json(result,{headers:{'Cache-Control':'public, max-age=0, s-maxage=300, stale-while-revalidate=600'}})
}
