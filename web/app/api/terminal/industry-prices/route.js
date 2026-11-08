import {getIndustryPrices} from '@/lib/terminal/industry-prices'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=60
export async function GET(request) {
  const view=new URL(request.url).searchParams.get('view')||'all'
  if(!['all','dram','oil'].includes(view)) return Response.json({error:'지원하지 않는 가격 구분입니다.'},{status:400})
  return Response.json(await getIndustryPrices(view),{headers:{'Cache-Control':'no-store'}})
}
