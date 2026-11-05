import { getFutures,getFutureAsset,FUTURES } from '@/lib/terminal/futures.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;
export async function GET(request) {
  const symbol=new URL(request.url).searchParams.get('symbol');
  if(symbol){
    if(!FUTURES.some(item=>item.symbol===symbol))return Response.json({error:'지원하지 않는 선물입니다.'},{status:400});
    return Response.json({item:await getFutureAsset(symbol)},{headers:{'Cache-Control':'no-store'}});
  }
  return Response.json(await getFutures(), { headers: { 'Cache-Control': 'no-store' } });
}
