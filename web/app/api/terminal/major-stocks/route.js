import {majorStocks} from '@/lib/terminal/major-stocks'
export const runtime='nodejs'
export const dynamic='force-dynamic'
export async function GET() {
  try{return Response.json(await majorStocks())}
  catch{return Response.json({items:[],status:'unavailable',error:'미국 주요주식 시세를 받지 못했습니다.'},{status:503})}
}
