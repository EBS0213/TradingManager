import {getOilHistory} from '@/lib/terminal/oil-history'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=60
export async function GET(request) {
  const kind=new URL(request.url).searchParams.get('kind')||'all'
  if(!['all','crude','products'].includes(kind))return Response.json({error:'지원하지 않는 유가 구분입니다.'},{status:400})
  return Response.json(await getOilHistory(kind),{headers:{'Cache-Control':'no-store'}})
}
