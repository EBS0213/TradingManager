import {equityList,equityDetail} from '@/lib/terminal/equities'
import {koreanEquityList,koreanEquityDetail} from '@/lib/terminal/equities-kr'
import {equitySymbol} from '@/lib/terminal/equities-data.mjs'
import {SECTOR_GROUPS} from '@/lib/terminal/sector-etfs-data.mjs'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=60
export async function GET(request) {
  const query=new URL(request.url).searchParams,symbol=query.get('symbol')?.trim(),market=(query.get('market')||(/^[0-9][0-9A-Z]{5}$/.test(symbol||'')?'KR':'US')).toUpperCase()
  if(!['US','KR'].includes(market))return Response.json({error:'지원 시장은 한국·미국입니다.'},{status:400})
  if(symbol&&!(market==='KR'?/^[0-9][0-9A-Z]{5}$/.test(symbol):equitySymbol(symbol)))return Response.json({error:'종목코드 형식이 올바르지 않습니다.'},{status:400})
  const sector=query.get('sector')
  if(sector!==null&&!['all',...SECTOR_GROUPS.map(group=>group.id)].includes(sector))return Response.json({error:'지원하지 않는 산업 분류입니다.'},{status:400})
  const integer=(key,fallback,max)=>{const value=Number(query.get(key));return Number.isInteger(value)&&value>0?Math.min(value,max):fallback}
  try {
    const list=market==='KR'?koreanEquityList:equityList,detail=market==='KR'?koreanEquityDetail:equityDetail
    const data=symbol?await detail(symbol):await list({kind:sector!==null||query.get('kind')==='etf'?'etf':query.get('kind')==='stock'?'stock':'all',sector,q:(query.get('q')||'').slice(0,80),page:integer('page',1,10000),pageSize:integer('pageSize',50,100),sort:query.get('sort')||'volume'})
    return Response.json(data,{status:symbol&&!data.item?404:200,headers:{'Cache-Control':'public,max-age=0,s-maxage=300,stale-while-revalidate=600'}})
  }catch {
    return Response.json({error:'시장 시세를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.',items:[],total:0,status:'unavailable'},{status:503})
  }
}
